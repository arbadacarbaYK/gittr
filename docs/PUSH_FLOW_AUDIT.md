# Push Flow Audit - Complete Data Flow Analysis

## Overview

This document audits the complete push flow to identify where data comes from, when it's collected, and where it goes.

## Three Repository Flows

### 1. New Repo Created on gittr
- **File Source**: Files are created/edited in the UI and stored in `localStorage` overrides
- **Storage Key**: `gittr_overrides__{entity}__{repo}`
- **File List**: Stored in `gittr_files__{entity}__{repo}` (may be empty initially)
- **Push Flow**: 
  1. Load files from `repo.files` (localStorage)
  2. Merge with overrides
  3. Push to bridge
  4. Publish events

### 2. Batch/Imported from GitHub
- **File Source**: Files are fetched from GitHub API during import
- **Storage Key**: `gittr_files__{entity}__{repo}` (with file metadata)
- **Content**: May or may not have content (depends on import process)
- **Push Flow**:
  1. Load files from `repo.files` (localStorage)
  2. If files lack content, fetch from bridge API or GitHub
  3. Emergency fallback: Fetch ALL files from GitHub if localStorage is empty
  4. Push to bridge
  5. Publish events

### 3. Single Repo Imported from Other Sources
- **File Source**: Files are fetched from source (GitLab, Codeberg, etc.)
- **Storage Key**: `gittr_files__{entity}__{repo}`
- **Content**: May or may not have content
- **Push Flow**: Same as batch import

## File Collection During Push

### Step 1: Load from localStorage
```typescript
const allFiles = (repo.files && Array.isArray(repo.files)) ? [...repo.files] : [];
```
- **Source**: `repo.files` from localStorage
- **Location**: `ui/src/lib/nostr/push-repo-to-nostr.ts:305`
- **Issue**: If `repo.files` is empty or missing, no files are loaded

### Step 2: Merge with Overrides
```typescript
const savedOverrides = loadRepoOverrides(entity, repoSlug);
```
- **Source**: `gittr_overrides__{entity}__{repo}` from localStorage
- **Location**: `ui/src/lib/nostr/push-repo-to-nostr.ts:291-293`
- **Issue**: Overrides may not have all files if repo was imported

### Step 3: Build bridgeFilesMap
```typescript
const bridgeFilesMap = new Map<string, BridgeFilePayload>();
```
- **Purpose**: Collect all files that need to be pushed to bridge
- **Content Source Priority**:
  1. `savedOverrides[filePath]` or `savedOverrides[normalizedPath]`
  2. `file.content` directly
  3. `file.data` (alternative field)
- **Location**: `ui/src/lib/nostr/push-repo-to-nostr.ts:368-482`

### Step 4: Fetch Missing Content
If files lack content, they're fetched from:
1. **Bridge API**: `/api/nostr/repo/file-content?ownerPubkey={pubkey}&repo={repo}&path={path}`
2. **Source (GitHub/GitLab/Codeberg)**: Raw URLs or API endpoints
- **Location**: `ui/src/lib/nostr/push-repo-to-nostr.ts:573-723`

### Step 5: Emergency Fallback
If `bridgeFilesMap.size === 0`:
1. Fetch file tree from GitHub API
2. Add ALL files to `bridgeFilesMap` (no limit)
3. Fetch content for ALL files (no limit)
- **Location**: `ui/src/lib/nostr/push-repo-to-nostr.ts:740-824`

### Step 6: Emergency Fallback 2
If `filesForBridge.length === 0` but `bridgeFilesMap.size > 0`:
1. Fetch ALL files from GitHub (no limit)
2. Add content to `bridgeFilesMap`
- **Location**: `ui/src/lib/nostr/push-repo-to-nostr.ts:828-887`

## Repository Name Resolution

### actualRepositoryName Derivation
```typescript
let actualRepositoryName = repoDataAny?.repositoryName || repoDataAny?.repo || repoDataAny?.slug || repoSlug;
```
- **Priority**: `repositoryName` > `repo` > `slug` > `repoSlug` (parameter)
- **Normalization**: Removes `.git` suffix, extracts last part if path contains `/`
- **Location**: `ui/src/lib/nostr/push-repo-to-nostr.ts:99-106`

### Usage
- **Bridge Push**: `repoSlug: actualRepositoryName` (line 1425)
- **Bridge API Calls**: `repo=${encodeURIComponent(actualRepositoryName)}`
- **Clone URLs**: `/${npub}/${actualRepositoryName}.git`
- **Event Tags**: `["d", actualRepositoryName]`

### Critical Issue
If `actualRepositoryName` doesn't match what's stored in the bridge, files won't be found. The bridge stores repos as:
```
{reposDir}/{ownerPubkey}/{repoName}.git
```

## Bridge Filesystem Path

### Path Format
```typescript
const repoPath = join(reposDir, ownerPubkey, `${repoName}.git`);
```
- **reposDir**: From env var or config file (default: `~/git-nostr-repositories`)
- **ownerPubkey**: 64-char hex (lowercase)
- **repoName**: From API request `repo` parameter
- **Location**: `ui/src/pages/api/nostr/repo/push.ts:141`

### Symlink for npub Compatibility
The bridge creates a symlink:
```
reposDir/npub1... -> reposDir/{hexPubkey}
```
- **Purpose**: Allow clone URLs to use npub format
- **Location**: Bridge code (not in this repo)

## Event Structure

### Clone URLs
- **Format**: `https://git.gittr.space/npub1.../repo.git`
- **Uses**: npub format (per NIP-34 spec)
- **Location**: `ui/src/lib/nostr/push-repo-to-nostr.ts:241`
- **Issue**: gitworkshop.dev shows this as "git server" not "GRASP server" because there's no matching `wss://git.gittr.space` relay. This is CORRECT - git.gittr.space is a git server, not a relay.

### Relay Tags
- **Format**: Separate tags per relay: `["relays", "wss://relay1.com"]`, `["relays", "wss://relay2.com"]`
- **Source**: Only relays that exist in `defaultRelays`
- **Location**: `ui/src/lib/nostr/push-repo-to-nostr.ts:1032-1039`
- **Issue**: gitworkshop.dev recognizes GRASP servers only if relay URL matches clone URL domain. Since `wss://git.gittr.space` doesn't exist, git.gittr.space won't be recognized as a GRASP server. This is correct behavior.

## Issues Found

### Issue 1: File Collection May Fail
**Problem**: If `repo.files` is empty or files lack content, emergency fallback may not work if:
- GitHub API rate limit is hit
- Source URL is missing or invalid
- Network errors occur

**Fix Needed**: Ensure emergency fallback is more robust and logs errors clearly.

### Issue 2: Repository Name Mismatch
**Problem**: If `actualRepositoryName` doesn't match what's stored in bridge, files won't be found.

**Fix Needed**: Verify `actualRepositoryName` matches bridge storage. Add logging to show what name is used.

### Issue 3: Files Not Collected for All Flows
**Problem**: For imported repos, files may not be in localStorage with content.

**Fix Needed**: Ensure all three flows (new, batch import, single import) store files with content in localStorage.

## Recommendations

1. **Add Logging**: Log `actualRepositoryName` at every step to verify consistency
2. **Verify Bridge Path**: Check that files are written to correct path
3. **Test All Flows**: Verify new repo, batch import, and single import all work
4. **Emergency Fallback**: Make it more robust with better error handling
5. **File Content Validation**: Ensure files have content before pushing to bridge

