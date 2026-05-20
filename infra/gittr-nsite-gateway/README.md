# gittr nsite-gateway image

Docker image builds from **[arbadacarbaYK/nsite-gateway](https://github.com/arbadacarbaYK/nsite-gateway)** branch **`gittr-pages`** (no file overlay in this repo anymore).

Legacy overlay files under `overlay/` are kept for reference until the fork branch is the only source.

# gittr nsite-gateway overlay (legacy) (JSON for `/pages`)

**Production runs entirely on your server** (Docker + reverse proxy in front). Users and gittr **never** need to open GitHub for this to work.

Upstream project: **[hzrd149/nsite-gateway](https://github.com/hzrd149/nsite-gateway)** (Deno). We build **`NSITE_GATEWAY_REF=v3.6.2`** (or newer after testing), then apply a **minimal overlay** — not a full fork of the gateway UI.

## Stay in sync with upstream first

Before opening new PRs to hzrd149, rebase on the current release tag and keep the overlay thin:

| Upstream (v3.6.0+) | Overlay should **not** replace |
|--------------------|--------------------------------|
| Status table: **client** (nsyte, etc.), **curation** mutes, snapshots, hits | `pages/status.tsx` — use upstream |
| **Newest manifest** per address + correct **updated** time (merged PR #21) | Full `site-index.ts` rewrite |
| **404 at `/`** when manifest has no `index.html` | `routes/site.tsx` |

## What gittr adds (overlay only)

- **`GET /status/manifests.json`** — JSON for gittr **`/pages`** (until upstream merges the prepared PR).
- **`hasIndexHtml`** on `IndexedSite` — small extension to upstream `site-index.ts`.
- **Directory filter** — `manifests.json` only lists sites with **`hasIndexHtml`** (real homepages). Same curation filter as HTML `/status` when **`CURATION_USER`** is set.

## Why upstream `/status` still shows “broken” sites

That is **intentional**, not a bug in hzrd149’s gateway:

- The gateway indexes **every** valid Nostr site manifest it sees (including Blossom Explorer uploads with only `/readme.md`, PDFs, etc.).
- Those URLs **404 at `/`** because NIP-5A requires **`/index.html`** in the manifest — incomplete or experimental publishes, not a gateway outage.
- HTML **`/status`** is an **operator index** (“what exists on the network”), not a “working sites” directory.
- gittr **`/pages`** and **`manifests.json`** are the **public directory** (browsable only).

## Curation vs gittr publisher blocklist

| Mechanism | Where | Purpose |
|-----------|--------|---------|
| **`CURATION_USER`** (upstream) | Gateway env | Curator’s NIP-51 mute list; hides authors from gateway **home** and **`/status`** / **`manifests.json`** when set. Align with hzrd149 / nsite.run if you want the same mutes. |
| **`PUBLISHER_BLOCKLIST`** (gittr) | Next.js env | gittr-only: explore, repos, apps, sitemap, and a second filter on **`/api/gittr-pages/status-sites`**. Keep for platform-wide bad actors (e.g. one spam pubkey) even when not on the curator list. |

Production: **`CURATION_USER`** is gittr’s public operator hex; deploy syncs **`GITTR_SYNC_MUTED_PUBKEYS`** from **`ui/.env.local`** `NEXT_PUBLIC_PUBLISHER_BLOCKLIST` (server-only). See **`docs/GITTR_PAGES_CURATION.md`**. Keep **`PUBLISHER_BLOCKLIST`** for explore/repos/sitemap on gittr.space.

## 404 on some `npub….pages.gittr.space` URLs

The manifest is indexed, but there is **no `/index.html` path** (see **Paths** on `https://pages.gittr.space/status/<npub>`). Those entries are **not** in **`manifests.json`** or gittr **`/pages`**; operators can still inspect them on **`/status`**.

## What you actually do on the server

1. Deploy/sync this repo to the server (including **`infra/gittr-nsite-gateway/`** and **`infra/nsite-gateway/docker-compose.gittr-gateway.yml`** — **`deploy-nsite-gateway.sh`** does that).
2. On the server, from **`infra/nsite-gateway`**:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.gittr-gateway.yml up -d --build
   ```

3. Confirm: `https://pages.gittr.space/status/manifests.json` returns JSON with `hasIndexHtml: true` on every row.

Optional in **`gittr-pages.production.env`** (same file deployed as gateway `.env`):

```env
# Curator hex pubkey or npub — same value as hzrd149/nsite.run if you want shared mutes
# CURATION_USER=
# CURATION_REFRESH=600
```

## Local build

```bash
cd infra/gittr-nsite-gateway
docker build -t gittr-nsite-gateway:local --build-arg NSITE_GATEWAY_REF=v3.6.2 .
```

Use the same `.env` / volumes pattern as **`infra/nsite-gateway`** (see upstream README for env vars).

## Upstream PRs (arbadacarbaYK)

- **Merged:** `fix/status-updated-newest-manifest` (PR #21).
- **Pending:** `GET /status/manifests.json` — see **`MANIFESTS_JSON_UPSTREAM_PR.md`**. Rebase on `v3.6.2` before opening; include `hasIndexHtml` + curation parity in that PR or a follow-up.

After upstream merges, delete overlay files that duplicate upstream and bump **`NSITE_GATEWAY_REF`**.
