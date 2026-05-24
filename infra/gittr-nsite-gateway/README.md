# gittr Pages gateway (Docker image)

Production **pages.gittr.space** runs this image, built from **[arbadacarbaYK/nsite-gateway](https://github.com/arbadacarbaYK/nsite-gateway)** branch **`master`** (forked from hzrd149 v3.6.2 + gittr features). Gateway docs: **that repo’s `README.md`**.

## What we added (on hzrd149 v3.6.2)

See **[arbadacarbaYK/nsite-gateway `README`](https://github.com/arbadacarbaYK/nsite-gateway#what-we-added-gittr-pages)** for the full table (including what was pushed back to hzrd149).

| Feature | Purpose | Back to hzrd149? |
|---------|---------|------------------|
| `GET /status/manifests.json` | JSON directory for gittr **`/pages`** | **No** (fork only) |
| `hasIndexHtml` | JSON feed lists only manifests with `/index.html` | **No** |
| `GITTR_SYNC_MUTED_PUBKEYS` | Blocklist backup until mute list on relays | **No** |
| `scripts/publish-curation-mutelist.cjs` | Publish curator mute list | **No** |

Status “updated” / newest-manifest fix: **yes** — [hzrd149#21](https://github.com/hzrd149/nsite-gateway/pull/21) merged.

HTML **`/status`** still lists all indexed manifests (operator view). **`manifests.json`** and gittr **`/pages`** are the public “working sites” directory.

## Build & deploy

`scripts/deploy-nsite-gateway.sh` syncs a local clone of the fork (default: `../nsite-gateway-pr` on branch **`master`**) into `gateway-src/` and builds on the server. It **does not overwrite** an existing gateway `.env`.

```bash
export DEPLOY_HOST=your.server
./scripts/deploy-nsite-gateway.sh
```

Local clone path override:

```bash
export NSITE_GATEWAY_SRC=/path/to/nsite-gateway-pr
```

## Curation vs gittr blocklist

| Mechanism | Where |
|-----------|--------|
| **`CURATION_USER`** | Gateway `.env` — hex pubkey; loads kind `10000` from relays |
| **`GITTR_SYNC_MUTED_PUBKEYS`** | Gateway `.env` — synced from `ui/.env.local` blocklist on deploy |
| **`PUBLISHER_BLOCKLIST`** | gittr Next.js — explore, repos, sitemap (separate from gateway) |

Details: **`docs/GITTR_PAGES_CURATION.md`**.

## Legacy `overlay/`

Old Docker overlay patches; **not used** when `gateway-src/` is synced from the fork. Kept for reference only.

## Merging from hzrd149 later

In [arbadacarbaYK/nsite-gateway](https://github.com/arbadacarbaYK/nsite-gateway): merge or rebase tags from [hzrd149/nsite-gateway](https://github.com/hzrd149/nsite-gateway), resolve conflicts on gittr files, push `master`, redeploy.
