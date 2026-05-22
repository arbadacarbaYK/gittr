# Production setup

Install gittr (Next.js UI + API) and **git-nostr-bridge** on a Linux server. Paths like `/opt/gittr` and hostnames like `gittr.space` are examples—use your own.

**Deploy path name:** Some servers still use `/opt/ngit` as the checkout directory from early layout. That tree is **this gittr repo** (Next.js under `ui/`, bridge under `ui/gitnostr/`)—not the separate **[ngit](https://ngit.dev)** project. Scripts or docs that say `cd /opt/ngit` mean your gittr install path.

**Do not commit** real IPs, SSH keys, OAuth secrets, or LNbits keys. Use `ui/.env.example` and private deploy scripts.

**Other docs (read when needed, not duplicated here):** full index [docs/README.md](README.md).

| Topic | Doc |
|--------|-----|
| Bridge only / security warnings | [GIT_NOSTR_BRIDGE_SETUP.md](GIT_NOSTR_BRIDGE_SETUP.md) |
| `git clone` / `git push` over SSH | [SSH_GIT_GUIDE.md](SSH_GIT_GUIDE.md) |
| Env reference, checklist, maintenance | [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) |
| File fetch / bridge 404 / empty tree | [FILE_FETCHING_INSIGHTS.md](FILE_FETCHING_INSIGHTS.md) |
| GitHub OAuth | [ui/GITHUB_OAUTH_SETUP.md](../ui/GITHUB_OAUTH_SETUP.md) |
| Pages gateway + wildcard DNS/TLS | [infra/nsite-gateway/README.md](../infra/nsite-gateway/README.md) |
| SEO / sitemap | [SEO.md](SEO.md) |
| Event kinds / paywall product rules | [NIPS_AND_EVENT_KINDS.md](NIPS_AND_EVENT_KINDS.md) |
| Local dev | [LOCAL_SETUP.md](LOCAL_SETUP.md) |

---

## Prerequisites

- Ubuntu 20.04+ (or similar), sudo
- **Node 18+**, **yarn** (preferred; `ui/yarn.lock` is canonical)
- **Go 1.21+** to build the bridge (or use Docker — [GIT_NOSTR_BRIDGE_SETUP.md](GIT_NOSTR_BRIDGE_SETUP.md))
- **git**, **openssh-server**, **nginx**, **certbot**
- DNS for your web host (and optionally `git.` + `pages.` subdomains)

```bash
node --version   # >= 18
go version       # >= 1.21
git --version
```

---

## 1. Clone and build UI

```bash
git clone git@git.gittr.space:arbadacarbaYK/gittr.git
cd gittr/ui
yarn install
cp .env.example .env.local
# edit .env.local — domain, relays, optional GitHub OAuth, LNbits, Blossom URLs
yarn build
```

**Env notes (production):**

- `NEXT_PUBLIC_NOSTR_RELAYS` should match bridge `relays` in `git-nostr-bridge.json`.
- If Next runs as a different user than the bridge, set **`GIT_NOSTR_BRIDGE_DB`** and **`GIT_NOSTR_BRIDGE_REPOS_DIR`** to the bridge’s absolute paths (see `.env.example`).
- Optional: `PUBLISHER_BLOCKLIST` / `NEXT_PUBLIC_PUBLISHER_BLOCKLIST` — hides listed pubkeys from explore/repos/sitemap (server `ui/.env.local` only). Pages directory: gateway **`CURATION_USER`** + deploy sync — see [GITTR_PAGES_CURATION.md](GITTR_PAGES_CURATION.md).
- Push paywall, NIP-34 tag shape, Pages/Blossom behavior: [NIPS_AND_EVENT_KINDS.md](NIPS_AND_EVENT_KINDS.md) and in-app Help — not repeated here.

PWA: optional; needs HTTPS in production (`ui/public/site.webmanifest`, `sw.js`).

### Homepage “Most Active” leaderboard (server snapshot)

The homepage cards call **`GET /api/stats/platform-leaderboard`**. Heavy Nostr relay scans no longer block the first paint:

- Cached JSON: **`ui/data/platform-leaderboard-snapshot.json`** (created on the server after the first successful refresh).
- **Serve immediately** from disk when the file exists; response may include `refreshing: true` while a background relay scan runs.
- **Disk refresh** when the snapshot is older than **3 hours** (`DISK_REFRESH_AFTER_MS` in the API route).
- Stale disk older than **7 days** is ignored and a full refresh is forced.
- After deploy, warm the snapshot once: `curl -sS https://YOUR_DOMAIN/api/stats/platform-leaderboard | head` (first call may take minutes; later calls should be sub-second).

Optional: tie refresh to your SEO/repo-discovery cron by hitting the same URL after indexing runs.

### Homepage “Recent repositories” (live relay query)

The **Recent repositories** strip is **not** taken from the 3h leaderboard snapshot. It uses a separate endpoint so pushes show up without waiting for the heavy platform stats job:

- **`GET /api/stats/recent-repos`** — queries Nostr relays for the latest kind **30617/30618** announcements, sorted by `created_at`, returns up to 12 repos.
- **Server cache ~45s** (`Cache-Control` + in-memory) so the homepage can poll without hammering relays.
- The UI shows this list for **both logged-in and logged-out** users (do not substitute the visitor’s localStorage sync — that caused mismatched homepage lists).
- Warm after deploy: `curl -sS https://YOUR_DOMAIN/api/stats/recent-repos | head` (first call can take several seconds while relays respond).

### Profile repo list (logged-out visitors)

Profile pages show a **repo count** from Nostr stats, but the grid used to rely on **localStorage** only (empty for anonymous visitors). Public profiles now load repos from the server:

- **`GET /api/nostr/profile-repos?ownerPubkey=<64-char-hex>`** — fetches kind **30617/30618** for `authors: [pubkey]` on the platform stats relay set.
- The profile page passes the decoded hex pubkey (npub URLs are decoded client-side; do not pass npub to this API).
- Response is merged with local repos so a later empty local sync does not wipe network results.
- Smoke test: `curl -sS 'https://YOUR_DOMAIN/api/nostr/profile-repos?ownerPubkey=<hex>' | jq '.repos | length'`

---

## 2. Bridge user and build

**Warning:** run the bridge only as dedicated user **`git-nostr`**, not your personal account ([GIT_NOSTR_BRIDGE_SETUP.md](GIT_NOSTR_BRIDGE_SETUP.md)).

```bash
sudo useradd --create-home --shell /bin/bash git-nostr
sudo su - git-nostr
cd ~
git clone git@git.gittr.space:arbadacarbaYK/gittr.git
cd gittr/ui/gitnostr
make git-nostr-bridge
```

Create config (run `./bin/git-nostr-bridge` once, Ctrl+C after it starts), then edit `~/.config/git-nostr/git-nostr-bridge.json`:

```json
{
  "repositoryDir": "/home/git-nostr/git-nostr-repositories",
  "DbFile": "/home/git-nostr/.config/git-nostr/git-nostr-db.sqlite",
  "relays": ["wss://relay.damus.io", "wss://nos.lol"],
  "gitRepoOwners": []
}
```

Use **absolute paths**. `gitRepoOwners: []` allows any pubkey to create repos. Relays = same set as `NEXT_PUBLIC_NOSTR_RELAYS`.

---

## 3. SSH for Git

In `/etc/ssh/sshd_config`: `PubkeyAuthentication yes`; allow users `git-nostr` and/or `git`.

**Important:** the bridge updates **`/home/git-nostr/.ssh/authorized_keys` only**. If you use `Match User git` with a **copy** at `/etc/ssh/git-authorized_keys`, keys go stale and clients get password prompts. Point `git` at the live file:

```
Match User git
    AuthorizedKeysFile /home/git-nostr/.ssh/authorized_keys
```

Or after deploy: `SSH_DEPLOY_KEY=~/.ssh/your_key ./scripts/ensure-sshd-git-live-authorized-keys.sh <host>`

```bash
sudo sshd -t && sudo systemctl reload ssh
```

Users add keys in **Settings → SSH Keys**. Details: [SSH_GIT_GUIDE.md](SSH_GIT_GUIDE.md).

---

## 4. systemd services

**Bridge** — `/etc/systemd/system/git-nostr-bridge.service`:

```ini
[Unit]
Description=Git-Nostr-Bridge
After=network.target

[Service]
Type=simple
User=git-nostr
WorkingDirectory=/home/git-nostr/gittr/ui/gitnostr
ExecStart=/home/git-nostr/gittr/ui/gitnostr/bin/git-nostr-bridge
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**Frontend** — `/etc/systemd/system/gittr-frontend.service` (adjust paths/user):

```ini
[Unit]
Description=gittr Frontend
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/gittr/ui
ExecStart=/usr/bin/yarn start
Environment=NODE_ENV=production
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now git-nostr-bridge gittr-frontend
sudo journalctl -u git-nostr-bridge -f   # expect "relay connected"
```

---

## 5. nginx and TLS

Start from repo examples (adjust hostnames):

- Main app + API: [`nginx.gittr.conf.example`](../nginx.gittr.conf.example) — rate limits, `proxy_pass` to `127.0.0.1:3000`, optional `location = /api/nostr/repo/file-content` for bulk fetches.
- HTTPS git smart HTTP: proxy `git.yourdomain` → bridge **:8080** (see example in that file).
- Pages: [`infra/nsite-gateway/nginx-pages.gittr.space.conf.example`](../infra/nsite-gateway/nginx-pages.gittr.space.conf.example) + [infra/nsite-gateway/README.md](../infra/nsite-gateway/README.md). Deploy gateway: `./scripts/deploy-nsite-gateway.sh <ssh-host>`.

```bash
sudo ln -s /etc/nginx/sites-available/gittr /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d your.domain -d git.your.domain
```

Optional rate-limit exemptions in `ui/.env.local`: `GITTR_RATE_LIMIT_EXEMPT_PUBKEYS`, `GITTR_RATE_LIMIT_EXEMPT_IPS` (restart frontend after change).

**Typical env (also in `.env.example`):**

```
NEXT_PUBLIC_DOMAIN=your.domain
NEXT_PUBLIC_GIT_SSH_BASE=your.domain
NEXT_PUBLIC_SITE_URL=https://your.domain
NEXT_PUBLIC_GIT_SERVER_URL=https://git.your.domain
NEXT_PUBLIC_GITTR_PAGES_URL=https://pages.your.domain
```

---

## 6. Optional: Telegram

Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env.local`, then:

```bash
cd ui && node configure-webhook.js your.domain
curl https://your.domain/api/telegram/webhook-status
```

See [PRODUCTION_TELEGRAM_SETUP.md](PRODUCTION_TELEGRAM_SETUP.md).

---

## 7. Verify

```bash
sudo systemctl status gittr-frontend git-nostr-bridge
curl -sI https://your.domain | head -1
```

- Open the site, log in (NIP-07 or key), import or create a repo.
- `git ls-remote git@your.domain:<npub-or-hex>/<repo>.git` (with your key).
- Push from UI once; check bridge logs for repository events.

Import fails with “>4 MB”: Next API body limit — trim large binaries in the import. See README.

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| UI down | `journalctl -u gittr-frontend -n 100`, `WorkingDirectory`, `.env.local`, `yarn build` |
| Bridge no relays | `relays` in JSON vs `.env.local`; `journalctl -u git-nostr-bridge` |
| `git` asks for password | Key in Settings → SSH Keys; `authorized_keys` path for `git@`; [SSH_GIT_GUIDE.md](SSH_GIT_GUIDE.md) |
| Paywall on `git push` | Pay invoice in UI; owner LNbits/Blink in Settings → Account; [NIPS_AND_EVENT_KINDS.md](NIPS_AND_EVENT_KINDS.md) |
| Empty Code tab (GRASP) | [FILE_FETCHING_INSIGHTS.md](FILE_FETCHING_INSIGHTS.md), `POST /api/nostr/repo/clone` |
| Pages 502 on upload | nginx `proxy_read_timeout` on `/api/`; Blossom URL in env |

---

## Docker (alternative)

Bridge-only in Docker: [GIT_NOSTR_BRIDGE_SETUP.md](GIT_NOSTR_BRIDGE_SETUP.md) — `ui/gitnostr/Dockerfile`, `docker compose`. Go install on the host not required for that path.

---

## Updates

```bash
cd /opt/gittr && git pull
cd ui && yarn install && yarn build
sudo systemctl restart gittr-frontend
# bridge: as git-nostr — pull, make, restart git-nostr-bridge
```

Backups: `git-nostr-bridge.json`, `git-nostr-db.sqlite`, `git-nostr-repositories/`, `ui/.env.local`.
