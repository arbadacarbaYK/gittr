# gittr Pages gateway (Docker image)

Production **pages.gittr.space** runs this image, built from **[arbadacarbaYK/nsite-gateway](https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/nsite-gateway)** branch **`master`** (forked from hzrd149 v3.6.2 + gittr features). Gateway docs: **that repo’s `README.md`**.

## What we added (on hzrd149 v3.6.2)

Full tables (feature names + pushed back or not): **[arbadacarbaYK/nsite-gateway README — What we added](https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/nsite-gateway#what-we-added-gittr-pages)**.

**From hzrd149 (v3.6.2):** gateway **curation** (`CURATION_USER` reads kind `10000` from relays). **gittr-only on top:** `manifests.json`, `hasIndexHtml`, and **blocklist wiring** (`GITTR_SYNC_MUTED_PUBKEYS` + publish script merging `PUBLISHER_BLOCKLIST` into that mute list).

**Merged to hzrd149:** correct `/status` “updated” time + newest manifest per site — [PR #21](https://github.com/hzrd149/nsite-gateway/pull/21).

## Build & deploy

`scripts/deploy-nsite-gateway.sh` syncs a local clone of **our fork** (`arbadacarbaYK/nsite-gateway`, branch **`master`**) into `gateway-src/` and builds on the server. It **does not overwrite** an existing gateway `.env`.

**Local folder name:** some machines still have `../nsite-gateway-pr` — that suffix is only a **historical directory name** from when a PR to [hzrd149/nsite-gateway](https://github.com/hzrd149/nsite-gateway) was drafted and never opened. Production does **not** push to hzrd149; deploy uses **`master` on our fork** only. Prefer cloning into `../nsite-gateway` today.

```bash
export DEPLOY_HOST=your.server
./scripts/deploy-nsite-gateway.sh
```

Local clone path override:

```bash
export NSITE_GATEWAY_SRC=/path/to/nsite-gateway
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

In [arbadacarbaYK/nsite-gateway](https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/nsite-gateway): merge or rebase tags from [hzrd149/nsite-gateway](https://github.com/hzrd149/nsite-gateway), resolve conflicts on gittr files, push `master`, redeploy.
