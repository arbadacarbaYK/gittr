# gittr Pages — nsite gateway (sidecar)

Public product name: **gittr Pages** (hostname: **`pages.gittr.space`** on production).

Runs **[hzrd149/nsite-gateway](https://github.com/hzrd149/nsite-gateway)** in Docker with a **gittr Pages** landing in `public/index.html`. Isolated from the main `ui/` Next.js app.

**gittr fork (recommended for production):** build from **`../gittr-nsite-gateway`** so the gateway exposes **`GET /status/manifests.json`** (clean JSON for gittr’s `/pages`). See **`infra/gittr-nsite-gateway/README.md`** and compose override **`docker-compose.gittr-gateway.yml`**.

## Production (from your laptop)

1. **Server:** Install Docker (once):

   `sudo apt update && sudo apt install -y docker.io docker-compose-plugin && sudo systemctl enable --now docker`

2. From the **repo root**:

   ```bash
   chmod +x scripts/deploy-nsite-gateway.sh
   ./scripts/deploy-nsite-gateway.sh
   ```

   This syncs **`infra/nsite-gateway`** and **`infra/gittr-nsite-gateway`** to the server, installs production `.env`, and runs **`docker compose -f docker-compose.yml -f docker-compose.gittr-gateway.yml up -d --build`** (gittr gateway image with `/status/manifests.json`).

3. **DNS:** Point **`pages.gittr.space`** (A/AAAA) at the server.

4. **nginx + TLS:** Merge **`nginx-pages.gittr.space.conf.example`** into your site config (see **`docs/SETUP_INSTRUCTIONS.md`**), then:

   `sudo certbot --nginx -d pages.gittr.space`  
   `sudo nginx -t && sudo systemctl reload nginx`

5. If `PUBLIC_DOMAIN` was still localhost, edit on server:  
   `sudo nano /opt/ngit/infra/nsite-gateway/.env` → set `PUBLIC_DOMAIN=https://pages.gittr.space`, then  
   `cd /opt/ngit/infra/nsite-gateway && docker compose up -d`

Whenever gateway-related files in this repo change, run **`../../scripts/deploy-nsite-gateway.sh`** from your machine (see that script for required SSH arguments) so production picks up **`infra/gittr-nsite-gateway`** and the compose override.

The **`public/`** folder must keep upstream **`styles.css`** and **`favicon.ico`** (the gateway reads them at startup). Only replace **`index.html`** for gittr Pages branding.

## Local quick start

```bash
cd infra/nsite-gateway
cp .env.example .env
# For laptop-only testing, set PUBLIC_DOMAIN=http://localhost:3040 in .env
docker compose up
```

- **Status:** http://localhost:3040/status  
- **Why Cursor/agents often “can’t install Docker”:** automated environments usually have **no root**, **no systemd**, and **no Docker socket**; use your own machine or SSH to a real host.

## Planning

**`NSITE_GATEWAY_PLAN.local.md`** at repo root (gitignored).
