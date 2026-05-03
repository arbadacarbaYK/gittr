# gittr nsite gateway (sidecar)

Runs **[hzrd149/nsite-gateway](https://github.com/hzrd149/nsite-gateway)** in Docker with **gittr-branded** `public/index.html`. This stack is **isolated** from the main `ui/` Next.js app; nothing here is imported by gittr at build time.

## Quick start

```bash
cd infra/nsite-gateway
cp .env.example .env
docker compose up
```

Open **http://localhost:3040** (gateway listens on 3000 inside the container).

- **Status dashboard**: http://localhost:3040/status  
- **Homepage**: overridden by `./public/index.html` in this directory.

## Production notes

- Set **`PUBLIC_DOMAIN`** to your HTTPS gateway URL.
- Put **TLS + DNS** in front (e.g. Caddy or nginx); for wildcard `*.yourdomain` follow the upstream gateway hostname rules.
- Align **`NOSTR_RELAYS`** with relays that actually carry nsite manifest events you care about.
- Pin the **image tag** in `docker-compose.yml` to a digest or release tag when you want reproducible deploys.

## Planning

Long-form product and sequencing notes live in the repo-root file **`NSITE_GATEWAY_PLAN.local.md`** (gitignored).
