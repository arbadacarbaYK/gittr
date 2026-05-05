# Upstream PR: `GET /status/manifests.json`

Prepared in the same local clone as the timestamp fix:

```text
/home/homie/Downloads/actual/nsite-gateway-pr
```

**Branch:** `feature/status-manifests-json` (based on `hzrd149/nsite-gateway` `master` at fetch time)

**Commit:** `92a2fee` — adds `src/routes/status/manifests-json.tsx` and registers `GET /status/manifests.json` in `src/routes/status/index.ts`.

**Push to your fork** (after `gh auth` or with HTTPS + PAT):

```bash
cd /home/homie/Downloads/actual/nsite-gateway-pr
git push -u fork feature/status-manifests-json
```

Open a **second** PR to `hzrd149/nsite-gateway` `master`, or combine with your other branch if you prefer one PR (rebase/cherry-pick as needed).

**Suggested PR angle:** machine-readable status listing for automation (directories, monitoring, **sitemaps**); avoids scraping HTML.

**Note:** gittr production still uses the **Docker overlay** until upstream merges; behavior should match this PR. After merge, you can trim duplicate overlay files if you want the image to track upstream only.
