# gittr nsite-gateway overlay (JSON for `/pages`)

**Production runs entirely on your server** (Docker + reverse proxy in front). Users and gittr **never** need to open GitHub for this to work.

Upstream project: **[hzrd149/nsite-gateway](https://github.com/hzrd149/nsite-gateway)** (Deno). We do **not** ship a full copy of that repo here. Instead, **`infra/gittr-nsite-gateway`** is a **small overlay** plus a **Dockerfile** that, **when you build the image**, `git clone`s upstream once and copies our files on top. That clone is a **build-time** dependency (like `npm install` pulling packages), not something end users or production traffic “links to.”

## What gittr adds

- **`GET /status/manifests.json`** — same data as the HTML status page, as JSON, so gittr’s **`/pages`** and **`GET /api/gittr-pages/status-sites`** can use a proper API instead of parsing HTML.

## What you actually do on the server

1. Deploy/sync this repo to the server (including **`infra/gittr-nsite-gateway/`** and **`infra/nsite-gateway/docker-compose.gittr-gateway.yml`** — your **`deploy-nsite-gateway.sh`** already does that).
2. On the server, from **`infra/nsite-gateway`**:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.gittr-gateway.yml up -d --build
   ```

3. Confirm: `https://pages.gittr.space/status/manifests.json` returns JSON.

No GitHub account required for that flow.

## Optional: GitHub fork (for maintainers only)

Some teams like to **fork** hzrd149’s repo on GitHub to track merges, CI, or a pre-built container image (`ghcr.io/...`). That is **optional**. If you don’t use it, you still build from **this monorepo** on your own machine or server; production stays **your** hostnames only.

## Local build

```bash
cd infra/gittr-nsite-gateway
docker build -t gittr-nsite-gateway:local --build-arg NSITE_GATEWAY_REF=master .
```

Use the same `.env` / volumes pattern as **`infra/nsite-gateway`** (see upstream README for env vars).
