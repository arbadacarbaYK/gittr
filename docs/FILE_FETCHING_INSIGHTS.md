# File Fetching Insights & Best Practices

This document captures insights and patterns discovered while implementing file fetching from various git servers (GitHub, GitLab, Codeberg, GRASP servers).

## Table of Contents

1. [Complete File Fetching and Opening Flow](#complete-file-fetching-and-opening-flow)
2. [SSH URL Normalization](#ssh-url-normalization)
3. [Codeberg/Gitea API URL Encoding](#codeberggitea-api-url-encoding)
4. [GRASP Server File Fetching](#grasp-server-file-fetching)
5. [GRASP Server Automatic Cloning Mechanism](#grasp-server-automatic-cloning-mechanism)
6. [localStorage Repository Matching](#localstorage-repository-matching)
7. [File Opening Flow - Correct Strategy Order](#file-opening-flow---correct-strategy-order)
8. [API Endpoint Patterns](#api-endpoint-patterns)
9. [Testing Checklist](#testing-checklist)

---

## Complete File Fetching and Opening Flow

This section documents the **complete flow** for fetching file lists and opening individual files, including all fallback mechanisms.

### Overview: Two Separate Flows

1. **File List Fetching** (`fetchFileList` / `useEffect` in `page.tsx`) - Gets the directory tree
2. **File Opening** (`fetchGithubRaw` function in `page.tsx`) - Gets individual file content

Both flows have multiple fallback strategies and must work together seamlessly.

---

## SSH URL Normalization

### Problem

Some repositories use SSH clone URLs (e.g., `git@github.com:owner/repo`) instead of HTTPS URLs. The system needs to handle these URLs consistently across all operations (file fetching, file opening, cloning, refetching, pushing to Nostr, importing).

### Solution

**SSH URLs are automatically normalized to HTTPS format** before processing. The normalization pattern is:
- **SSH**: `git@github.com:owner/repo` → **HTTPS**: `https://github.com/owner/repo`
- Works for all git hosts (GitHub, GitLab, Codeberg, custom servers)

### Where Normalization Happens

SSH URL normalization is implemented in **all critical paths**:

1. **`parseGitSource()`** (`ui/src/lib/utils/git-source-fetcher.ts`)
   - Normalizes SSH URLs when parsing clone URLs for file list fetching
   - Ensures GitHub/GitLab/Codeberg detection works correctly

2. **Clone API** (`ui/src/pages/api/nostr/repo/clone.ts`)
   - Normalizes SSH URLs before executing `git clone` commands
   - Ensures clone operations work with SSH clone URLs

3. **File Opening** (`ui/src/app/[entity]/[repo]/page.tsx` - `fetchGithubRaw()`)
   - Normalizes SSH URLs in 3 places:
     - When extracting sourceUrl from localStorage clone URLs
     - When extracting sourceUrl from repoData.clone URLs
     - When iterating through sources to try (before URL matching)
   - Ensures file content fetching works with SSH sourceUrls

4. **File Fetch Initialization** (`ui/src/app/[entity]/[repo]/page.tsx`)
   - Normalizes SSH URLs when adding sourceUrl to clone URLs array
   - Ensures all clone URLs are in consistent format

5. **Push to Nostr** (`ui/src/lib/nostr/push-repo-to-nostr.ts`)
   - Normalizes SSH URLs when building clone URLs array for Nostr events
   - Ensures clone URLs are stored as HTTPS in Nostr events

6. **Import API** (`ui/src/pages/api/import.ts`)
   - Normalizes SSH URLs before validation and GitHub API calls
   - Enables refetch functionality to work with SSH sourceUrls

7. **GRASP Clone Trigger** (`ui/src/lib/utils/git-source-fetcher.ts`)
   - Normalizes SSH URLs before triggering clone API for GRASP servers
   - Ensures automatic cloning works with SSH clone URLs

### Implementation Pattern

The normalization pattern is consistent across all files:

```typescript
// CRITICAL: Normalize SSH URLs (git@host:path) to HTTPS format
const sshMatch = url.match(/^git@([^:]+):(.+)$/);
if (sshMatch) {
  const [, host, path] = sshMatch;
  normalizedUrl = `https://${host}/${path}`;
  console.log(`🔄 [Context] Normalized SSH URL to HTTPS: ${normalizedUrl}`);
}
```

### Why This Matters

- **Consistency**: All URLs are in HTTPS format for API calls and matching
- **Compatibility**: Repos using SSH clone URLs (like fiatjaf's `gitstr`) work seamlessly
- **Reliability**: No special handling needed - SSH URLs are treated like HTTPS URLs
- **Future-proof**: Works with any git host that supports SSH URLs

### Files Affected

- ✅ `ui/src/lib/utils/git-source-fetcher.ts` - parseGitSource, GRASP clone trigger
- ✅ `ui/src/pages/api/nostr/repo/clone.ts` - Clone API
- ✅ `ui/src/app/[entity]/[repo]/page.tsx` - fetchGithubRaw, file fetch initialization
- ✅ `ui/src/lib/nostr/push-repo-to-nostr.ts` - Push to Nostr
- ✅ `ui/src/pages/api/import.ts` - Import/refetch API

---

## File List Fetching Flow

**Location**: `ui/src/app/[entity]/[repo]/page.tsx` (main `useEffect` starting around line 955)

### Flow Diagram

```
User opens repo page
  ↓
1. Check localStorage for cached files
   ├─ If found AND matches entity+repo → Use cached files ✅
   └─ If not found or mismatch → Continue to fetch
  ↓
2. Check if repo has embedded files in Nostr event
   ├─ If files array exists → Use embedded files ✅
   └─ If no files → Continue to fetch
  ↓
3. Try git-nostr-bridge API (for local/GRASP repos)
   ├─ Success → Use files from git-nostr-bridge ✅
   ├─ 404 (not cloned) → Check if GRASP server
   │   ├─ If GRASP → Trigger clone → Wait 3s → Retry ✅
   │   └─ If not GRASP → Continue to external git servers
   └─ Error → Continue to external git servers
  ↓
4. Try external git servers (GitHub, GitLab, Codeberg)
   ├─ Iterate through clone URLs in priority order:
   │   ├─ External git servers first (GitHub, GitLab, Codeberg)
   │   └─ GRASP servers second (git.gittr.space, gitnostr.com, relay.ngit.dev, etc.)
   ├─ For each URL:
   │   ├─ GitHub → API: /repos/{owner}/{repo}/git/trees/{sha}?recursive=1
   │   ├─ GitLab → API: /api/v4/projects/{path}/repository/tree?recursive=true&per_page=100&page={page}
   │   │   └─ **CRITICAL**: GitLab API pagination - fetches ALL pages using X-Total-Pages header (max 100 items per page)
   │   ├─ Codeberg → API: /api/v1/repos/{owner}/{repo}/git/trees/{branch}?recursive=true
   │   └─ GRASP → Try HTTP API patterns (Gitea-style, GitLab-style, etc.)
   └─ First success → Use files ✅
  ↓
5. Update repoData state and localStorage
```

### Key Implementation Details

- **Strict matching**: Entity AND repo name must match for localStorage
- **Npub decoding**: Converts npub to pubkey for comparison
- **Automatic cloning**: GRASP repos trigger clone if not found locally
- **Background polling**: Uses custom events (`grasp-repo-cloned`) for non-blocking updates

---

## File Opening Flow - Correct Strategy Order

**Location**: `ui/src/app/[entity]/[repo]/page.tsx` (`fetchGithubRaw` function starting around line 3503)

### CRITICAL: Strategy Order

The correct order is **critical** for file opening to work:

1. **Strategy 1: Check embedded files FIRST** (always, regardless of sourceUrl/clone URLs)
2. **Strategy 2: Try git-nostr-bridge API** (for local/GRASP repos)
3. **Strategy 3: Try external git servers via API proxy** (GitHub, GitLab, Codeberg)

### Flow Diagram

```
User clicks on a file
  ↓
Strategy 1: Check if file content is embedded in repoData.files array
   ├─ If found with content → Use embedded content ✅
   └─ If not found → Continue to Strategy 2
  ↓
Strategy 2: Try git-nostr-bridge API
   ├─ Resolve ownerPubkey:
   │   ├─ Check repoData.ownerPubkey
   │   ├─ Check localStorage for matching repo
   │   ├─ Decode npub from params.entity
   │   └─ Fallback to resolveEntityToPubkey utility
   ├─ Success → Use content from git-nostr-bridge ✅
   ├─ 404 (not cloned) → Check if GRASP server
   │   ├─ If GRASP → Trigger clone → Poll (max 10 attempts, 2s delay) ✅
   │   └─ If not GRASP → Continue to Strategy 3
   └─ Error → Continue to Strategy 3
  ↓
Strategy 3: Try external git servers via API proxy
   ├─ GitHub → /api/git/file-content?sourceUrl=...&path=...&branch=...
   ├─ GitLab → /api/git/file-content?sourceUrl=...&path=...&branch=...
   ├─ Codeberg → /api/git/file-content?sourceUrl=...&path=...&branch=...
   └─ GRASP → /api/git/file-content?sourceUrl=...&path=...&branch=... (forwards to bridge API)
  ↓
Handle binary vs text files
   ├─ Binary → Return base64, frontend creates data URL
   └─ Text → Return UTF-8 content
```

### Why This Order Matters

**Embedded files must be checked FIRST** because:
- Some GRASP repos have files embedded in Nostr events even when clone URLs exist
- Embedded content is the most reliable source (no network calls needed)
- Legacy repos store files directly in events

**git-nostr-bridge API is second** because:
- It's the primary method for repos that have been cloned locally
- For GRASP repos, it requires the repo to be cloned first
- It's faster than external API calls when available

**External git servers are last** because:
- They require network calls
- They're used as fallback when embedded content and git-nostr-bridge aren't available
- **Note**: For GRASP servers, `/api/git/file-content` detects them and forwards to bridge API (same as Strategy 2)

### OwnerPubkey Resolution (Strategy 2)

The ownerPubkey resolution follows this priority:

1. **repoData.ownerPubkey** (if set during file fetching)
2. **localStorage** (check for matching repo by entity+name)
3. **Decode npub** from `params.entity` (most reliable for GRASP repos)
4. **resolveEntityToPubkey utility** (final fallback)

This ensures consistency - if files were fetched successfully, file opening will work too.

### Code Reference

```typescript
// Strategy 1: Check embedded files FIRST
if (repoData?.files && Array.isArray(repoData.files)) {
  const fileEntry = repoData.files.find((f: any) => {
    // Match file by path...
  });
  if (fileEntry && foundContent) {
    // Use embedded content - return immediately
    return { content: foundContent, url: null, isBinary: false };
  }
}

// Strategy 2: Try git-nostr-bridge API
let ownerPubkey = (repoData as any)?.ownerPubkey;
// Resolve ownerPubkey (check localStorage, decode npub, etc.)
if (ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey)) {
  // CRITICAL: File paths must be URL-encoded to handle non-ASCII characters (Cyrillic, Chinese, etc.)
  // The API automatically decodes them and handles UTF-8 correctly
  const apiUrl = `/api/nostr/repo/file-content?ownerPubkey=${encodeURIComponent(ownerPubkey)}&repo=${encodeURIComponent(repoName)}&path=${encodeURIComponent(filePath)}&branch=${encodeURIComponent(branch)}`;
  const response = await fetch(apiUrl);
  if (response.ok) {
    // Use content from git-nostr-bridge
    return { content: data.content, url: null, isBinary: false };
  } else if (response.status === 404 && isGraspRepo) {
    // Trigger clone and poll...
  }
}

// Strategy 3: Try external git servers via API proxy
// CRITICAL: File paths must be URL-encoded to handle non-ASCII characters
const apiUrl = `/api/git/file-content?sourceUrl=${encodeURIComponent(sourceUrl)}&path=${encodeURIComponent(filePath)}&branch=${encodeURIComponent(branch)}`;
const response = await fetch(apiUrl);
// Handle response...
```

---

## Codeberg/Gitea API URL Encoding

### Problem

Codeberg API returns 404 when the entire owner/repo path is URL-encoded together.

### Incorrect Pattern ❌

```typescript
const projectPath = encodeURIComponent(`${owner}/${repo}`);
```

### Correct Pattern ✅

```typescript
const projectPath = `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
// Results in: DanConwayDev/ngit-cli (slash is NOT encoded)
// API works correctly
```

### Why This Matters

- Codeberg uses Gitea API, which expects the slash between owner and repo to remain unencoded
- This applies to both file list fetching and file content fetching
- The file path itself should still be encoded: `encodeURIComponent(filePathStr)`

### Files Affected

- ✅ `ui/src/app/[entity]/[repo]/page.tsx` - File list fetching (FIXED)
- ✅ `ui/src/app/[entity]/[repo]/page.tsx` - File opening (`fetchGithubRaw` function) (FIXED)
- ✅ `ui/src/pages/api/git/file-content.ts` - File content API proxy (FIXED)

---

## GRASP Server File Fetching

### Problem

GRASP servers (git.gittr.space, gitnostr.com, relay.ngit.dev, git-01.uid.ovh, etc.) were returning 404 when trying to fetch files via HTTP API.

### Root Cause

1. **GRASP servers don't expose REST APIs**: GRASP servers only work through the git protocol (which web browsers can't use directly) or through `git-nostr-bridge` (which requires repos to be cloned locally first).
2. **HTTP API attempts were failing**: Some GRASP servers may expose HTTP APIs (like `git.gittr.space`), but the standard approach is to use `git-nostr-bridge` for all GRASP servers.

### Current Solution

**All GRASP servers now use `git-nostr-bridge` API exclusively:**

1. **File List Fetching** (`fetchFromNostrGit` in `git-source-fetcher.ts`):
   - Calls `/api/nostr/repo/files?ownerPubkey=...&repo=...&branch=...`
   - If 404 (repo not cloned), triggers clone via `/api/nostr/repo/clone`
   - Retries bridge API after clone completes

2. **File Content Fetching** (`/api/git/file-content.ts`):
   - Detects GRASP servers using `isGraspServer()` function
   - Extracts `npub` and `repo` from the URL
   - Decodes `npub` to get `ownerPubkey`
   - Forwards request to `/api/nostr/repo/file-content?ownerPubkey=...&repo=...&path=...&branch=...`
   - The bridge API handles the actual file reading from the cloned repository

### Why This Matters

- **Consistency**: All GRASP servers use the same method (bridge API), regardless of whether they expose HTTP APIs
- **Reliability**: Bridge API reads from locally cloned repos, which are always up-to-date
- **Automatic cloning**: If a repo isn't cloned yet, the system automatically clones it before fetching files
- **Follows NIP-34 architecture**: Files are stored on git servers, Nostr events only contain references

### Implementation Details

**File List Fetching:**
- Uses `fetchFromNostrGit()` in `git-source-fetcher.ts`
- Tries bridge API first: `/api/nostr/repo/files`
- If 404, triggers clone, then retries
- Returns files array or `null` if all attempts fail

**File Content Fetching:**
- `/api/git/file-content.ts` detects GRASP servers
- Extracts `npub` from URL pattern: `https://domain/npub.../repo.git`
- Decodes `npub` to `ownerPubkey` using `nip19.decode()`
- Forwards to `/api/nostr/repo/file-content` (bridge API)
- Bridge API reads file from cloned repository

**OwnerPubkey Resolution:**
- **Preferred**: Use `eventPublisherPubkey` (from NIP-34 event) - this is what bridge uses
- **Fallback**: Decode `npub` from clone URL
- Bridge stores repos by event publisher's pubkey, not the clone URL's npub

### Files Affected

- ✅ `ui/src/lib/utils/git-source-fetcher.ts` - `fetchFromNostrGit()` function (uses bridge API)
- ✅ `ui/src/pages/api/git/file-content.ts` - Detects GRASP servers and forwards to bridge API
- ✅ `ui/src/app/[entity]/[repo]/page.tsx` - File opening uses bridge API via `/api/git/file-content` proxy

---

## GRASP Server Automatic Cloning Mechanism

### The Key Insight

**Some GRASP servers (like `relay.ngit.dev`, which is gitworkshop.dev's relay) don't expose an HTTP API for file browsing.** They only work through:

- The `git` protocol (which web browsers can't use directly)
- `git-nostr-bridge` (which requires repos to be cloned locally first)

**The key insight**: When `git-nostr-bridge` returns 404 (repo not found), we shouldn't just fall back to HTTP API - we should **trigger a clone first**, then retry `git-nostr-bridge`.

### When Cloning is Triggered

Cloning is automatically triggered when:

1. **`git-nostr-bridge` API returns 404** (repo not found locally)
2. **The repo is from a GRASP server** (git.gittr.space, gitnostr.com, relay.ngit.dev, git-01.uid.ovh, git-02.uid.ovh, ngit.danconwaydev.com, git.shakespeare.diy)
3. **A valid HTTP/HTTPS clone URL exists** in the repo's `clone` array
4. **A valid ownerPubkey is available** (full 64-char hex pubkey)

### The Clone Flow

```
1. User opens repo page or clicks file
   ↓
2. Try git-nostr-bridge API: GET /api/nostr/repo/files?ownerPubkey=...&repo=...
   ↓
3. API returns 404 (repo not cloned locally)
   ↓
4. Check if repo has GRASP clone URL (e.g., https://git.gittr.space/npub.../repo.git or https://relay.ngit.dev/npub.../repo.git)
   ↓
5. Call clone API: POST /api/nostr/repo/clone
   Body: { cloneUrl, ownerPubkey, repoName }
   ↓
6. Clone API executes: git clone --bare <cloneUrl> <repoPath>
   Repo path: {reposDir}/{ownerPubkey}/{repoName}.git
   ↓
7. Wait 3 seconds for clone to complete (file list) OR poll (file opening)
   ↓
8. Retry git-nostr-bridge API: GET /api/nostr/repo/files?... or /api/nostr/repo/file-content?...
   ↓
9. Success! Files are fetched and displayed
```

### Clone API Endpoint

**Endpoint**: `POST /api/nostr/repo/clone`

**Request Body**:
```typescript
{
  cloneUrl: string,      // e.g., "https://git.gittr.space/npub1.../repo.git" or "https://relay.ngit.dev/npub1.../repo.git"
  ownerPubkey: string,  // Full 64-char hex pubkey (validated)
  repoName: string       // Base repo name (e.g., "repo" from "gitnostr.com/repo")
}
```

**Response**:
```typescript
// Success (200)
{
  message: "Repository cloned successfully",
  path: "/path/to/repo.git",
  cloneUrl: "https://..."
}

// Already exists (200)
{
  message: "Repository already cloned",
  path: "/path/to/repo.git"
}

// Error (400/500)
{
  error: "Failed to clone repository",
  details: "..."
}
```

### Implementation Details

#### Clone API (`/api/nostr/repo/clone.ts`)

- Validates inputs (cloneUrl, ownerPubkey must be 64-char hex, repoName)
- Gets repos directory from env or git-nostr-bridge config.json
- Repository path: `{reposDir}/{ownerPubkey}/{repoName}.git`
- Checks if repo already exists (returns 200 if so)
- Creates owner directory if needed
- Executes: `git clone --bare "<cloneUrl>" "<repoPath>"`
- Returns success/error response

**Key points**:
- Uses `git clone --bare` (bare repository, no working directory)
- Validates `ownerPubkey` is exactly 64 hex characters
- Extracts `repoName` from clone URL (handles paths like `gitnostr.com/repo`)
- Timeout: 60 seconds, max buffer: 10MB
- Handles "already exists" gracefully (returns 200)

#### Frontend Integration (`page.tsx`)

**File List Fetching**:
- Returns `null` immediately after triggering clone (non-blocking)
- Uses background polling with custom event (`grasp-repo-cloned`) to update UI
- Updates `localStorage` when files become available

**File Opening**:
- Blocks and polls synchronously (max 10 attempts, 2s delay)
- Returns file content once available
- Shows "(unable to load file)" if clone fails or file not found after polling

### Why This Solution Works

1. **Addresses the root cause**: GRASP servers that don't expose HTTP API need repos cloned locally first
2. **Automatic and transparent**: User doesn't need to manually clone repos
3. **Follows NIP-34 architecture**: Files are stored on git servers, Nostr events only contain references
4. **Efficient**: Only clones when needed (404 response), checks if already exists
5. **Robust**: Handles errors gracefully, falls back to HTTP API if clone fails

### Files Affected

- ✅ `ui/src/pages/api/nostr/repo/clone.ts` - Clone API endpoint (NEW)
- ✅ `ui/src/app/[entity]/[repo]/page.tsx` - Clone trigger logic in file list fetching (FIXED)
- ✅ `ui/src/app/[entity]/[repo]/page.tsx` - Clone trigger logic in file opening (FIXED)
- ✅ `ui/src/lib/utils/git-source-fetcher.ts` - Clone trigger in file list fetching (FIXED)

---

## localStorage Repository Matching

### Problem

Wrong README and files showing when opening a repo (e.g., `lnbits_tabletown` showing README from `bitcoin_meetup_calendar`). The issue was inconsistent - sometimes showing right files with wrong README, sometimes wrong everything.

### Root Cause

1. **`findRepoByEntityAndName` was too loose**: It matched by repo name first, then checked entity. If multiple repos had similar names or if the entity check was too lenient, it could return the wrong repo.
2. **Entity matching was not strict enough**: The matching logic didn't properly decode npub to pubkey for comparison.
3. **Repo name normalization**: Some repos might have `.md` suffix in localStorage but not in URL (or vice versa).

### Fix Applied

#### 1. Made `findRepoByEntityAndName` stricter

Updated `ui/src/lib/utils/repo-finder.ts` to require BOTH entity AND repo name to match:

```typescript
// CRITICAL: Entity MUST also match - don't return if only repo name matches
// Match by entity (exact match first)
if (r.entity && r.entity.toLowerCase() === entity.toLowerCase()) return true;
if (entityPubkey && r.entity && r.entity.toLowerCase() === entityPubkey.toLowerCase()) return true;

// Match by ownerPubkey (most reliable - works across all entity formats)
if (entityPubkey && r.ownerPubkey && r.ownerPubkey.toLowerCase() === entityPubkey.toLowerCase()) return true;
```

#### 2. Added strict matching in page component

Added comprehensive entity and repo name matching with npub decoding and `.md` suffix normalization:

```typescript
// Decode npub to pubkey for comparison
let entityPubkey: string | null = null;
if (params.entity?.startsWith('npub')) {
  try {
    const decoded = nip19.decode(params.entity);
    if (decoded.type === 'npub' && typeof decoded.data === 'string') {
      entityPubkey = decoded.data;
    }
  } catch {}
}

// Strict entity matching: must match entity (npub/pubkey) OR ownerPubkey
const entityMatches = repo.entity && (
  repo.entity.toLowerCase() === params.entity.toLowerCase() ||
  (entityPubkey && repo.entity && repo.entity.toLowerCase() === entityPubkey.toLowerCase()) ||
  (entityPubkey && repo.ownerPubkey && repo.ownerPubkey.toLowerCase() === entityPubkey.toLowerCase()) ||
  (repo.ownerPubkey && repo.ownerPubkey.toLowerCase() === params.entity.toLowerCase())
);

// Strict repo name matching: must match repo, slug, or name (case-insensitive)
// Also check if repo name has .md suffix that should be stripped
const normalizedParamsRepo = params.repo.replace(/\.md$/, '');
const repoMatches = 
  (repo.repo && repo.repo.replace(/\.md$/, '').toLowerCase() === normalizedParamsRepo.toLowerCase()) ||
  (repo.slug && repo.slug.replace(/\.md$/, '').toLowerCase() === normalizedParamsRepo.toLowerCase()) ||
  (repo.name && repo.name.replace(/\.md$/, '').toLowerCase() === normalizedParamsRepo.toLowerCase());

// Only load if BOTH match
if (entityMatches && repoMatches && (repo.readme !== undefined || repo.files !== undefined || !repo.sourceUrl)) {
  // Load repo data...
}
```

### Why This Matters

- Prevents wrong repos from being loaded when multiple repos exist for the same owner
- Ensures npub URLs correctly match repos stored with pubkeys
- Handles edge cases like `.md` suffix differences
- Provides logging to debug matching issues

### Files Affected

- ✅ `ui/src/lib/utils/repo-finder.ts` - Made `findRepoByEntityAndName` stricter (FIXED)
- ✅ `ui/src/app/[entity]/[repo]/page.tsx` - Added strict matching with npub decoding and .md normalization (FIXED)

---

## API Endpoint Patterns

### GitHub

```typescript
// File list
`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=true`

// File content
`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}?ref=${branch}`
```

### GitLab

```typescript
// File list (with pagination - CRITICAL for repos with >100 files)
// GitLab API returns max 100 items per page, must paginate to get all files
let allItems: any[] = [];
let page = 1;
const perPage = 100;
let hasMore = true;

while (hasMore) {
  const treeUrl = `https://gitlab.com/api/v4/projects/${encodeURIComponent(`${owner}/${repo}`)}/repository/tree?recursive=true&ref=${branch}&per_page=${perPage}&page=${page}`;
  const response = await fetch(treeUrl, {
    headers: { "User-Agent": "gittr-space", "Accept": "application/json" }
  });
  
  if (response.ok) {
    const data = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      allItems = [...allItems, ...data];
      // Check pagination headers
      const totalPages = parseInt(response.headers.get("X-Total-Pages") || "1", 10);
      const currentPage = parseInt(response.headers.get("X-Page") || "1", 10);
      hasMore = currentPage < totalPages;
      page++;
    } else {
      hasMore = false;
    }
  } else {
    hasMore = false;
  }
}

// Process allItems: filter blobs (files) and trees (dirs)
const files = allItems.filter(n => n.type === "blob").map(n => ({ type: "file", path: n.path, size: n.size }));
const dirs = allItems.filter(n => n.type === "tree").map(n => ({ type: "dir", path: n.path }));

// File content
`https://gitlab.com/api/v4/projects/${encodeURIComponent(`${owner}/${repo}`)}/repository/files/${encodeURIComponent(filePath)}/raw?ref=${branch}`
```

**Important**: GitLab API pagination is **critical** - without it, repos with more than 100 files will have missing files (js, yaml, json, nix, etc.). Always check `X-Total-Pages` and `X-Page` headers to fetch all pages.

### Codeberg (Gitea)

```typescript
// File list
`https://codeberg.org/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${branch}?recursive=true`

// File content
`https://codeberg.org/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(filePath)}?ref=${branch}`

// Raw file fallback
`https://codeberg.org/${owner}/${repo}/raw/branch/${branch}/${encodeURIComponent(filePath)}`
```

### GRASP Servers

```typescript
// GRASP servers use the full path from clone URL in their API endpoints
// Clone URL: https://git.gittr.space/npub1.../purplestore.git
// API endpoint: https://git.gittr.space/npub1.../purplestore/api/v1/repos/npub1.../purplestore/git/trees/main?recursive=true
// Note: Some GRASP servers (like relay.ngit.dev) don't expose HTTP API and require git-nostr-bridge

// Extract full path from clone URL
const baseUrl = cloneUrl.replace(/\.git$/, '');
const urlPathMatch = baseUrl.match(/https?:\/\/[^\/]+(\/.+)$/);
const fullPath = urlPathMatch ? urlPathMatch[1] : `/${repoName}`;

// Try Gitea-style API with full path first (most common for GRASP)
const treeUrl = `${baseUrl}/api/v1/repos${fullPath}/git/trees/${branch}?recursive=true`;

// For file content, use backend API proxy
`/api/git/file-content?sourceUrl=${encodeURIComponent(graspUrl)}&path=${encodeURIComponent(filePath)}&branch=${encodeURIComponent(branch)}`
```

**Note**: Many GRASP servers don't expose HTTP API and require `git-nostr-bridge` for file access.

---

## Testing Checklist

### Before Implementing Support for a New Git Server

1. **Test API Endpoints Manually**
   ```bash
   # Test file list endpoint
   curl -H "User-Agent: gittr" "API_URL_FOR_FILE_LIST"
   
   # Test file content endpoint
   curl -H "User-Agent: gittr" "API_URL_FOR_FILE_CONTENT"
   ```

2. **Verify URL Encoding Requirements**
   - Check if owner/repo path needs encoding
   - Check if slash between owner/repo should be encoded or not
   - Test with special characters in owner/repo names
   - Test with special characters in file paths

3. **Check Response Format**
   - JSON structure for file list
   - Content encoding (base64, UTF-8, etc.)
   - Binary file detection method
   - Error response format

4. **Test Authentication Requirements**
   - Public repos (no auth needed)
   - Private repos (if applicable)
   - Rate limiting behavior

5. **Implement in Both Places**
   - File list fetching: `ui/src/app/[entity]/[repo]/page.tsx`
   - File content fetching: `ui/src/pages/api/git/file-content.ts`

6. **Add Error Logging**
   - Log the exact URL being called
   - Log response status and error messages
   - Log response body for debugging

7. **Test Edge Cases**
   - Files with special characters in names
   - Files in nested directories
   - Binary files (images, PDFs, etc.)
   - Large files
   - Empty files

---

## Key Insights and Why This Works

### 1. **Embedded Files First**

- Files embedded in Nostr events are always checked first (both for list and content)
- This handles legacy repos and small files that are stored directly in events
- **Critical**: This must be Strategy 1 in file opening, regardless of sourceUrl/clone URLs

### 2. **git-nostr-bridge for Local/GRASP Repos**

- `git-nostr-bridge` is the primary method for repos that have been cloned locally
- For GRASP servers that don't expose HTTP API, automatic cloning ensures files are available
- OwnerPubkey resolution must be consistent between file fetching and file opening

### 3. **External Git Servers as Fallback**

- GitHub, GitLab, Codeberg APIs are used when:
  - Repo is imported from external git server
  - GRASP server doesn't have HTTP API or clone fails
  - Files are not embedded in Nostr event

### 4. **Multiple URL Patterns for GRASP Servers**

- Different GRASP servers use different URL patterns (GitLab-style, Gitea-style, etc.)
- The system tries multiple patterns to maximize compatibility
- Many GRASP servers don't expose HTTP API and require `git-nostr-bridge`

### 5. **Binary File Handling**

- Binary files are detected by extension and content type
- Base64 encoding is preserved through the entire flow
- Frontend creates data URLs for display (images, PDFs, etc.)

### 6. **Branch Fallback**

- System tries multiple branches (selectedBranch, main, master) when opening files
- This handles cases where default branch differs from expected

### 7. **localStorage Caching**

- Both file lists and file content are cached in localStorage
- Strict matching (entity + repo name) prevents loading wrong data
- Corruption detection skips invalid cached data

### 8. **Repo Name Extraction**

- Handles paths like `gitnostr.com/gitworkshop` by extracting just `gitworkshop`
- Removes `.git` suffix when present
- Critical for `git-nostr-bridge` API calls which expect just the repo name

---

## Common Pitfalls

1. **URL Encoding**
   - ❌ Encoding the entire path: `encodeURIComponent(\`${owner}/${repo}\`)`
   - ✅ Encoding parts separately: `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`

2. **API Endpoint Differences**
   - Different git servers use different API formats
   - Some use `/contents/`, others use `/files/` or `/raw/`
   - Branch parameter might be `ref`, `branch`, or part of the path

3. **Content Encoding**
   - GitHub returns base64-encoded content
   - Codeberg/Gitea also returns base64-encoded content
   - Need to decode for text files, keep as base64 for binary files

4. **Binary File Detection**
   - Check file extension
   - Check content type from API response
   - Check file size (large files are often binary)

5. **Strategy Order in File Opening**
   - ❌ Trying git-nostr-bridge API before embedded files
   - ✅ Always check embedded files FIRST, then git-nostr-bridge, then external APIs

6. **OwnerPubkey Resolution**
   - Must be consistent between file fetching and file opening
   - Check multiple sources: repoData, localStorage, decode npub, resolveEntityToPubkey

---

## Future Work: PRs, Issues, Commits, Releases for GRASP Repos

### Current State
- GitHub/Codeberg repos: Use their REST APIs for PRs, Issues, Commits, Releases
- GRASP repos: Currently only support file browsing via git-nostr-bridge
- Git protocol repos: Don't have REST APIs like GitHub

### Differences
**GitHub/Codeberg:**
- REST APIs for PRs, Issues, Commits, Releases
- Webhooks for real-time updates
- Rich metadata (labels, assignees, milestones, etc.)

**GRASP/Git Protocol:**
- No REST APIs - only git protocol
- PRs/Issues might be stored as Nostr events (NIP-34 or custom kind)
- Commits available via `git log` (git-nostr-bridge can provide)
- Releases might be git tags (git-nostr-bridge can list)

### Potential Solutions
1. **PRs/Issues**: Check for Nostr events (kind 30618 for issues, custom kind for PRs)
2. **Commits**: Use git-nostr-bridge API to run `git log` commands
3. **Releases**: Use git-nostr-bridge API to list git tags
4. **File History**: Use git-nostr-bridge API to run `git log --follow` for file

### Implementation Notes
- Need to create API endpoints in git-nostr-bridge for git commands
- Need to parse git output (commits, tags, etc.)
- Need to handle Nostr events for PRs/Issues if they exist
- May need to fall back to "Not available for git protocol repos" for some features

### Files to Update (Future)
- `ui/src/app/[entity]/[repo]/issues/page.tsx` - Check Nostr events for issues
- `ui/src/app/[entity]/[repo]/pulls/page.tsx` - Check Nostr events for PRs
- `ui/src/app/[entity]/[repo]/commits/page.tsx` - Use git-nostr-bridge API for git log
- `ui/src/app/[entity]/[repo]/releases/page.tsx` - Use git-nostr-bridge API for git tags
- `ui/src/pages/api/nostr/repo/commits.ts` - New endpoint for git log
- `ui/src/pages/api/nostr/repo/tags.ts` - New endpoint for git tags

---

## Push to Nostr Process

### File Content Source During Push

When pushing a repository to Nostr, the system uses the following strategy for file content:

1. **Primary Source: localStorage** - Files should already be present in `localStorage` from the create or import workflow
   - Created repos: Files are stored in `localStorage` during creation
   - Imported repos: Files are fetched and stored in `localStorage` during import
   
2. **Fallback: Bridge API** - If files are missing from `localStorage` (e.g., imported in a different browser), the system attempts to fetch them from the bridge API endpoint `/api/nostr/repo/file-content`
   - This is useful for imported repositories where files might already exist on the bridge but not in the current browser's `localStorage`
   - Files are fetched in batches (5 concurrent requests) to avoid overwhelming the API
   
3. **Exclusion** - Files without content are excluded from the bridge push with a warning
   - Directories are automatically excluded (no extension, no content)
   - Files that cannot be fetched from either source are excluded with a clear warning message

### Important Notes

- **No GitHub/GitLab Fetching During Push**: The push process does NOT fetch files from external sources (GitHub, GitLab, etc.) during push. Files must already be available in `localStorage` or on the bridge.
- **Workflow**: The expected workflow is:
  1. Create repository → Files stored in `localStorage` → Push to Nostr
  2. Import repository → Files fetched and stored in `localStorage` → Push to Nostr
  3. If files are missing, re-import the repository to load all files into `localStorage`

### Empty Commit File Preservation

**Problem**: When pushing to update commit dates (e.g., after refetching from GitHub with no local edits), the system creates an empty commit. This results in other clients showing no files because the latest commit has no file tree.

**Solution**: The push API (`/api/nostr/repo/push`) now preserves existing files when creating empty commits:
- If `files.length === 0` and the repo exists, the system copies all files from the existing repo into the temp directory before creating the commit
- This ensures that date-update commits preserve the previous state, allowing other clients to display files correctly
- The commit is still created with `--allow-empty` to ensure a new commit is always created with the current timestamp

**Implementation**:
- Location: `ui/src/pages/api/nostr/repo/push.ts` (lines 145-161)
- Uses `git clone` to get files from bare repo, then `rsync` to copy to temp directory
- Temp directories are automatically cleaned up in the `finally` block

### Implementation Details

- Location: `ui/src/lib/nostr/push-repo-to-nostr.ts` (lines 462-533) - File content fetching
- Location: `ui/src/pages/api/nostr/repo/push.ts` (lines 145-161) - Empty commit file preservation
- Bridge API fallback: Uses `/api/nostr/repo/file-content` endpoint
- Batch processing: Limits concurrent fetches to 5 files at a time
- Error handling: Gracefully excludes files that cannot be fetched, with clear warning messages

## Related Files

- `ui/src/app/[entity]/[repo]/page.tsx` - Main repository page, file list fetching and file opening
- `ui/src/pages/api/git/file-content.ts` - API proxy for file content fetching
- `ui/src/pages/api/nostr/repo/clone.ts` - Clone API endpoint for GRASP repos
- `ui/src/pages/api/nostr/repo/file-content.ts` - File content API for git-nostr-bridge
- `ui/src/lib/utils/git-source-fetcher.ts` - File list fetching utilities
- `ui/src/lib/utils/repo-finder.ts` - Repository matching utilities

---

## Performance and UX Issues

### Promise.race Implementation for File List Fetching (Fixed)

**Problem**: The system was waiting for ALL sources to finish before showing files, even though `Promise.race` was supposed to return on the first success. This caused long delays when some sources were slow or failing.

**Root Cause**: The original implementation used `forEach` with async callbacks, which doesn't work properly with `Promise.race`. The code was also using `Promise.allSettled` which waits for all promises to complete.

**Solution**: 
1. Wrap each fetch promise to resolve immediately on success, but never resolve on failure (using `await new Promise(() => {})` which never resolves)
2. Use `Promise.race` on the wrapped promises - the first success will resolve immediately
3. Continue updating statuses in the background using `Promise.allSettled` (non-blocking)

**Code Location**: `ui/src/lib/utils/git-source-fetcher.ts` (`fetchFilesFromMultipleSources` function)

**Key Change**:
```typescript
// Wrap each fetch promise - successes resolve immediately, failures never resolve
const successPromises = fetchPromises.map(async (p) => {
  try {
    const result = await p;
    if (result.success && result.files && Array.isArray(result.files) && result.files.length > 0) {
      return { files: result.files, statuses, success: true };
    }
    // Not a success - wait forever (never resolves, so Promise.race skips it)
    await new Promise(() => {}); // Never resolves
  } catch (error) {
    await new Promise(() => {}); // Never resolves
  }
});

// Race all promises - first success wins
const firstSuccessPromise = Promise.race(successPromises);
```

**Result**: Files are now displayed immediately when the first source succeeds, while other sources continue fetching in the background to update their statuses.

### HTML Preview Fix

**Problem**: HTML files were not rendering correctly in preview mode, showing blank or broken content.

**Root Cause**: 
1. HTML content might not have proper DOCTYPE/html structure
2. Missing error handling and logging
3. Sandbox permissions might be too restrictive

**Solution**:
1. Check if HTML content has proper structure (DOCTYPE or `<html>` tag)
2. If missing, wrap content in basic HTML structure: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>...</body></html>`
3. Add better logging to debug HTML preview issues
4. Add `allow-modals` to iframe sandbox permissions
5. Add `onLoad` and `onError` handlers for debugging

**Code Location**: `ui/src/app/[entity]/[repo]/page.tsx` (HTML preview rendering around line 5186)

**Result**: HTML files now render correctly in preview mode, with proper structure and better error handling.

### Git Server URL Pattern Recognition (Fixed)

**Problem**: Git servers like `git.vanderwarker.family/nostr/gpgstr.git` were not recognized as `nostr-git` sources because they don't have an `npub` in the path.

**Root Cause**: The `parseGitSource` function only matched URLs with the pattern `domain/npub.../repo`, missing alternative patterns.

**Solution**: Add an alternative pattern matcher for git servers without npub in path:
- Pattern: `https://git.vanderwarker.family/nostr/repo.git`
- Check if domain contains 'git', 'ngit', or 'nostr' to identify as git server
- Treat as `nostr-git` type but with empty npub and include path segment in repo name

**Code Location**: `ui/src/lib/utils/git-source-fetcher.ts` (`parseGitSource` function)

**Key Change**:
```typescript
// Alternative pattern for git servers without npub in path
const gitServerMatch = url.match(/^https?:\/\/([^\/]+)\/([^\/]+)\/([^\/]+)$/i);
if (gitServerMatch) {
  const [, domain, pathSegment, repo] = gitServerMatch;
  if (domain && (domain.includes('git') || domain.includes('ngit') || domain.includes('nostr'))) {
    return {
      type: "nostr-git",
      url: cloneUrl,
      displayName: domain,
      npub: "", // No npub in path
      repo: `${pathSegment}/${repo}`, // Include path segment in repo name
    };
  }
}
```

**Result**: Git servers with alternative URL patterns are now correctly identified and can be fetched.

### 15 Second Delay Before Fetching Starts

**Problem**: The repo page takes ~15 seconds before it even starts showing the fetching status. This makes users think the page is broken or the repo has no code, causing them to leave.

**Root Cause**: The file fetching `useEffect` was waiting for `resolvedOwnerPubkey` or `ownerPubkeyForLink` to be set from Nostr queries, which can take 10-15 seconds.

**Solution**: Resolve `ownerPubkey` immediately from `params.entity` (npub) using `nip19.decode()` instead of waiting for Nostr queries. This allows file fetching to start immediately when the page loads.

**Code Location**: `ui/src/app/[entity]/[repo]/page.tsx` (file fetching `useEffect` starting around line 983)

**Key Change**:
```typescript
// OLD: Waited for resolvedOwnerPubkey/ownerPubkeyForLink (15 second delay)
const hasOwnerPubkey = (resolvedOwnerPubkey && /^[0-9a-f]{64}$/i.test(resolvedOwnerPubkey)) ||
                      (ownerPubkeyForLink && /^[0-9a-f]{64}$/i.test(ownerPubkeyForLink));

// NEW: Resolve immediately from params.entity (npub)
if (params.entity && params.entity.startsWith("npub")) {
  try {
    const decoded = nip19.decode(params.entity);
    if (decoded.type === "npub" && /^[0-9a-f]{64}$/i.test(decoded.data as string)) {
      ownerPubkeyForFetch = decoded.data as string;
    }
  } catch (e) {
    // Fallback to resolvedOwnerPubkey/ownerPubkeyForLink if available
  }
}
```

### Fetch Status Display Issues

**Problem**: 
1. Status display shows "No files found" even when files are successfully fetched from other sources
2. Status display doesn't hide once files are loaded, showing confusing "failed" messages
3. Users see failed statuses from one relay but no indication that another relay succeeded

**Solution**: 
1. Hide status display once files are loaded and all sources are done
2. Show "✓ Files found, checking other sources..." when files are found but some sources are still fetching
3. Ensure all successful sources show "✓ Fetched" status, not just failures

**Code Location**: `ui/src/app/[entity]/[repo]/page.tsx` (status display around line 4720)

**Key Changes**:
- Hide status display when `hasFiles && allDone && !stillFetching`
- Show success message when files are found: "✓ Files found, checking other sources..."
- Update status display to show "✓ Fetched" for successful sources, "✗ No files found" for failed sources

---

### URL Encoding Issues with Repo Names

**Problem**: Repo names with spaces (e.g., "Swarm Relay") are URL-encoded as "Swarm%20Relay" in the URL, but the code was using `params.repo` directly without decoding, causing API calls and localStorage lookups to fail.

**Solution**: Decode `params.repo` immediately at the start of the component using `decodeURIComponent(params.repo)` and use `decodedRepo` throughout the component for all API calls, localStorage lookups, and file operations.

**Code Location**: `ui/src/app/[entity]/[repo]/page.tsx` (line 70)

**Key Change**:
```typescript
// At component start
const decodedRepo = decodeURIComponent(params.repo);

// Use decodedRepo everywhere instead of params.repo
const repo = findRepoByEntityAndName(repos, params.entity, decodedRepo);
const url = `/api/nostr/repo/files?ownerPubkey=${encodeURIComponent(ownerPubkey)}&repo=${encodeURIComponent(decodedRepo)}&branch=${encodeURIComponent(branch)}`;
```

### Infinite Loop in Push Button Check

**Problem**: The push button check was logging "Repo not found" on every render, causing console spam and potential performance issues.

**Solution**: Removed the console.log from the render function. The check still runs but doesn't spam the console. The infinite loop warning was likely from a different source (Radix UI component).

**Code Location**: `ui/src/app/[entity]/[repo]/page.tsx` (line 5387)

### Unused Variable Cleanup

**Problem**: `firstSuccessSource` variable in `git-source-fetcher.ts` was set but never used, causing confusion.

**Solution**: Removed the unused variable. The `firstSuccessFiles` variable is sufficient for tracking the first successful fetch.

**Code Location**: `ui/src/lib/utils/git-source-fetcher.ts` (line 641)

### Clone URLs for Embedded Files

**Note**: Clone URLs already display correctly for repos with embedded files. The code checks `repoData?.clone && repoData.clone.length > 0`, which works regardless of whether files are embedded or fetched from git servers.

---

### 15 Second Delay Before Fetching Starts (Fixed)

**Problem**: The page takes ~15 seconds before showing the "fetching" status. This is because:
1. The initial clone URL fetch happens immediately, but if no clone URLs are found initially, we wait for EOSE (which can take 15+ seconds)
2. The EOSE callback had a 1-second delay before processing
3. The timeout was 15 seconds (too long)

**Solution**: 
1. **Expand clone URLs immediately** when found (not just in EOSE callback) - this ensures all sources are tried and shown
2. **Reduce EOSE delay** from 1s to 200ms to start fetching faster
3. **Reduce timeout** from 15s to 3s as a final fallback (should rarely trigger)
4. **Show status for all expanded sources** - when a Nostr git URL is found, expand it to all known git servers and show status for all of them immediately
5. **Update files immediately** when first source succeeds (don't wait for all sources to complete)

**Code Location**: `ui/src/app/[entity]/[repo]/page.tsx` (lines 1238-1318 for immediate expansion, 2224 for EOSE delay, 2268 for timeout)

**Key Changes**:
- Clone URLs are expanded immediately when found (line 1238-1273)
- Status display shows all sources (including expanded ones) immediately (line 1295-1318)
- Files are updated immediately when first source succeeds (line 1348-1356)
- EOSE delay reduced to 200ms (line 2224)
- Timeout reduced to 3s and also expands clone URLs (line 2326-2357)

### Status Display for All Sources

**Problem**: Status display only shows one source at a time, or doesn't show all sources that are being tried. Users see "No files found" from one relay but don't see that other relays are still trying or have succeeded. Also, GitHub/Codeberg sources weren't showing their status.

**Solution**: 
1. **Expand clone URLs immediately** - when one Nostr git URL is found, expand it to all known git servers
2. **Show status for all sources** - the status display now shows all sources (including expanded ones, GitHub, Codeberg) with their individual statuses
3. **Update status in real-time** - each source's status is updated as it completes (success or failed)
4. **Always show status** - status display remains visible even after files are found, so users can see which sources succeeded/failed
5. **Update files immediately** - files are shown as soon as the first source succeeds, not waiting for all sources

**Code Location**: `ui/src/app/[entity]/[repo]/page.tsx` (status display logic around line 4809, expansion logic around line 1238)

**Key Changes**:
- All expanded clone URLs are added to the status display immediately
- GitHub/Codeberg sources are added to cloneUrls if sourceUrl is found (line 1230-1235)
- Each source shows its own status (pending, fetching, success, failed)
- Status updates happen in real-time via the `onStatusUpdate` callback
- Files are updated immediately when first source succeeds (line 1348-1356, 2205-2213)
- Status display always shows all sources (removed the logic that hid it after files were found)

---

### Deleted Repository Filtering

**Problem**: Deleted repositories were showing up in explore page, homepage recent repos, public profile pages, and "My repositories" page, even though they were marked as deleted.

**Solution**: Added comprehensive deleted repository filtering to all pages that display repository lists:
1. **Explore page** - Filters deleted repos in `filteredRepos` useMemo
2. **My repositories page** - Filters deleted repos before ownership checks
3. **Homepage (recent repos)** - Already had filtering (verified)
4. **Public profile page** - Already had filtering (verified)

**Filtering Logic**:
- Check locally-deleted repos (from `gittr_deleted_repos` localStorage)
- Check repos marked as `deleted === true` on Nostr
- Check repos marked as `archived === true` on Nostr
- Uses robust matching that handles:
  - Direct entity/repo name matching
  - ownerPubkey matching (handles npub entity format mismatches)
  - npub decoding for cross-format matching

**Code Locations**:
- `ui/src/app/explore/page.tsx` (line 1367-1407)
- `ui/src/app/repositories/page.tsx` (line 1215-1255)
- `ui/src/app/page.tsx` (line 157-206) - already implemented
- `ui/src/app/[entity]/page.tsx` (line 733-750) - already implemented

**Result**: Deleted repositories are now completely hidden from all repository listing pages, ensuring users only see active repositories.

---

*Last updated: After fixing deleted repo filtering across all pages, Promise.race implementation, HTML preview, and git server URL pattern recognition*
