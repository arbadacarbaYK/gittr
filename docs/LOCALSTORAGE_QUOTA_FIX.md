# localStorage Quota Exceeded Fix

## Problem

Users were getting `QuotaExceededError` when trying to save repository data:
```
Failed to execute 'setItem' on 'Storage': Setting the value of 'retry_npub1.../repo:branch' exceeded the quota.
```

## Root Cause

The issue was **not** with retry keys (those use `sessionStorage`, not `localStorage`). The real problem was that **entire file arrays were being stored in the `gittr_repos` object** in localStorage.

For large repositories (like `gitnostr`, `bitcoin-meetup-calendar`, `gittr-helper-tools`), storing thousands of files with metadata in the repo object can easily exceed localStorage's 5-10MB quota.

## What Was Happening

In multiple places in `ui/src/app/[entity]/[repo]/page.tsx`, code was doing:
```typescript
return { ...r, files }; // ❌ Storing entire files array in repo object
localStorage.setItem("gittr_repos", JSON.stringify(updated));
```

This stored the entire files array (potentially thousands of entries) in the `gittr_repos` object, causing quota exceeded errors.

## The Fix

### 1. Store Files Separately

Files are now stored in separate localStorage keys using `saveRepoFiles()`:
```typescript
// Files stored separately: gittr_files__{entity}__{repo}
saveRepoFiles(resolvedParams.entity, resolvedParams.repo, files);
```

### 2. Only Store fileCount in Repo Object

The repo object now only stores `fileCount`, not the full files array:
```typescript
// ✅ Only store fileCount, not full files array
return { ...r, fileCount: files.length };
```

### 3. Added Quota Error Handling

- Automatic cleanup of old file storage keys (older than 30 days) when quota is exceeded
- Better error messages
- Graceful degradation (files remain in memory even if storage fails)

### 4. Improved saveRepoFiles()

The `saveRepoFiles()` function now:
- Detects quota errors
- Automatically cleans up old file storage keys
- Retries saving after cleanup
- Provides clear error messages

## Files Fixed

1. **ui/src/app/[entity]/[repo]/page.tsx** (5 locations):
   - Line ~2238: Multi-source file fetch
   - Line ~3475: NIP-34 file fetch
   - Line ~4195: Clone URL file fetch
   - Line ~4531: GitHub file fetch
   - Line ~4732: Git server file fetch
   - Line ~4906: GitLab file fetch
   - Line ~5605: GRASP clone event handler

2. **ui/src/lib/repos/storage.ts**:
   - Improved `saveRepoFiles()` with quota error handling and automatic cleanup

## Impact

- ✅ **Before**: Large repos caused quota exceeded errors, breaking file fetching
- ✅ **After**: Files stored separately, only `fileCount` in repo object, automatic cleanup on quota errors
- ✅ **Storage efficiency**: Repo objects are now much smaller (just metadata, not file arrays)
- ✅ **User experience**: No more quota errors, files still accessible even if storage fails

## Storage Structure (After Fix)

```
localStorage:
  gittr_repos: [
    {
      entity: "npub1...",
      repo: "gittr",
      fileCount: 352,  // ✅ Only count, not full array
      // ... other metadata
    }
  ]
  
  gittr_files__npub1...__gittr: [
    { path: "file1.js", type: "file", size: 1234, ... },
    { path: "file2.ts", type: "file", size: 5678, ... },
    // ... all 352 files
  ]
```

## Automatic Cleanup

When quota is exceeded, the system automatically:
1. Finds all `gittr_files__*` keys
2. Checks last activity from repo objects
3. Removes file storage keys for repos older than 30 days
4. Retries saving the current files

This prevents localStorage from filling up with old, unused file data.

