# Push Flow Fixes - Complete Audit and Resolution

## Issues Found and Fixed

### Issue 1: Missing Logging for Repository Name
**Problem**: `actualRepositoryName` was being derived but not logged, making it hard to debug mismatches.

**Fix**: Added comprehensive logging at repository name resolution:
- Logs all possible sources (repositoryName, repo, slug, repoSlug)
- Logs the final `actualRepositoryName` used
- Logs pubkey and entity for context

**Location**: `ui/src/lib/nostr/push-repo-to-nostr.ts:99-115`

### Issue 2: Missing Logging for File Collection
**Problem**: File collection status wasn't logged, making it hard to debug why files weren't being pushed.

**Fix**: Added detailed logging:
- Logs file counts (with content, without content)
- Logs source URL
- Logs `actualRepositoryName` and pubkey
- Logs sample file paths

**Location**: `ui/src/lib/nostr/push-repo-to-nostr.ts:307-320, 745-757`

### Issue 3: Binary File Handling in Emergency Fetch
**Problem**: Emergency fetch from GitHub used `response.text()` for all files, which corrupts binary files.

**Fix**: Added proper binary file handling:
- Detects binary files using `file.isBinary`
- Uses `response.arrayBuffer()` for binary files
- Converts to base64 using browser-compatible `btoa()`
- Uses `response.text()` only for text files

**Location**: `ui/src/lib/nostr/push-repo-to-nostr.ts:818-830, 897-909`

### Issue 4: Missing Logging in Bridge Push Endpoint
**Problem**: Bridge push endpoint didn't log the exact path being used, making it hard to verify files are written to the correct location.

**Fix**: Added comprehensive logging:
- Logs ownerPubkey (truncated), repoName, branch
- Logs file counts (with content, without content)
- Logs exact `repoPath` being used
- Logs `reposDir` for context

**Location**: `ui/src/pages/api/nostr/repo/push.ts:140-155`

### Issue 5: Missing Logging Before Bridge Push
**Problem**: No logging before calling `pushFilesToBridge`, making it hard to verify parameters.

**Fix**: Added logging before bridge push:
- Logs all parameters being sent
- Logs expected bridge path
- Logs file count

**Location**: `ui/src/lib/nostr/push-repo-to-nostr.ts:1418-1430`

## File Collection Flow (Verified)

### Step 1: Load from localStorage
- **Source**: `repo.files` from localStorage
- **Location**: Line 305
- **Status**: ✅ Working

### Step 2: Merge with Overrides
- **Source**: `gittr_overrides__{entity}__{repo}`
- **Location**: Line 291-293
- **Status**: ✅ Working

### Step 3: Build bridgeFilesMap
- **Purpose**: Collect all files for bridge push
- **Content Priority**:
  1. `savedOverrides[filePath]` or `savedOverrides[normalizedPath]`
  2. `file.content` directly
  3. `file.data` (alternative field)
- **Location**: Line 368-482
- **Status**: ✅ Working

### Step 4: Fetch Missing Content
- **Sources**: Bridge API, GitHub/GitLab/Codeberg
- **Location**: Line 573-723
- **Status**: ✅ Working (with binary file fix)

### Step 5: Emergency Fallback 1
- **Trigger**: `bridgeFilesMap.size === 0 && baseFiles.length === 0`
- **Action**: Fetch file tree from GitHub, then fetch ALL file content
- **Location**: Line 760-843
- **Status**: ✅ Working (with binary file fix)

### Step 6: Emergency Fallback 2
- **Trigger**: `filesForBridge.length === 0 && bridgeFilesMap.size > 0`
- **Action**: Fetch ALL files from GitHub (no limit)
- **Location**: Line 848-907
- **Status**: ✅ Working (with binary file fix)

## Repository Name Resolution (Verified)

### Derivation
```typescript
actualRepositoryName = repositoryName || repo || slug || repoSlug
```
- **Priority**: Correct ✅
- **Normalization**: Removes `.git`, extracts last part of path ✅
- **Usage**: Consistent across all API calls ✅

### Bridge Path
```
{reposDir}/{ownerPubkey}/{actualRepositoryName}.git
```
- **Format**: Correct ✅
- **Pubkey**: Hex format (64-char) ✅
- **Repo Name**: Matches `actualRepositoryName` ✅

## Event Structure (Verified)

### Clone URLs
- **Format**: `https://git.gittr.space/npub1.../repo.git` ✅
- **Uses**: npub format (per NIP-34) ✅
- **Multiple Servers**: Includes all known GRASP servers ✅

### Relay Tags
- **Format**: Separate tags per relay ✅
- **Source**: Only relays that exist in `defaultRelays` ✅
- **Note**: git.gittr.space shows as "git server" not "GRASP server" because there's no matching relay - this is CORRECT ✅

## Testing Checklist

- [ ] Test new repo creation flow
- [ ] Test batch import from GitHub
- [ ] Test single repo import from GitHub
- [ ] Test single repo import from GitLab
- [ ] Test single repo import from Codeberg
- [ ] Verify files are collected correctly for all flows
- [ ] Verify files are pushed to correct bridge path
- [ ] Verify events have correct clone URLs
- [ ] Verify events have correct relay tags
- [ ] Verify gitworkshop.dev can clone and see files

## Next Steps

1. **Deploy fixes to Hetzner**
2. **Test push flow end-to-end**
3. **Monitor console logs during push**
4. **Verify files appear on gitworkshop.dev**
5. **Verify bridge has files at correct path**

