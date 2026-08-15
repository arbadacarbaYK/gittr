# Bridge Push Debugging Guide

## Ghost file tree / content 404 (fixed Aug 2026)

**Symptom**: Sidebar shows dozens of files; opening any file 404s on `/api/nostr/repo/file-content`. Git Server shows `git.gittr.space/...` even when the project is a GitHub import. Console: `GRASP repo not cloned yet`, `Clone API failed: 404`, `No sourceUrl, forkedFrom, or clone URL found`.

**Cause**: File **list** can come from a temporary GRASP/`/api/git/repo-files` clone while this owner's bare mirror under `git-nostr-repositories/{hex}/{repo}.git` was never created (or only `git.gittr.space` was tried and 404'd while `relay.ngit.dev` had the objects). Content always reads the bare mirror. `isRefetchableUpstreamSourceUrl` also excludes GRASP, so Strategy 3 never tried those remotes for blobs.

**Fix**: On content 404, try `/api/git/file-content` against every successful/clone HTTPS remote (forges first among non-success), then clone each onto the bare mirror until one works. Await bare mirror after a temp GRASP list. Git Server sidebar prefers a GitHub/GitLab/Codeberg URL from `clone[]` over `git.gittr.space`.

## Empty tree + `Unknown source type` for `/grasp/…` clones (fixed Aug 2026)

**Symptom**: Repo announcement has clone URLs like `https://laantungir.net/grasp/npub…/repo.git` plus ngit mirrors; UI logs `Preferring 1 non-GRASP clone URL(s)`, `Unknown source type`, then clone `500` (`no valid HEAD`) / `502` and shows **no files**.

**Cause**: Home GRASP hosts use a `/grasp/npub/repo` path. That was not parsed as `nostr-git` (fell through to `unknown`, so bridge never ran for that URL) and was wrongly preferred *before* known GRASP mirrors. Empty remotes (no refs) still cannot invent a missing GitHub `source` tag — publishers should add `source`/`forkedFrom` when the real tree lives on a forge.

**Fix**: Treat `/grasp/…` paths as GRASP (`isGraspServer` / `parseGitSource` → `nostr-git`). Do not classify them as forge upstreams in `extractGithubUrlFromEventTags`.

## Tiny repo + wrong Git Server (`git.gittr.space` instead of announcement) (fixed Aug 2026)

**Symptom**: e.g. `prod-replay-msfc22wy` shows only `src/pages/TicTacToe.tsx` and Git Server = `git.gittr.space/…`, while the NIP-34 event’s clone tag is `git.shakespeare.diy/…`.

**Cause**: The on-disk tree really is that one file (not a wipe). The 3s file-fetch timeout inferred default GRASP clone URLs and **unsubscribed** before `nos.lol` / shakespeare delivered the announcement, so the sidebar preferred inferred `git.gittr.space`.

**Fix**: Keep the Nostr subscription after timeout/EOSE (up to 20s), prefer announcement clone tags over inferred defaults in `repoData.clone` and Git Server sidebar, include `wss://nos.lol` in NIP-34 discovery relays.

**Follow-up (Aug 2026)**: Do not treat *all* `KNOWN_GRASP_DOMAINS` URLs as inferred guesses when picking Git Server. If `git.gittr.space` is on the 30617 `clone` tags of a **Nostr-only** repo (normal after Push from gittr), it must win over shakespeare/ngit mirrors. That bump does **not** apply when the event has a GitHub/GitLab/Codeberg `source`. Only strip inferred URLs that are **not** on the event. Never invent gittr if the event never listed it.

## File tree last-commit dates (Aug 2026)

Code browser rows show **last commit message + relative time** for the currently selected tip/branch. Data comes from `GET /api/nostr/repo/tree-last-commits` (one capped `git log --name-only` on the bare mirror — not per-path N+1). Dates track the bridge tip for that branch, which should match GitHub after a clean Refetch → Push.

## Clone URL sidebar (Aug 2026)

"Clone URL (event)" keeps forge `source` plus every host on `GRASP_SERVERS_FOR_PUSHING` (gittr, shakespeare, gitnostr, ngit, …). It no longer collapses to only primary gittr + GitHub.

## Refetch then Push rewrote GitHub tip (fixed Aug 2026)

**Symptom**: After **Refetch from GitHub** → **Push to Nostr**, kind **30618** `refs/heads/main` is a bridge-only SHA (`Push from gittr (…)`), not the GitHub tip. Repo identity (`source` on 30617) is correct; tip is wrong.

**Cause**: `/api/nostr/repo/push` always ran `git commit --allow-empty` + force-push. Refetch also filled local overrides, which disabled the “clone from source” fast path (`!hasOverrideContent`), so every clean refetch push invented a new tip.

**Fix**:
- Clean forge mirrors (`source` set, `hasUnpushedEdits` false) call `POST /api/nostr/repo/sync-from-source` and announce those exact SHAs
- Overrides after refetch are cache, not “dirty”
- Forge Refetch must **not** set `hasUnpushedEdits` (that forced N× `/api/git/file-content` → 429 on large repos). Large trees (≥50 files) skip client hydrate; Push uses `shouldPreferBridgeSyncFromSource` (post-refetch hint / metadata-only recovery)
- Local-edit rewrite (`--allow-empty` / file overlay) only when `hasUnpushedEdits` is true (or no forge source) **and** the bridge-sync preference above does not apply
- Bridge `handleRepositoryEvent` also `git fetch`es upstream when the bare repo already exists

**Regression (required):** `cd ui && npm run test:regressions` covers tip gate + clone sidebar + tree timestamps. MCP smoke/`test:mcp-stdio` alone does **not**. See [FILE_FETCHING_INSIGHTS.md](FILE_FETCHING_INSIGHTS.md#regression-tests-run-these--smoke-alone-is-not-enough).

## Partial Push Can Wipe Folders (fixed Aug 2026)

**Symptom**: After Settings → Save (About / Public-Private) and then **Push to Nostr**, folders like `scripts/` disappear. Bridge `/api/nostr/repo/files` shows only a few root files; deep links 404.

**Cause**: Single-chunk `/api/nostr/repo/push` (`totalChunks === 1`, typical for ≤30 files) used to `git init` a **fresh** working tree and force-push. It only cloned the existing bare repo when `totalChunks > 1` or `files.length === 0`. A Push built from a thinned `gittr_files` index (e.g. 3 root files) therefore replaced the full tree.

Settings Save itself only republishes kind **30617** metadata — it does not upload files. The wipe happens on the subsequent **Push**.

**Fix**:
- Always seed the working tree from the existing bare repo before overlaying payload files
- Refuse force-push if the new tree would shrink by >15% (`409`, unless `allowTreeShrink: true`)
- Client Push merges missing paths from the live bridge listing before upload
- Settings Save no longer sets `hasUnpushedEdits` (metadata is already published as 30617)

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
ls -la /opt/gittr/repos/YOUR_PUBKEY/
# Should show: mylnbitch.git (owned by git-nostr:git-nostr)

# If missing or wrong permissions:
sudo chown -R git-nostr:git-nostr /opt/gittr/repos/
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

