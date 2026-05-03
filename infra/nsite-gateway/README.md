# gittr Pages — nsite gateway (sidecar)

Public product name: **gittr Pages** (hostname: **`pages.gittr.space`** on production).

Runs **[hzrd149/nsite-gateway](https://github.com/hzrd149/nsite-gateway)** in Docker with a **gittr Pages** landing in `public/index.html`. Isolated from the main `ui/` Next.js app.

## Hetzner (from your laptop)

1. **Server:** Install Docker (once):

   `sudo apt update && sudo apt install -y docker.io docker-compose-plugin && sudo systemctl enable --now docker`

2. From the **repo root**:

   ```bash
   chmod +x scripts/deploy-nsite-gateway.sh
   ./scripts/deploy-nsite-gateway.sh
   ```

   This copies `infra/nsite-gateway` to **`/opt/ngit/infra/nsite-gateway`**, creates `.env` from `.env.example` if missing, and runs `docker compose up -d`.

3. **DNS:** Point **`pages.gittr.space`** (A/AAAA) at the server.

4. **nginx + TLS:** Merge **`nginx-pages.gittr.space.conf.example`** into your site config (see **`docs/SETUP_INSTRUCTIONS.md`**), then:

   `sudo certbot --nginx -d pages.gittr.space`  
   `sudo nginx -t && sudo systemctl reload nginx`

5. If `PUBLIC_DOMAIN` was still localhost, edit on server:  
   `sudo nano /opt/ngit/infra/nsite-gateway/.env` → set `PUBLIC_DOMAIN=https://pages.gittr.space`, then  
   `cd /opt/ngit/infra/nsite-gateway && docker compose up -d`

If you use a **private** `upload_to_hetzner.sh` (often gitignored), either **run this script once after every upload** or paste the block from the repo’s `upload_to_hetzner.sh` (search for `gittr Pages`) into your copy so production gets the gateway, not only GitHub.

## Local quick start

```bash
cd infra/nsite-gateway
cp .env.example .env
# For laptop-only testing, set PUBLIC_DOMAIN=http://localhost:3040 in .env
docker compose up
```

- **Status:** http://localhost:3040/status  
- **Why Cursor/agents often “can’t install Docker”:** automated environments usually have **no root**, **no systemd**, and **no Docker socket**; use your own machine or SSH to Hetzner.

## Planning

**`NSITE_GATEWAY_PLAN.local.md`** at repo root (gitignored).
