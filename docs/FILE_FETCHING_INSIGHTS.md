# File Fetching Insights & Best Practices

This document captures insights and patterns discovered while implementing file fetching from various git servers (GitHub, GitLab, Codeberg, GRASP servers).

> **Badge legend:** 🆕 denotes gittr.space-specific logic layered on top of @spearson78’s gitnostr
> baseline so contributors know what still needs to be upstreamed.

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

**Location**: `ui/src/app/[entity]/[repo]/page.tsx` (main file list fetching `useEffect` - search for "File List Fetching Flow" or "useEffect.*files")

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
   │   ├─ GitLab → API: /api/v4/projects/{path}/repository/tree?recursive=true
   │   ├─ Codeberg → API: /api/v1/repos/{owner}/{repo}/git/trees/{branch}?recursive=true
   │   └─ GRASP → Try HTTP API patterns (Gitea-style, GitLab-style, etc.)
   └─ First success → Use files ✅
  ↓
5. Update repoData state and localStorage
```

### Key Implementation Details

- **Strict matching**: Entity AND repo name must match for localStorage
- **Npub decoding**: Converts npub to pubkey for comparison
- **🆕 Automatic cloning**: GRASP repos trigger clone if not found locally
- **🆕 Background polling**: Uses custom events (`grasp-repo-cloned`) for non-blocking updates

---

## File Opening Flow - Correct Strategy Order

**Location**: `ui/src/app/[entity]/[repo]/page.tsx` (`fetchGithubRaw` function - search for "fetchGithubRaw" or "Strategy 1: Check localStorage")

### CRITICAL: Strategy Order

The correct order is **critical** for file opening to work. The system uses a 6-strategy fallback chain to ensure files can be fetched from any source:

1. **Strategy 1: Check localStorage for local repos** (no sourceUrl, no cloneUrls)
2. **Strategy 2: Check embedded files** (files stored directly in Nostr event)
3. **Strategy 3: Multi-source fetch** (if repo has clone URLs - tries all in parallel)
4. **Strategy 4: Query Nostr for NIP-34 events** (fallback if clone URLs not available)
5. **Strategy 5: Try git-nostr-bridge API** (fallback for local/GRASP repos)
6. **Strategy 6: Try external git servers via API proxy** (final fallback - GitHub, GitLab, Codeberg)

### Flow Diagram

```
User clicks on a file
  ↓
Strategy 1: Check localStorage for local repos (no sourceUrl, no cloneUrls)
   ├─ If files found in localStorage → Use local files ✅
   └─ If not found → Continue to Strategy 2
  ↓
Strategy 2: Check if file content is embedded in repoData.files array
   ├─ If found with content → Use embedded content ✅
   └─ If not found → Continue to Strategy 3
  ↓
Strategy 3: Multi-source fetch (if repo has clone URLs)
   ├─ Try all clone URLs in parallel:
   │   ├─ 🆕 GRASP servers → /api/nostr/repo/file-content → git-nostr-bridge
   │   │   ├─ 🆕 If 404 → /api/nostr/repo/clone → Poll (max 10 attempts, 2s delay) ✅
   │   │   └─ If success → Use content from bridge ✅
   │   ├─ GitHub → /api/git/file-content?sourceUrl=...&path=...&branch=...
   │   ├─ GitLab → /api/git/file-content?sourceUrl=...&path=...&branch=...
   │   ├─ Codeberg → /api/git/file-content?sourceUrl=...&path=...&branch=...
   │   └─ Other GRASP servers → /api/git/file-content?sourceUrl=... → forwards to bridge API
   ├─ 🆕 If GRASP server returns 404 → Trigger clone → Poll (max 10 attempts, 2s delay) ✅
   └─ If all fail → Continue to Strategy 4
  ↓
Strategy 4: Query Nostr for NIP-34 repository events
   ├─ Subscribe to kind 30617 events with "#d" tag matching repo name
   ├─ Extract files from event content (if embedded)
   └─ Extract clone URLs and sourceUrl from event tags
  ↓
Strategy 5: Try git-nostr-bridge API (fallback)
   ├─ Resolve ownerPubkey:
   │   ├─ Check repoData.ownerPubkey
   │   ├─ Check localStorage for matching repo
   │   ├─ Decode npub from params.entity
   │   └─ Fallback to resolveEntityToPubkey utility
   ├─ Success → Use content from git-nostr-bridge ✅
   ├─ 404 (not cloned) → Check if GRASP server
   │   ├─ If GRASP → Trigger clone → Poll (max 10 attempts, 2s delay) ✅
   │   └─ If not GRASP → Continue to Strategy 6
   └─ Error → Continue to Strategy 6
  ↓
Strategy 6: Try external git servers via API proxy (final fallback)
   ├─ GitHub → /api/git/file-content?sourceUrl=...&path=...&branch=...
   ├─ GitLab → /api/git/file-content?sourceUrl=...&path=...&branch=...
   ├─ Codeberg → /api/git/file-content?sourceUrl=...&path=...&branch=...
   └─ Note: SSH URLs (git@host:path) are normalized to HTTPS before API calls
  ↓
Handle binary vs text files
   ├─ Binary → Return base64, frontend creates data URL
   └─ Text → Return UTF-8 content
```

### Why This Order Matters

**localStorage is checked FIRST** because:
- Local repos (created in browser) have no sourceUrl or cloneUrls
- Files are stored directly in localStorage for instant access
- No network calls needed for local repos

**Embedded files are checked second** because:
- Some GRASP repos have files embedded in Nostr events even when clone URLs exist
- Embedded content is the most reliable source (no network calls needed)
- Legacy repos store files directly in events

**Multi-source fetch (Strategy 3) tries all clone URLs in parallel** because:
- Repos may have multiple clone URLs (GitHub, GitLab, GRASP servers)
- Parallel fetching ensures fastest response time
- GRASP servers automatically trigger cloning if repo not found locally

**Nostr query (Strategy 4) is a fallback** because:
- Used when clone URLs are not available in repoData
- Fetches fresh NIP-34 events from relays
- Can extract embedded files or clone URLs from events

**git-nostr-bridge API (Strategy 5) is a fallback** because:
- It's the primary method for repos that have been cloned locally
- For GRASP repos, it requires the repo to be cloned first
- It's faster than external API calls when available

**External git servers (Strategy 6) are the final fallback** because:
- They require network calls
- They're used when all other strategies fail
- **Note**: For GRASP servers, `/api/git/file-content` detects them and forwards to bridge API (same as Strategy 5)

### OwnerPubkey Resolution (Strategies 3 & 5)

The ownerPubkey resolution is used in Strategy 3 (multi-source fetch for GRASP servers) and Strategy 5 (git-nostr-bridge API fallback). The resolution follows this priority:

1. **repoData.ownerPubkey** (if set during file fetching)
2. **localStorage** (check for matching repo by entity+name)
3. **Decode npub** from `params.entity` (most reliable for GRASP repos)
4. **resolveEntityToPubkey utility** (final fallback)

This ensures consistency - if files were fetched successfully, file opening will work too.

### OwnerPubkey Resolution (Strategies 3 & 5)

The ownerPubkey resolution follows this priority:

1. **repoData.ownerPubkey** (if set during file fetching)
2. **localStorage** (check for matching repo by entity+name)
3. **Decode npub** from `params.entity` (most reliable for GRASP repos)
4. **resolveEntityToPubkey utility** (final fallback)

This ensures consistency - if files were fetched successfully, file opening will work too.

### Code Reference

```typescript
// Strategy 1: Check localStorage for local repos
if (!repoData?.sourceUrl && (!repoData?.clone || repoData.clone.length === 0)) {
  const localRepo = findRepoByEntityAndName(repos, params.entity, decodedRepo);
  if (localRepo?.files) {
    const fileEntry = localRepo.files.find((f: any) => f.path === filePath);
    if (fileEntry?.content) {
      return { content: fileEntry.content, url: null, isBinary: false };
    }
  }
}

// Strategy 2: Check embedded files
if (repoData?.files && Array.isArray(repoData.files)) {
  const fileEntry = repoData.files.find((f: any) => {
    // Match file by path...
  });
  if (fileEntry && foundContent) {
    // Use embedded content - return immediately
    return { content: foundContent, url: null, isBinary: false };
  }
}

// Strategy 3: Multi-source fetch (parallel attempts on all clone URLs)
if (repoData?.clone && Array.isArray(repoData.clone) && repoData.clone.length > 0) {
  // Try all clone URLs in parallel
  for (const cloneUrl of repoData.clone) {
    // GRASP servers → bridge API
    // GitHub/GitLab/Codeberg → /api/git/file-content
    // Handle 404 for GRASP → trigger clone → poll
  }
}

// Strategy 4: Query Nostr for NIP-34 events
// Subscribe to kind 30617 events, extract files/clone URLs

// Strategy 5: Try git-nostr-bridge API (fallback)
let ownerPubkey = (repoData as any)?.ownerPubkey;
// Resolve ownerPubkey (check localStorage, decode npub, etc.)
if (ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey)) {
  const apiUrl = `/api/nostr/repo/file-content?ownerPubkey=...&repo=...&path=...&branch=...`;
  const response = await fetch(apiUrl);
  if (response.ok) {
    // Use content from git-nostr-bridge
    return { content: data.content, url: null, isBinary: false };
  } else if (response.status === 404 && isGraspRepo) {
    // Trigger clone and poll...
  }
}

// Strategy 6: Try external git servers via API proxy (final fallback)
const apiUrl = `/api/git/file-content?sourceUrl=...&path=...&branch=...`;
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
// File list
`https://gitlab.com/api/v4/projects/${encodeURIComponent(`${owner}/${repo}`)}/repository/tree?recursive=true&ref=${branch}`

// File content
`https://gitlab.com/api/v4/projects/${encodeURIComponent(`${owner}/${repo}`)}/repository/files/${encodeURIComponent(filePath)}/raw?ref=${branch}`
```

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

### 1. **localStorage First (Strategy 1)**

- Local repos (created in browser) have no sourceUrl or cloneUrls
- Files are stored directly in localStorage for instant access
- No network calls needed for local repos
- **Critical**: This must be Strategy 1 to handle repos created entirely in the browser

### 2. **Embedded Files Second (Strategy 2)**

- Files embedded in Nostr events are checked after localStorage
- This handles legacy repos and small files that are stored directly in events
- Some GRASP repos have files embedded even when clone URLs exist
- **Critical**: Embedded files must be checked before attempting network calls

### 3. **Multi-Source Parallel Fetch (Strategy 3)**

- Tries all clone URLs in parallel for fastest response
- GRASP servers automatically trigger cloning if repo not found locally
- GitHub, GitLab, Codeberg APIs are tried simultaneously
- First success wins, others continue in background for status updates

### 4. **Nostr Query Fallback (Strategy 4)**

- Used when clone URLs are not available in repoData
- Fetches fresh NIP-34 events from relays
- Can extract embedded files or clone URLs from events
- Ensures repos can be accessed even if initial event data is incomplete

### 5. **git-nostr-bridge API Fallback (Strategy 5)**

- `git-nostr-bridge` is the primary method for repos that have been cloned locally
- For GRASP servers that don't expose HTTP API, automatic cloning ensures files are available
- OwnerPubkey resolution must be consistent between file fetching and file opening
- Used as fallback when Strategy 3 fails or clone URLs aren't available

### 6. **External Git Servers Final Fallback (Strategy 6)**

- GitHub, GitLab, Codeberg APIs are used as final fallback when:
  - Repo is imported from external git server
  - All previous strategies have failed
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
   - ❌ Trying git-nostr-bridge API before embedded files or localStorage
   - ✅ Always check localStorage FIRST, then embedded files, then multi-source fetch, then Nostr query, then bridge API, then external APIs

6. **OwnerPubkey Resolution**
   - Must be consistent between file fetching and file opening
   - Check multiple sources: repoData, localStorage, decode npub, resolveEntityToPubkey

---

## PRs, Issues, Commits, Releases Handling

### Current Implementation

**GitHub/Codeberg Repos:**
- **Source of Truth**: GitHub/Codeberg REST APIs are the primary source
- **Fetching**: Issues, PRs, commits, and releases are fetched during import and refetch operations via `/api/import`
- **Storage**: Data is stored in both:
  - Repo object in localStorage (`repo.issues`, `repo.pulls`, `repo.commits`, `repo.releases`)
  - Separate localStorage keys (`gittr_issues`, `gittr_prs`, `gittr_commits`) for display pages
- **Refetch**: When refetching a repo, issues/PRs/commits are re-fetched from GitHub API and saved (even if empty arrays)
- **Nostr Sync**: PRs and issues created via the web UI are published as Nostr events (kinds 9803/9804), but GitHub source takes precedence

**Nostr Events for PRs/Issues:**
- **Issue Events**: Kind 9803 (custom, not NIP-34 replaceable)
- **PR Events**: Kind 9804 (custom, not NIP-34 replaceable)
- **Repository Events**: 
  - **Kind 30617** (NIP-34: Replaceable Events) - Repository metadata (primary method, used for publishing)
  - **Kind 51** (gitnostr: Repository) - Legacy format (only read for backwards compatibility, never published)
- **Note**: PRs/issues use custom kinds, not NIP-34 replaceable events, so they don't follow the replaceable event pattern
- **Publishing**: gittr.space ONLY publishes repository announcements as Kind 30617 (NIP-34 replaceable events). Kind 51 is never published, only read for legacy repository compatibility.
- **🆕 Automatic Publishing**:
  - Issues are automatically published to Nostr when created
  - PRs are automatically published to Nostr when created
  - When a PR is merged, an updated event with status "merged" is automatically published
  - When an issue is closed/reopened, an updated event with the new status is automatically published
  - All status updates reference the original event via `["e", originalEventId, "", "previous"]` tag
- **Sync Behavior**: For GitHub repos, GitHub API is the source of truth. Nostr events are synced but GitHub data takes precedence when both exist. Nostr-only issues/PRs (from other clients) are preserved when fetching from GitHub.

**GRASP/Git Protocol Repos:**
- Currently only support file browsing via git-nostr-bridge
- PRs/Issues: Can be created via web UI and published as Nostr events (kinds 9803/9804)
- Commits: Available via `git log` (git-nostr-bridge can provide)
- Releases: Might be git tags (git-nostr-bridge can list)

### Differences
**GitHub/Codeberg:**
- REST APIs for PRs, Issues, Commits, Releases
- Webhooks for real-time updates (not yet implemented)
- Rich metadata (labels, assignees, milestones, etc.)
- GitHub API is source of truth, Nostr events are secondary

**GRASP/Git Protocol:**
- No REST APIs - only git protocol
- PRs/Issues stored as Nostr events (kinds 9803/9804, custom kinds)
- Commits available via `git log` (git-nostr-bridge can provide)
- Releases might be git tags (git-nostr-bridge can list)

### Future Work
1. **PRs/Issues for GRASP repos**: Better integration with Nostr events (kinds 9803/9804)
2. **Commits for GRASP repos**: Use git-nostr-bridge API to run `git log` commands
3. **Releases for GRASP repos**: Use git-nostr-bridge API to list git tags
4. **File History**: Use git-nostr-bridge API to run `git log --follow` for file
5. **Webhooks**: Implement webhook support for GitHub/Codeberg repos for real-time updates

### Implementation Notes
- GitHub repos: Always fetch from GitHub API during import/refetch
- Nostr events: Subscribe to kinds 9803/9804 for PRs/issues created via web UI
- Storage: Save to both repo object and separate localStorage keys for display
- Refetch: Always save data (even if empty) to clear stale localStorage data
- Priority: GitHub API > Nostr events for GitHub repos
- `ui/src/app/[entity]/[repo]/releases/page.tsx` - Use git-nostr-bridge API for git tags
- `ui/src/pages/api/nostr/repo/commits.ts` - New endpoint for git log
- `ui/src/pages/api/nostr/repo/tags.ts` - New endpoint for git tags

---

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

**Code Location**: `ui/src/app/[entity]/[repo]/page.tsx` (HTML preview rendering - search for "HTML preview" or "iframe.*sandbox")

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

**Code Location**: `ui/src/app/[entity]/[repo]/page.tsx` (file fetching `useEffect` - search for "resolvedOwnerPubkey" or "ownerPubkeyForLink" in useEffect)

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

**Code Location**: `ui/src/app/[entity]/[repo]/page.tsx` (status display logic - search for "fetchStatus" or "status display" or "No files found")

**Key Changes**:
- Hide status display when `hasFiles && allDone && !stillFetching`
- Show success message when files are found: "✓ Files found, checking other sources..."
- Update status display to show "✓ Fetched" for successful sources, "✗ No files found" for failed sources

---

### URL Encoding Issues with Repo Names

**Problem**: Repo names with spaces (e.g., "Swarm Relay") are URL-encoded as "Swarm%20Relay" in the URL, but the code was using `params.repo` directly without decoding, causing API calls and localStorage lookups to fail.

**Solution**: Decode `params.repo` immediately at the start of the component using `decodeURIComponent(params.repo)` and use `decodedRepo` throughout the component for all API calls, localStorage lookups, and file operations.

**Code Location**: `ui/src/app/[entity]/[repo]/page.tsx` (component start - search for "decodeURIComponent" or "decodedRepo")

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

**Code Location**: `ui/src/app/[entity]/[repo]/page.tsx` (push button check - search for "push button" or "Repo not found" log)

### Unused Variable Cleanup

**Problem**: `firstSuccessSource` variable in `git-source-fetcher.ts` was set but never used, causing confusion.

**Solution**: Removed the unused variable. The `firstSuccessFiles` variable is sufficient for tracking the first successful fetch.

**Code Location**: `ui/src/lib/utils/git-source-fetcher.ts` (`fetchFilesFromSource` function - search for "firstSuccessSource" or "firstSuccessFiles")

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

**Code Location**: `ui/src/app/[entity]/[repo]/page.tsx` (search for: "expand clone URLs immediately", "EOSE delay", "timeout" in file fetching logic)

**Key Changes**:
- Clone URLs are expanded immediately when found (search for "expandCloneUrls" or "immediately expand")
- Status display shows all sources (including expanded ones) immediately (search for "status display" or "all sources")
- Files are updated immediately when first source succeeds (search for "firstSuccessFiles" or "update files immediately")
- EOSE delay reduced to 200ms (search for "EOSE" or "isAfterEose" with delay)
- Timeout reduced to 3s and also expands clone URLs (search for "timeout" or "setTimeout" in file fetching)

### Status Display for All Sources

**Problem**: Status display only shows one source at a time, or doesn't show all sources that are being tried. Users see "No files found" from one relay but don't see that other relays are still trying or have succeeded. Also, GitHub/Codeberg sources weren't showing their status.

**Solution**: 
1. **Expand clone URLs immediately** - when one Nostr git URL is found, expand it to all known git servers
2. **Show status for all sources** - the status display now shows all sources (including expanded ones, GitHub, Codeberg) with their individual statuses
3. **Update status in real-time** - each source's status is updated as it completes (success or failed)
4. **Always show status** - status display remains visible even after files are found, so users can see which sources succeeded/failed
5. **Update files immediately** - files are shown as soon as the first source succeeds, not waiting for all sources

**Code Location**: `ui/src/app/[entity]/[repo]/page.tsx` (search for: "status display logic" or "fetchStatus" for status, "expandCloneUrls" or "immediately expand" for expansion)

**Key Changes**:
- All expanded clone URLs are added to the status display immediately
- GitHub/Codeberg sources are added to cloneUrls if sourceUrl is found (search for "sourceUrl" or "GitHub.*cloneUrls")
- Each source shows its own status (pending, fetching, success, failed)
- Status updates happen in real-time via the `onStatusUpdate` callback
- Files are updated immediately when first source succeeds (search for "firstSuccessFiles" or "update files immediately")
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
- `ui/src/app/explore/page.tsx` (search for "filteredRepos" or "deleted.*filter" in useMemo)
- `ui/src/app/repositories/page.tsx` (search for "deleted.*filter" or "isDeleted" before ownership checks)
- `ui/src/app/page.tsx` (search for "deleted.*filter" in recent repos) - already implemented
- `ui/src/app/[entity]/page.tsx` (search for "deleted.*filter" in public profile) - already implemented

**Result**: Deleted repositories are now completely hidden from all repository listing pages, ensuring users only see active repositories.

### Files Disappearing on Viewport Resize (Fixed)

**Problem**: When the browser window was resized to mobile size (or opened on mobile), files would disappear and show "No files found", even if they were successfully fetched on desktop. This was a confusing UX issue that made users think the repo had no files.

**Root Cause**: When the viewport changed, React would re-render and the `useEffect` that loads repo data from localStorage would run again. If the repo lookup temporarily failed (due to timing or a temporary localStorage issue), it would create a minimal `repoData` with empty files, clearing the existing files that were already loaded.

**Solution**: 
1. **Preserve existing files** when repo is not found in localStorage - if `repoData.files` already exists, preserve it instead of clearing
2. **Prevent unnecessary re-runs** - if the repo is already processed AND files exist, don't re-run the useEffect even if the repo is found again
3. **Preserve files in deleted repo case** - even if a repo is marked as deleted, preserve existing files to prevent clearing on resize

**Code Location**: `ui/src/app/[entity]/[repo]/page.tsx` (main repo loading `useEffect` - search for "repoProcessedRef" or "Preserve existing files")

**Key Changes**:
```typescript
// Guard: If repo already processed AND files exist, don't re-run
if (repoProcessedRef.current === repoKey) {
  if (repoData?.files && Array.isArray(repoData.files) && repoData.files.length > 0) {
    return; // Preserve existing files
  }
}

// When repo not found, preserve existing files instead of clearing
const existingFiles = repoData?.files && Array.isArray(repoData.files) && repoData.files.length > 0 
  ? repoData.files 
  : [];
setRepoData({
  // ... other fields ...
  files: existingFiles, // Preserve instead of always clearing
});
```

**Result**: Files now persist across viewport changes, ensuring a consistent user experience on both desktop and mobile. Files remain visible even when the window is resized or the page is opened on mobile devices.

---

*Last updated: Updated file opening flow to match 6-strategy flow from README.md (localStorage → embedded → multi-source → Nostr query → bridge API → external servers)*
