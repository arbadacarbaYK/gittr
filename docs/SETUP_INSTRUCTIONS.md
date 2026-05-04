# Production Setup Instructions

Complete step-by-step guide for setting up gittr.space on a production server.

## Prerequisites

Verify prerequisites are installed:

```bash
# Check Node.js
node --version  # Should be 18 or higher
npm --version

# Check Git
git --version

# Check SSH server
sudo systemctl status sshd || sudo systemctl status ssh

# Check Go (required for git-nostr-bridge)
go version  # Should be 1.21 or higher
```

If any are missing, install them:

```bash
# Node.js (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Git (if not installed)
sudo apt-get update && sudo apt-get install -y git

# SSH server (if not installed)
sudo apt-get install -y openssh-server
sudo systemctl enable sshd
sudo systemctl start sshd

# Go (required for git-nostr-bridge)
sudo apt-get install -y golang-go
# Verify installation
go version

# Make (usually pre-installed, but verify)
make --version || sudo apt-get install -y build-essential
```

## Setup Steps

### Step 1: Clone Repository

```bash
git clone https://github.com/arbadacarbaYK/gittr.git
cd gittr
```

### Step 2: Install Frontend Dependencies

**Note**: This project uses **Yarn** as the primary package manager. `yarn.lock` is the source of truth (Dependabot updates it automatically). npm works but yarn is recommended.

```bash
cd ui
yarn install
# Or: npm install (works but yarn is preferred)
```

### Step 3: Configure Environment

```bash
cd ui
cp .env.example .env.local
```

Edit `ui/.env.local` with your values. All configuration is in this file - domain, relays, Blossom URL, GitHub Platform Token (optional), etc. are already set with working defaults.

If you run backend/bridge services from the repo root, there is also a root `.env.example` that mirrors the optional server-side variables.

**Push paywall note (optional):**

- Repo owners can set `Push Cost (sats)` in Repo Settings.
- To enable non-zero Push Cost, owner must configure either `LNbits Invoice Key` or `Blink API Key` in `Settings -> Account`.
- If you use LNbits keys, you must also set **LNbits instance URL** (the UI blocks save without it when a key is present).
- This paywall is enforced for both GUI push and SSH push when set above `0`.
- GUI authorization uses a dedicated push-payment intent flow and grants a short push window (default 15 minutes).
- **Merge to Nostr** (post-merge automatic repo-state push) uses the same authorization: if paywall applies, the merge flow opens the invoice QR before the bridge push can complete.
- **Push Cost in repo settings** must be written to the bridge SQLite table `RepositoryPushPolicy` (not only `localStorage`). Saving repo settings now calls `POST /api/nostr/repo/push-policy-sync` with your signed kind **30617** so the paywall amount matches what `/api/nostr/repo/push-payment` enforces. NIP-07-only users previously skipped publishing settings (`privateKey` was required); that is fixed—sign with the extension when saving. If you set Push Cost before this change, open **Repo → Settings**, verify the value, and **Save** once after upgrading so the bridge row is created/updated.
- **Production:** If the Next.js process runs as a different Unix user than `git-nostr-bridge`, `$HOME/.config/git-nostr/...` can point at the wrong (or empty) SQLite file, so merges and pushes skip the paywall while the bridge still uses the real DB. Set `GIT_NOSTR_BRIDGE_DB` in `ui/.env.local` to the **absolute path** of the bridge’s SQLite file (same as `DbFile` in `git-nostr-bridge.json`). Resolution order is: `GIT_NOSTR_BRIDGE_DB`, then `/home/git-nostr/.config/...`, then `$HOME/.config/...`.
- **`GET /api/nostr/repo/files` (file tree for Code, Architecture, Dependencies):** Next.js reads bare repos from disk at `repositoryDir/{ownerHex}/{repo}.git`. If `GIT_NOSTR_BRIDGE_REPOS_DIR` / `REPOS_DIR` / `GITNOSTR_REPOS_DIR` is unset, the handler reads `repositoryDir` from `git-nostr-bridge.json` — **`/home/git-nostr/.config/...` is tried before `$HOME/.config/...`** so a root-owned `next start` still finds the same tree as the bridge. Set **`GIT_NOSTR_BRIDGE_REPOS_DIR`** explicitly if you use a non-standard path. Architecture/Dependencies reuse the **browser `gittr_files__…` cache** written when the Code tab loads the tree; that cache must be written for **all viewers on public repos** (not only the owner), or those tabs stay empty when `/api/nostr/repo/files` is wrong or slow.
- SSH push checks the same bridge DB grant before allowing `git-receive-pack`.

**Lightning / zaps / bounties (product vs Nostr):** End-user credential needs (repo zaps, bounties, pay-to-merge, NIP-57 vs LNbits) are summarized in the in-app **Help** page under **Payments & Bounties** (table). Developers should also read `docs/NIPS_AND_EVENT_KINDS.md` (NIP-57 section).

**Watch / follow list (kind `10018`):** Relays do not store “add one repo” deltas for this list. The app publishes **one replaceable `10018` per watch change** whose `a` tags are the **entire** current watched set (see NIP-51 and `docs/NIPS_AND_EVENT_KINDS.md` → NIP-51). Allow **`10018`** on any relay you expect to carry followed-repo lists (see relay `allowed_kinds` examples in `docs/NIP25_STARS_NIP51_FOLLOWING.md`).

**GitHub OAuth Setup (Optional, for private repository access):**

If you want users to be able to import and view files from private GitHub repositories, you need to set up GitHub OAuth:

1. Create a GitHub OAuth App at https://github.com/settings/developers

   - **Application name**: Your app name (e.g., "gittr.space")
   - **Homepage URL**: Your domain (e.g., `https://gittr.space`)
   - **Authorization callback URL**: `https://yourdomain.com/api/github/callback` (or `http://localhost:3000/api/github/callback` for local dev)

2. Copy the **Client ID** and **Client Secret** from the OAuth app settings

3. Add to `ui/.env.local`:

   ```
   GITHUB_CLIENT_ID=your_client_id_here
   GITHUB_CLIENT_SECRET=your_client_secret_here
   GITHUB_REDIRECT_URI=https://yourdomain.com/api/github/callback
   ```

4. Users can then connect their GitHub account via Settings → SSH Keys → Connect GitHub, which enables:
   - Importing private repositories
   - Viewing file content from private repositories
   - The OAuth token is stored securely in browser localStorage (never sent to server except for API calls)

See [`ui/GITHUB_OAUTH_SETUP.md`](../ui/GITHUB_OAUTH_SETUP.md) for detailed instructions.

### Step 4: Build Frontend

```bash
cd ui
yarn build
# Or: npm run build (works but yarn is preferred)
```

### Step 4.5: PWA Install (Optional)

gittr includes a PWA manifest and service worker for installable app support.

- **Local dev**: PWA install requires HTTPS, but `http://localhost:3000` still loads the manifest.
- **Production**: Install from the browser menu ("Install app") once served over HTTPS.
- **Files**: `ui/public/site.webmanifest`, `ui/public/sw.js`, `ui/public/offline.html`

### Step 5: Install Go (for building git-nostr-bridge) OR Use Docker

**Note:** Go is only required to BUILD the bridge from source. If you have a pre-built binary, you can skip this step.

**If using Docker:** Skip Go installation - Go is already included in the Docker image. See "Docker Setup" section below.

**Option 1: System-wide installation (requires sudo):**

```bash
# Check latest Go version at https://go.dev/dl/
wget https://go.dev/dl/go1.23.4.linux-amd64.tar.gz
sudo tar -C /usr/local -xzf go1.23.4.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
export PATH=$PATH:/usr/local/go/bin  # For immediate use in current session
go version
```

**Use this option if:** You have sudo access and want Go installed system-wide (available to all users). Works on both production servers and localhost.

**Option 2: User-local installation (no sudo required):**

```bash
# Check latest Go version at https://go.dev/dl/
wget https://go.dev/dl/go1.23.4.linux-amd64.tar.gz
mkdir -p ~/go-local
tar -xzf go1.23.4.linux-amd64.tar.gz -C ~/go-local
export PATH=$HOME/go-local/go/bin:$PATH  # For immediate use
echo 'export PATH=$HOME/go-local/go/bin:$PATH' >> ~/.bashrc  # For future sessions
go version
```

**Use this option if:** You don't have sudo access, or prefer to install Go in your home directory. Works on both production servers and localhost.

**Important clarification:** "Your user" is the **Linux system user account** you're logged in as (e.g., `homie`, `www-data`, `git-nostr`). This is **NOT** the Nostr nsec/pubkey from your `.env.local` file. The Nostr keys are for platform authentication, while the system user is your Linux account.

**For Docker installations:** If you're using Docker, Go is already included in the Docker image, so you don't need to install it separately. See Docker setup instructions below.

**Important:** After installing Go, you must either:

- Run `export PATH=$PATH:/usr/local/go/bin` (Option 1) or `export PATH=$HOME/go-local/go/bin:$PATH` (Option 2) in your current terminal session, OR
- Open a new terminal session (which will source `~/.bashrc` automatically)

### Step 6: Create git-nostr User

```bash
sudo useradd --create-home --shell /bin/bash git-nostr
sudo su - git-nostr
```

### Step 7: Build git-nostr-bridge

```bash
# IMPORTANT: as git-nostr user
cd ~
git clone https://github.com/arbadacarbaYK/gittr.git
cd gittr/ui/gitnostr
make git-nostr-bridge
```

### Step 8: Configure Bridge

```bash
# Run once to create config file
./bin/git-nostr-bridge
# Press Ctrl+C after you see "no relays connected"
```

Edit `~/.config/git-nostr/git-nostr-bridge.json`:

**Important:** Use absolute paths (not `~`) in the JSON file:

```json
{
  "repositoryDir": "/home/git-nostr/git-nostr-repositories",
  "DbFile": "/home/git-nostr/.config/git-nostr/git-nostr-db.sqlite",
  "relays": [
    "wss://relay.noderunners.network",
    "wss://relay.azzamo.net",
    "wss://relay.damus.io",
    "wss://nos.lol"
  ],
  "gitRepoOwners": []
}
```

**Note:** Replace `/home/git-nostr` with the actual home directory path if different. The bridge needs Git installed (already in prerequisites) to create repositories.

**IMPORTANT:**

- The `relays` array should match the relays in `ui/.env.local` (`NEXT_PUBLIC_NOSTR_RELAYS`).
- Leave `gitRepoOwners` empty `[]` to allow ANY user to create repos (decentralized).

**Restart the bridge** to pick up the new configuration:

```bash
# Stop the bridge if it's running
pkill -f git-nostr-bridge

# Start it again (it will load config from ~/.config/git-nostr/git-nostr-bridge.json)
# Replace /home/git-nostr/gittr with your actual path
cd /home/git-nostr/gittr/ui/gitnostr
nohup ./bin/git-nostr-bridge > /tmp/git-nostr-bridge.log 2>&1 &

# Check logs to verify it's connecting to relays
tail -f /tmp/git-nostr-bridge.log
```

**What to expect in the logs:**

- `relay connected: wss://...` - Successful relay connections
- `relay connect failed: ...` - Some relays may fail (this is normal for Nostr)
- `connected to X/Y relays: [...]` - Summary of connected relays
- `⚠️ [Bridge] Since timestamp for kind X is very old, resetting to 1 hour ago` - Bridge automatically resets old filters (normal)
- `🔍 [Bridge] Subscribing to repository events since: ...` - Bridge is listening for events
- `📥 [Bridge] Received event: ...` - Bridge is receiving events
- `✅ [Bridge] Successfully processed repository event: ...` - Repos are being processed

Press `Ctrl+C` to stop watching logs. The bridge will continue running in the background.

### Step 9: Configure SSH Server

```bash
# As root
sudo nano /etc/ssh/sshd_config
```

Add/verify:

```
AllowUsers root git-nostr git
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
PermitUserEnvironment yes
```

**`git@host` vs keys:** On gittr, `git` and `git-nostr` share the same UID and home (`/home/git-nostr`). The bridge **only** refreshes **`/home/git-nostr/.ssh/authorized_keys`**. If `sshd` uses a **separate** `Match User git` → `/etc/ssh/git-authorized_keys`, that copy **does not auto-update** when users add keys in the UI — they see **password prompts** after pubkey auth finds no match. Prefer pointing `git` at the live file:

```
Match User git
    AuthorizedKeysFile /home/git-nostr/.ssh/authorized_keys
```

(Legacy setups used a copied `/etc/ssh/git-authorized_keys`; if you keep that, you must **`sudo cp /home/git-nostr/.ssh/authorized_keys /etc/ssh/git-authorized_keys`** after every new key or bridge restart, or keys will be missing for `git@…` clones.)

Restart SSH:

```bash
sudo sshd -t && sudo systemctl reload ssh
```

### Step 10: Set Up Bridge Service

```bash
sudo nano /etc/systemd/system/git-nostr-bridge.service
```

```ini
[Unit]
Description=Git-Nostr-Bridge Service
After=network.target

[Service]
Type=simple
User=git-nostr
WorkingDirectory=/home/git-nostr/gittr/ui/gitnostr
ExecStart=/home/git-nostr/gittr/ui/gitnostr/bin/git-nostr-bridge
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable git-nostr-bridge
sudo systemctl start git-nostr-bridge
sudo systemctl status git-nostr-bridge
```

**To restart the bridge after config changes:**

```bash
sudo systemctl restart git-nostr-bridge
sudo systemctl status git-nostr-bridge
# Or view logs
sudo journalctl -u git-nostr-bridge -f
```

### Step 11: Set Up Frontend Service

```bash
sudo nano /etc/systemd/system/gittr-frontend.service
```

```ini
[Unit]
Description=gittr Frontend Service
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/gittr/ui
ExecStart=/usr/bin/npm start
# Note: This runs the production build created in Step 4 (npm run build)
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

**Update `WorkingDirectory` to your actual path** (e.g., `/home/user/gittr/ui`).

```bash
sudo systemctl daemon-reload
sudo systemctl enable gittr-frontend
sudo systemctl start gittr-frontend
sudo systemctl status gittr-frontend
```

### Step 12: Configure Telegram Webhook (Optional)

**Note:** No special dependencies are required for Telegram notifications. The platform uses the Telegram Bot API via HTTP requests (built into Node.js), so no additional npm packages or system dependencies are needed.

After deployment, configure Telegram webhook:

```bash
cd ui
node configure-webhook.js gittr.space
```

Verify webhook:

```bash
curl https://gittr.space/api/telegram/webhook-status
```

**Note:** Telegram bot token and channel ID are configured in `ui/.env.local` (from Step 3). Bot is admin in the gittr.space channel for "Post Messages" permission.

### Step 13: Configure Reverse Proxy (nginx)

```bash
sudo apt install nginx
sudo nano /etc/nginx/sites-available/gittr
```

Add API rate-limit zones in `/etc/nginx/nginx.conf` (inside `http {}`):

```nginx
limit_req_zone $binary_remote_addr zone=api_per_ip:20m rate=600r/m;
limit_req_zone $binary_remote_addr zone=auth_per_ip:10m rate=180r/m;
limit_conn_zone $binary_remote_addr zone=conn_per_ip:10m;
```

```nginx
server {
    listen 80;
    server_name gittr.space;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name gittr.space;

    ssl_certificate /etc/letsencrypt/live/gittr.space/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/gittr.space/privkey.pem;

    location ^~ /api/ {
        # Return 429 for throttled API traffic (instead of default 503)
        limit_req_status 429;
        limit_req zone=api_per_ip burst=50 nodelay;
        limit_conn conn_per_ip 30;
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Git bridge subdomain (for HTTPS git clones)
# Assumes git.gittr.space DNS record points to this server
server {
    listen 80;
    server_name git.gittr.space;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name git.gittr.space;

    ssl_certificate /etc/letsencrypt/live/git.gittr.space/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/git.gittr.space/privkey.pem;

    # Git bridge HTTP service (git-nostr-bridge)
    # Default port is 8080, adjust if your bridge uses a different port
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;

        # Git smart HTTP protocol requires these headers
        proxy_buffering off;
        proxy_request_buffering off;
    }
}
```

**gittr Pages (nsite gateway):** After DNS for **`pages.gittr.space`** points at this server, merge **`infra/nsite-gateway/nginx-pages.gittr.space.conf.example`** into `sites-available/gittr` (HTTP-only first). Deploy the gateway from your laptop (files under **`/opt/ngit/infra/nsite-gateway`**):

```bash
chmod +x scripts/deploy-nsite-gateway.sh
./scripts/deploy-nsite-gateway.sh your.gateway.host
```

**Server prerequisites:** Docker Engine + **`docker compose`**. On **Ubuntu 24.04** use `docker-compose-v2` (not always named `docker-compose-plugin`):  
`sudo apt install -y docker.io docker-compose-v2` then `sudo systemctl enable --now docker`.

After the main app is on the server, whenever **`infra/nsite-gateway`** or **`infra/gittr-nsite-gateway`** change, run **`./scripts/deploy-nsite-gateway.sh`** from your laptop (pass your SSH target as the first argument; see script header). That syncs gateway files and rebuilds the Docker stack (including **`/status/manifests.json`**).

```bash
sudo ln -s /etc/nginx/sites-available/gittr /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

After the **`pages.gittr.space`** HTTP `server` block is in place and DNS resolves, obtain its certificate:

```bash
sudo certbot --nginx -d pages.gittr.space
```

**Per-site links (`*.pages.gittr.space`):** The nsite gateway’s **Status** page links to hostnames like `{id}.pages.gittr.space`. The apex record **`pages`** alone is **not** enough: Firefox fails because those hostnames **do not resolve** until you add a **wildcard** DNS name and a **wildcard TLS** certificate.

1. **Cloudflare** (zone `gittr.space`) → **DNS** → **Add record**  
   - **Type:** A  
   - **Name:** `*.pages` (this covers any `something.pages.gittr.space`)  
   - **IPv4:** same server as `pages`  
   - **Proxy:** **DNS only** (grey cloud) so Let’s Encrypt on **your nginx** can validate and serve HTTPS for arbitrary subdomains.

2. **Wait for DNS**, then check: `dig +short randomtest.pages.gittr.space A` → should return your server IP.

3. **Wildcard certificate** (HTTP-01 cannot issue `*.`; use **DNS-01** with Cloudflare):

   ```bash
   sudo apt install -y python3-certbot-dns-cloudflare
   sudo install -d -m 700 /root/.secrets
   sudo nano /root/.secrets/cloudflare.ini
   ```

   Put only (create a **Zone → DNS → Edit** API token in Cloudflare for `gittr.space`):

   ```ini
   dns_cloudflare_api_token = YOUR_TOKEN_HERE
   ```

   ```bash
   sudo chmod 600 /root/.secrets/cloudflare.ini
   sudo certbot certonly --dns-cloudflare --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
     --cert-name pages-gittr-wildcard \
     -d 'pages.gittr.space' -d '*.pages.gittr.space' \
     --non-interactive --agree-tos --register-unsafely-without-email
   ```

   **Easier (keeps the same cert name `pages.gittr.space` nginx already uses):** on the server run **`/opt/ngit/infra/nsite-gateway/expand-wildcard-cert.sh`** (from this repo: `infra/nsite-gateway/expand-wildcard-cert.sh`) after `cloudflare.ini` exists — it uses **`certbot --expand`** so paths stay **`/etc/letsencrypt/live/pages.gittr.space/`**.

4. **nginx:** In **both** the **443** and **80** `server` blocks for gittr Pages, set:

   - `server_name pages.gittr.space *.pages.gittr.space;`

   For **port 80**, replace Certbot’s `if ($host = pages...) { return 301 ... }` + `return 404` combo (it breaks subdomains) with a single redirect:

   ```nginx
   return 301 https://$host$request_uri;
   ```

   SSL paths stay **`/etc/letsencrypt/live/pages.gittr.space/...`** if you used **`--expand`** as above.

   Then: `sudo nginx -t && sudo systemctl reload nginx`.

**gittr gateway overlay:** The repo ships **`infra/gittr-nsite-gateway`** (Docker build clones upstream **hzrd149/nsite-gateway** at image build time, applies our overlay) adding **`GET /status/manifests.json`**. On **your server**, from **`infra/nsite-gateway`**, run `docker compose -f docker-compose.yml -f docker-compose.gittr-gateway.yml up -d --build` so gittr’s **`/pages`** app can consume JSON instead of scraping HTML. See **`infra/gittr-nsite-gateway/README.md`**. Production uses **your** `pages.gittr.space` host only; a separate GitHub fork of upstream is **optional** for maintainers who want it, not required for users or traffic.

### Step 14: Configure SSL Certificate

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d gittr.space -d git.gittr.space
# After adding the pages.gittr.space server block in nginx:
# sudo certbot --nginx -d pages.gittr.space
```

This will automatically update the nginx config with SSL certificates.

## Terminal Git Setup

**You DON'T need a git subdomain.** Use the same domain (`gittr.space`) for both web and SSH.

**Configuration in `ui/.env.local`:**

```
NEXT_PUBLIC_DOMAIN=gittr.space
NEXT_PUBLIC_GIT_SSH_BASE=gittr.space
NEXT_PUBLIC_SITE_URL=https://gittr.space
NEXT_PUBLIC_GITTR_PAGES_URL=https://pages.gittr.space
```

The optional **`NEXT_PUBLIC_GITTR_PAGES_URL`** (no trailing slash) powers the in-app **Pages** nav link (opens `/pages` in a **new tab** from the header so your current view stays open), the **`/pages`** directory (loads published sites from the gateway: prefers **`/status/manifests.json`** from the **gittr nsite-gateway fork**, otherwise parses **`/status`** HTML), and owner-repo hints for **Publish as gittr Pages**; default in code is `https://pages.gittr.space` if unset. The Next.js route **`GET /api/gittr-pages/status-sites`** (cached ~2 minutes) must reach the gateway from the app server.

**Pages directory cards:** live snapshot backgrounds are **disabled** (image.thum.io often returned a valid image that was only a “paid account” banner, so cards looked broken). Cards use a solid theme background. The list is **deduplicated** for the UI: same author + same description, **portal** + npub-style site labels, or identical titles are merged; the card **title** prefers a real site title, otherwise the gateway **description** (e.g. “Sweet 🍭”) instead of the raw `portal` / npub hostname label when that reads better. Author lines use a **short label** with the **full npub in the tooltip** when we have hex.

**Repo sidebar (gittr Pages):** when the owner pubkey is known, viewers see **Live site** (canonical NIP-5A URL for that repo: base36 + short repo tag) and **Directory** (`/pages`). **Owners and maintainers** get **Add gittr Pages links to README** (owners: updates or inserts the fenced gittr Pages block with that URL; maintainers: copies the snippet). When an owner uses that control (or the auto-readme-on-push path), gittr also writes the same body into **`README.md` in separate file storage** if that file exists in the local tree, so the file editor and **Push to Nostr** / bridge file payloads stay aligned with `repo.readme`. Owners can enable **“Let gittr update README for Pages on push”** (off by default): when on, **Push to Nostr** refreshes that README block before signing; when off, push is blocked unless the README already contains a valid fenced block including the live URL. The NIP-5A **site manifest on relays** (not `manifest.json` in git) is what the gateway serves; README handling is separate. The **`/pages`** directory deduplicates by site hostname so duplicate gateway rows do not show twice. After changing README, the owner must **Push to Nostr** again so relays pick up the doc for all clients.

**Owner shortcuts:** **README + Push to Nostr** is the default after local edits: it updates the fenced Pages block then triggers the existing **Push to Nostr** button (signatures / Lightning paywall unchanged). After a successful push, this tab already has **event IDs in local storage** — you do **not** need to refetch from relays before the next **README + Push** for this browser; relay gossip mainly matters for **other** clients and devices. **Refetch Nostr → README + Push** (when **Refetch from Nostr** is shown) is **optional**: use it when you want relays as the read source of truth (stale local tree, edits elsewhere, verification). It sets a small `sessionStorage` marker, runs refetch, and after the reload applies the README block then triggers Push.

**Publish Pages manifest (Blossom + kind 35128):** Owners get **Publish Pages manifest** in the **gittr Pages** sidebar. The client signs **NIP-07** kind **24242** tokens per file, then **`POST /api/gittr-pages/blossom-proxy-upload`** forwards **`PUT /upload`** to **`NEXT_PUBLIC_BLOSSOM_URL`** (default `https://blossom.band`) so the browser avoids cross-origin limits to the CDN. After uploads, the client signs and publishes the **named-site manifest** (kind **35128**) to the app’s relays. Size limits apply (see route + `publish-named-site-manifest.ts`). You can still use any other NIP-5A tool instead. **File bytes for upload** are resolved in order: inline content in browser storage, optional per-file `url` (e.g. GitHub raw — may fail from the browser due to CORS), then same-origin **`GET /api/git/file-content`** using the repo’s stored **`sourceUrl`** and branch, then **`GET /api/nostr/repo/file-content`** for bridge-backed trees — so a **RAW** link in the UI alone is not required; what matters is that the server can read the tree (import URL + branch, or bridge).

**Blossom MIME (415 / 400):** Public Blossom (e.g. nostr.build) **sniffs bytes** and compares them to the **`Content-Type`** on **`PUT /upload`**. Sending **`application/octet-stream`** can cause **415**; sending **`text/javascript`** while the body is a **valid JSON document** (common if a `.js` file was accidentally stored as **`JSON.stringify(source)`**) causes **400** (“Content-Type … does not match … expected **application/json**”). Gittr derives MIME in **`blossom-upload-mime.ts`**: path defaults (`.js` → **`application/javascript`**), **strict-JSON sniff** → **`application/json`**, optional **unwrap** of JSON-stringified script bytes for `.js`/`.mjs`/`.cjs` before hashing/upload, and the **`blossom-proxy-upload`** route **reconciles** a mismatched client `contentType` against the decoded blob. If a type still fails, try another **`NEXT_PUBLIC_BLOSSOM_URL`** or confirm the file bytes in the browser are the real asset (not an API error JSON body).

**Nginx and long uploads:** If **`/api/gittr-pages/blossom-proxy-upload`** returns **502** with no JSON body, nginx may be timing out the Next.js upstream before the handler finishes — add **`proxy_read_timeout`** / **`proxy_send_timeout`** (e.g. 180s) on the **`proxy_pass`** block that serves **`/api/`** (see production `sites-available/gittr` and **`nginx.gittr.conf.example`**).

**End-to-end order (nothing or partially wrong):** (1) Fix **site files** in the repo (e.g. `index.html` and assets) locally until the tree is correct — **Refetch from Nostr** only if this copy might be behind what relays have. (2) Optionally fix the **README** gittr Pages fenced block (**README + Push**, or button / checkbox before push). (3) **Push to Nostr** so repo + README metadata are on relays. (4) **Publish Pages manifest** (or external nsite tooling): kind **35128** plus Blossom blobs so the gateway can resolve paths. Wrong README does not substitute for a missing manifest; wrong HTML in the repo must be fixed in step 1 before step 4 can reference it.

**Tracking on gittr only:** **“New issue: manifest draft and checklist”** is optional documentation in the **gittr** issue composer (`sessionStorage` prefill). Issues are **browser-local** (`readRepoIssuesFromLocalStorage` merges npub vs hex keys so close/reopen stays consistent). They are **not** opened on any external forge unless you copy them yourself.

**Note:** `NEXT_PUBLIC_SITE_URL` is used for:

- SEO metadata (sitemap, robots.txt, Open Graph tags)
- GRASP server file fetching (internal API calls)
- Defaults to `https://gittr.space` if not set

**Sitemap / SEO:** `sitemap.xml` is regenerated on a **one-hour cache** (`revalidate`). It **queries your configured Nostr relays** (`NEXT_PUBLIC_NOSTR_RELAYS`, same list as the web app) for repository events (kinds **51** and **30617**), dedupes NIP-34 replaceable events, respects kind **5** deletions, and builds URLs as `npub1…/repo-id`. New repos therefore appear in the sitemap **without** redeploying or maintaining a static list—provided production has the same relay list users rely on for discovery. Optionally, the app still merges lines from `nostr-pushed-repos.txt` if present (repo root or parent of `ui/`) for bridge-only or extra paths; that file remains **gitignored** for private exports. Bridge export files matching `gittr_nostr_repos_*.txt` are for helper scripts only. See `nostr-pushed-repos.example.txt` and `repo-list-ownerhex-for-username-script.example.txt` for file formats. For **CI or offline builds** where you must not open relay connections, set `SITEMAP_SKIP_NOSTR=1` (sitemap will use static pages + optional file only). **Old git history may still contain removed list files** until rewritten; rotate keys if that exposure matters.

**Note:** The `git-nostr-bridge` service doesn't use these environment variables - it uses its own JSON config file (`~/.config/git-nostr/git-nostr-bridge.json`). The frontend uses `NEXT_PUBLIC_GIT_SSH_BASE` to construct clone URLs displayed to users.

**How it works:**

- Web server (nginx) handles HTTPS on port 443
- SSH server (git-nostr-bridge) handles SSH on port 22
- Different ports = no conflict

**For terminal Git to work:**

1. Bridge service must be running (Step 10)
2. SSH port 22 must be accessible
3. Users publish SSH keys via Settings → SSH Keys in the web UI
4. Bridge automatically adds keys to `/home/git-nostr/.ssh/authorized_keys`
5. **`git@` and sshd:** After deploy (or when `git@` asks for a password despite keys in the UI), run `SSH_DEPLOY_KEY=~/.ssh/your_key ./scripts/ensure-sshd-git-live-authorized-keys.sh <host>` so `Match User git` in `sshd_config` does **not** point at a stale `/etc/ssh/git-authorized_keys` copy. Without that, new keys can work for `git-nostr@` but **`git@` falls back to password auth**. If you use a local `upload_to_hetzner.sh` (often gitignored), merge a call to that script at the end of your upload flow, or set `SKIP_SSHD_GIT_KEYS_FIX=1` there only if you intentionally manage `sshd_config` elsewhere.

**Test Git clone:**

```bash
git clone git@gittr.space:npub1.../repo-name.git
```

## Verification

### Check Services

```bash
# Frontend
sudo systemctl status gittr-frontend

# Bridge
sudo systemctl status git-nostr-bridge

# View logs
sudo journalctl -u gittr-frontend -n 50
sudo journalctl -u git-nostr-bridge -n 50
```

### Test Access

- Visit `https://gittr.space` - should see gittr.space login page
- Check bridge logs show relay connections
- Test Git clone: `git clone git@gittr.space:<pubkey>/<repo>.git`

## Troubleshooting

### Frontend not starting

- Check logs: `sudo journalctl -u gittr-frontend -n 100`
- Verify `.env.local` exists and is configured
- Check `WorkingDirectory` path in service file is correct

### Bridge not connecting to relays

- Check `relays` array in `~/.config/git-nostr/git-nostr-bridge.json`
- Verify relay URLs match those in `ui/.env.local`
- Check logs: `sudo journalctl -u git-nostr-bridge -n 100`

### Git clone fails

- Verify SSH key published via gittr.space UI
- Check SSH server: `sudo systemctl status sshd`
- Test SSH: `ssh git-nostr@gittr.space`
- Ensure port 22 is open: `sudo ufw allow 22/tcp`
- If `Too many authentication failures` appears, force one key:
  - `GIT_SSH_COMMAND='ssh -o IdentitiesOnly=yes -i ~/.ssh/<key>' git ls-remote git-nostr@gittr.space:<pubkey>/<repo>.git`
- Keep fail2ban thresholds practical for real users (avoid aggressive permanent bans for normal retries).

### Push paywall blocks pushes

- If terminal shows `push payment required ...`, generate/pay invoice in repo UI via **Push to Nostr**, then retry `git push`.
- After merging a PR with paywall enabled, pay the invoice in the on-screen QR modal (or use **Push to Nostr** afterward) so the merged state can reach the bridge.
- If terminal shows `push payment authorization expired`, pay pending invoice (or create a new one) and push again.
- Verify repo owner has configured `LNbits Invoice Key` or `Blink API Key` in Settings -> Account before setting non-zero Push Cost.

### Telegram webhook not working

- Check webhook status: `curl https://gittr.space/api/telegram/webhook-status`
- Verify bot is admin in channel with "Post Messages" permission
- Check `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env.local`

## Docker Setup (Alternative to Manual Installation)

If you're using Docker, you don't need to install Go or set up system users manually. The Docker image includes everything.

### Prerequisites for Docker

- Docker and Docker Compose installed
- Port 22 available (or change port mapping in `docker-compose.yml`)

### Docker Setup Steps

1. **Edit the Dockerfile** (`ui/gitnostr/Dockerfile`):

   - Replace the `gitRepoOwners` array with your Nostr pubkey (hex format, NOT npub)
   - Update the `relays` array to match your `.env.local` configuration

2. **Build and run the bridge container:**

```bash
cd ui
docker compose up -d git-nostr-bridge
```

3. **Check logs:**

```bash
docker logs -f git-nostr-bridge
```

4. **Verify it's running:**

```bash
docker ps | grep git-nostr-bridge
```

**Important:** In Docker, the bridge runs as `root` inside the container. The "your user" concept doesn't apply - everything runs inside the container. The Nostr nsec/pubkey in your `.env.local` is for platform authentication, not system user management.
