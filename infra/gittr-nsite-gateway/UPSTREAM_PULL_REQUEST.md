# Upstream PR prep: `hzrd149/nsite-gateway`

Prepared **2026-05-05** for you to review and push manually (`gh` auth was not available from the agent environment).

## Local clone (this machine)

Path:

```text
/home/homie/Downloads/actual/nsite-gateway-pr
```

Branch:

```text
fix/status-updated-newest-manifest
```

Commit:

```text
371d472 fix: status updated time + newest manifest per address
```

Files changed vs `hzrd149/nsite-gateway` `master`: `src/helpers/site-index.ts`, `src/pages/status.tsx` (same behavior as our Docker overlay).

## Fork and open the PR

1. Fork **https://github.com/hzrd149/nsite-gateway** to your GitHub account (web UI).
2. In the clone:

   ```bash
   cd /home/homie/Downloads/actual/nsite-gateway-pr
   git remote add fork https://github.com/YOUR_USER/nsite-gateway.git
   git push -u fork fix/status-updated-newest-manifest
   ```

3. On GitHub: open a PR **into** `hzrd149/nsite-gateway` `master` **from** your fork’s `fix/status-updated-newest-manifest`.

## Suggested PR title

Fix status “updated” time for manifest-only republishes; keep newest manifest per site

## PR description (paste)

Hey — small fix for the `/status` “updated” column and how we pick which manifest counts for a site.

We noticed that after you republish a site (new manifest / kind 35128), the status page could still look like nothing changed — the time stayed stuck on the first publish. That was confusing because the live site actually *had* updated.

What was going on: the UI was basically saying “if there’s a snapshot, only care about the snapshot time.” A lot of flows update the **manifest** without sending a **new** snapshot event, so the “updated” time never moved even though the manifest’s `created_at` did.

The other edge case: when building the site list from relay data, **whatever manifest event got processed last** won — not necessarily the **newest** one. So in weird ordering you could briefly show stale title/paths/time.

**What we changed**

1. For each site address, we only keep the manifest with the **latest** `created_at` (ignore older duplicates from ordering).
2. For the “updated” label we use **whichever is newer**: the current manifest time **or** the latest snapshot time — so manifest-only republishes show up too.

No change to how sites are served; this is just honest metadata on the status page.

(We’re running the same logic in production via gittr’s gateway overlay; happy to adjust anything to match your style.)

Cheers

## If the clone is gone later

```bash
git clone https://github.com/hzrd149/nsite-gateway.git
cd nsite-gateway
git fetch https://github.com/YOUR_USER/nsite-gateway.git fix/status-updated-newest-manifest
git checkout -b fix/status-updated-newest-manifest FETCH_HEAD
```

Or cherry-pick `371d472` from your fork after you push.
