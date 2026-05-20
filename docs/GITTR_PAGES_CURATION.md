# gittr Pages — gateway curation and blocklist

## Two layers (plain language)

| Piece | What it is | Secrets in GitHub? |
|-------|------------|-------------------|
| **Docker image** | Built program (hzrd149 gateway + small gittr overlay). Updated when you run `deploy-nsite-gateway.sh` / upload with `SKIP_GATEWAY_DEPLOY=0`. | No secrets — only code. |
| **Gateway `.env` on server** | Config file at `/opt/ngit/infra/nsite-gateway/.env`: relays, `PUBLIC_DOMAIN`, **`CURATION_USER`**, **`GITTR_SYNC_MUTED_PUBKEYS`**. | **Never commit** real blocklist or `nsec`. `gittr-pages.production.env` only has the **public** gittr curator hex. |
| **`ui/.env.local` on server** | Next.js: `NEXT_PUBLIC_PUBLISHER_BLOCKLIST` for explore/repos/apps/sitemap. | Stays on server only. |

Deploy copies `gittr-pages.production.env` → gateway `.env`, then **reads your existing blocklist from `ui/.env.local`** and writes **`GITTR_SYNC_MUTED_PUBKEYS`** (hex only) into gateway `.env`. Nothing new goes to GitHub.

## Your curator (not hzrd149’s)

- **`CURATION_USER`** = gittr operator pubkey (`gittr@gittr.space`, hex in `ui/public/.well-known/nostr.json`).
- Upstream loads that account’s **NIP-51 mute list** (kind `10000`) from relays and hides those authors from **`/status`** and **`manifests.json`**.

Until you publish **`p`** tags on that mute list, deploy also sets **`GITTR_SYNC_MUTED_PUBKEYS`** from the same npub as `NEXT_PUBLIC_PUBLISHER_BLOCKLIST` so Pages listing stays blocked immediately.

**Long term:** publish/update the kind `10000` list on relays with `["p", "<blocked-pubkey-hex>"]` from the gittr identity; then you can clear `NEXT_PUBLIC_PUBLISHER_BLOCKLIST` for Pages-only use and rely on curation (keep blocklist for explore/repos if you want).

## What still uses `PUBLISHER_BLOCKLIST`

Explore, home, repositories, apps, sitemap, and a backup filter on `GET /api/gittr-pages/status-sites`. The gateway handles **`pages.gittr.space/status/manifests.json`** first.

## Static files (PDF, MD, etc.)

- **`/`** only needs **`/index.html`** in the manifest (and Blossom must actually serve that blob).
- **Other paths** (`/style.css`, `/app.js`, images, optional `/doc.pdf`) must **also be listed in the manifest** if the HTML references them. The gateway does not auto-include files that are not in the manifest.
- A site can list **only PDF/MD** with no `index.html` → indexed on operator `/status`, **not** in gittr `/pages`, and **404** at `/`.

## 502 “Bad Gateway”

Separate issue: manifest says `index.html` exists but the Blossom server cannot return the blob. Not fixed by curation; author or storage must fix the upload.
