# Bridge Push Debugging Guide

## Why Bridge Might Be Empty After Push

The bridge should have files after you push a repo to Nostr. If it's empty, here's what to check:

## The Push Flow

1. **Files are collected from localStorage** → `repo.files` or `loadRepoFiles(entity, repo)`
2. **Files are prepared for bridge** → Content is included (even for binary files)
3. **Files are pushed to bridge** → `/api/nostr/repo/push` endpoint
4. **Bridge stores files** → Creates git repo at `{reposDir}/{pubkey}/{repo}.git`

## Common Failure Points

### 1. Files Not in localStorage

**Symptom**: Bridge push has 0 files

**Causes**:
- Import was done in a different browser
- localStorage was cleared
- Files weren't saved during import
- Repo was synced from Nostr (not imported from GitHub)

**Check**:
```javascript
// In browser console
const repos = JSON.parse(localStorage.getItem('gittr_repos') || '[]');
const repo = repos.find(r => r.repo === 'mylnbitch');
console.log('Files in repo:', repo?.files?.length || 0);
console.log('Files with content:', repo?.files?.filter(f => f.content).length || 0);
```

**Fix**: Re-import the repo to load files into localStorage

### 2. Files Missing Content

**Symptom**: Bridge push has files but they're empty (no content)

**Causes**:
- Files were stored as metadata only (no content)
- Content was filtered out during push (binary files, large files)

**Check**:
```javascript
// In browser console during push
// Look for: "filesWithContent: X, filesWithoutContent: Y"
```

**Fix**: The push process tries to fetch missing content from bridge API, but if that fails, files won't be pushed

### 3. Bridge Push Failed Silently

**Symptom**: Push appears successful but bridge is empty

**Causes**:
- Network timeout (5 minutes per chunk)
- 413 Request Entity Too Large (chunk too big)
- Bridge API error (500, 404, etc.)
- Permission errors (can't write to repo directory)

**Check**:
```bash
# On server
sudo journalctl -u gittr-frontend -f | grep "Bridge Push"
sudo journalctl -u git-nostr-bridge -f
```

**Look for**:
- `❌ [Bridge Push] Chunk X failed`
- `413 Request Entity Too Large`
- `Bridge push timeout`
- Permission denied errors

### 4. Bridge Push Not Triggered

**Symptom**: Push to Nostr succeeds but bridge push never happens

**Causes**:
- `filesForBridge` is empty
- `shouldAutoBridge` is false
- Push was canceled before bridge push

**Check**:
```javascript
// In browser console during push
// Look for: "filesForBridge: X files"
// Look for: "Pushing X file(s) to bridge..."
```

## Debugging Steps

### Step 1: Check localStorage

```javascript
// In browser console
const { loadStoredRepos, loadRepoFiles } = await import('/src/lib/repos/storage.ts');
const repos = loadStoredRepos();
const repo = repos.find(r => r.repo === 'mylnbitch');
console.log('Repo:', repo);
console.log('Files in repo:', repo?.files?.length || 0);

// Check separate files storage
const files = loadRepoFiles('npub1...', 'mylnbitch');
console.log('Files in separate storage:', files?.length || 0);
```

### Step 2: Check Bridge Status

```bash
# On server
curl http://localhost:8080/api/nostr/repo/files?ownerPubkey=YOUR_PUBKEY&repo=mylnbitch
```

### Step 3: Check Push Logs

**Browser Console**:
- Look for `[Push Repo]` logs
- Check `filesForBridge.length`
- Check for errors during push

**Server Logs**:
```bash
# Frontend logs
sudo journalctl -u gittr-frontend -f | grep -i "bridge push"

# Bridge logs
sudo journalctl -u git-nostr-bridge -f
```

### Step 4: Re-push with Debugging

1. Open browser console
2. Click "Push to Nostr"
3. Watch for:
   - `📋 [Push Repo] File loading status`
   - `📊 [Push Repo] After fetching: X files with content`
   - `📤 [Bridge Push] Pushing chunk X/Y`
   - `✅ [Bridge Push] Chunk X pushed successfully`

## Solutions

### Solution 1: Re-import Repository

If files are missing from localStorage:

1. Go to `/import` page
2. Enter GitHub URL: `https://github.com/arbadacarbaYK/myLNBitch`
3. Click "Import"
4. Wait for files to load into localStorage
5. Push to Nostr again

### Solution 2: Manual Bridge Push

If push failed but files are in localStorage:

1. Go to repo page
2. Open browser console
3. Run:
```javascript
const { pushFilesToBridge } = await import('/src/lib/nostr/push-to-bridge.ts');
const repos = JSON.parse(localStorage.getItem('gittr_repos') || '[]');
const repo = repos.find(r => r.repo === 'mylnbitch');
const files = repo.files.map(f => ({
  path: f.path,
  content: f.content,
  isBinary: f.isBinary
}));
await pushFilesToBridge({
  ownerPubkey: 'YOUR_PUBKEY',
  repoSlug: 'mylnbitch',
  entity: 'npub1...',
  branch: 'main',
  files: files
});
```

### Solution 3: Check Bridge Permissions

```bash
# On server
ls -la /opt/ngit/repos/YOUR_PUBKEY/
# Should show: mylnbitch.git (owned by git-nostr:git-nostr)

# If missing or wrong permissions:
sudo chown -R git-nostr:git-nostr /opt/ngit/repos/
```

## Expected Behavior

**Successful Push**:
1. Files loaded from localStorage: `✅ X file(s) ready for bridge push`
2. Chunks created: `📦 Chunking X files into Y chunk(s)`
3. Each chunk pushed: `✅ Chunk X/Y pushed successfully`
4. Bridge verified: `✅ Bridge sync verified`

**Failed Push**:
1. No files: `❌ CRITICAL: No files found in localStorage`
2. Missing content: `⚠️ No files with content to push to bridge`
3. Chunk failed: `❌ [Bridge Push] Chunk X failed`
4. Timeout: `Bridge push timeout for chunk X`

## Prevention

1. **Always import before pushing** → Ensures files are in localStorage
2. **Don't clear localStorage** → Files are stored there
3. **Check push logs** → Verify files were pushed
4. **Verify bridge after push** → Check `/api/nostr/repo/files` endpoint

