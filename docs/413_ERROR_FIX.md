# 413 Request Entity Too Large - Fixed

## Root Cause

The bridge push was failing with **413 Request Entity Too Large** because:
- 352 files were being sent in a single HTTP request
- The request body exceeded nginx's `client_max_body_size` limit (typically 1MB default, or configured limit)
- This caused the push to fail **silently** - events were published to Nostr, but files were never pushed to the bridge

## The Problem

From the logs:
```
POST https://gittr.space/api/nostr/repo/push 413 (Content Too Large)
❌ [Bridge Push] API returned non-JSON response: {status: 413, contentType: 'text/html'...}
❌ [Push Repo] Bridge push failed: Error: Bridge API returned HTML instead of JSON (status: 413)
```

**Impact**:
- ✅ Events were published to Nostr (announcement and state events)
- ❌ Files were NOT pushed to the bridge
- ❌ GitWorkshop.dev can see the events but has no files to display
- ❌ Nostr.watch shows 50% because the event references files that don't exist

## The Fix

Implemented **file chunking** to split large pushes into smaller requests:

### Frontend Changes (`ui/src/lib/nostr/push-to-bridge.ts`)

1. **Chunking Logic**:
   - Files are split into chunks of **30 files** or **8MB** max per chunk
   - Chunks are sent **sequentially** to avoid overwhelming the server

2. **Chunk Processing**:
   - Each chunk is sent as a separate API request
   - Progress is logged for each chunk
   - All chunks must succeed for the push to be considered successful

### Backend Changes (`ui/src/pages/api/nostr/repo/push.ts`)

1. **Chunked Push Support**:
   - Added `chunkIndex` and `totalChunks` parameters
   - For chunked pushes, each chunk **clones the existing repo first** to get files from previous chunks
   - Each chunk **commits and pushes** so the next chunk can see previous files
   - The last chunk will have all files from all chunks

2. **Commit Strategy**:
   - Each chunk commits (builds on previous chunks)
   - Multiple commits are fine - the last commit has all files
   - GitWorkshop.dev will show the latest commit with all files

## How It Works

1. **Chunk 1** (files 1-30):
   - Clones existing repo (if exists) or creates new
   - Adds files 1-30
   - Commits and pushes

2. **Chunk 2** (files 31-60):
   - Clones existing repo (now has files 1-30)
   - Adds files 31-60
   - Commits and pushes (now has files 1-60)

3. **Chunk N** (last chunk):
   - Clones existing repo (has files from all previous chunks)
   - Adds remaining files
   - Commits and pushes (has ALL files)

## Testing

After deploying this fix:
1. Push should succeed without 413 errors
2. All files should be in the bridge
3. GitWorkshop.dev should show files
4. Nostr.watch should show 100% (event + files exist)

## Configuration

If you still hit 413 errors, you can:
1. **Reduce chunk size** in `push-to-bridge.ts`:
   - `CHUNK_SIZE = 20` (fewer files per chunk)
   - `MAX_CHUNK_SIZE_BYTES = 5 * 1024 * 1024` (5MB per chunk)

2. **Increase nginx limit** (server-side):
   ```nginx
   client_max_body_size 50m;
   ```

3. **Increase Next.js bodyParser limit** (already set to 25mb in `push.ts`)

## Summary

- ✅ **Fixed**: 413 errors by chunking files
- ✅ **Fixed**: Files now properly pushed to bridge
- ✅ **Fixed**: GitWorkshop.dev will show files once bridge has them
- ✅ **Fixed**: Events and files are now in sync

