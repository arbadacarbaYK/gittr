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

```bash
cd ui
npm install
```

### Step 3: Configure Environment

```bash
cd ui
cp .env.example .env.local
```

Edit `ui/.env.local` with your values. All configuration is in this file - domain, relays, Blossom URL, GitHub OAuth, etc. are already set with working defaults.

### Step 4: Build Frontend

```bash
cd ui
npm run build
```

### Step 5: Install Go (for building git-nostr-bridge) OR Use Docker

**Note:** Go is only required to BUILD the bridge from source. If you have a pre-built binary, you can skip this step.

**If using Docker:** Skip Go installation - Go is already included in the Docker image. See "Docker Setup" section below.

**Option 1: System-wide installation (requires sudo):**
```bash
wget https://go.dev/dl/go1.21.5.linux-amd64.tar.gz
sudo tar -C /usr/local -xzf go1.21.5.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
export PATH=$PATH:/usr/local/go/bin  # For immediate use in current session
go version
```

**Use this option if:** You have sudo access and want Go installed system-wide (available to all users). Works on both production servers and localhost.

**Option 2: User-local installation (no sudo required):**
```bash
wget https://go.dev/dl/go1.21.5.linux-amd64.tar.gz
mkdir -p ~/go-local
tar -xzf go1.21.5.linux-amd64.tar.gz -C ~/go-local
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
        "wss://relay.noderunner.network",
        "wss://nostr.azzamo.net",
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
- Need a deeper dive into every knob? See the extracted gitnostr repo's
  [`docs/STANDALONE_BRIDGE_SETUP.md`](STANDALONE_BRIDGE_SETUP.md) for a complete
  standalone bridge guide.

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
AllowUsers git-nostr
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
PermitUserEnvironment yes
```

Restart SSH:
```bash
sudo systemctl restart sshd
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

```bash
sudo ln -s /etc/nginx/sites-available/gittr /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Step 14: Configure SSL Certificate

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d gittr.space -d git.gittr.space
```

This will automatically update the nginx config with SSL certificates.

## Terminal Git Setup

**You DON'T need a git subdomain.** Use the same domain (`gittr.space`) for both web and SSH.

**Configuration in `ui/.env.local`:**
```
NEXT_PUBLIC_DOMAIN=gittr.space
NEXT_PUBLIC_GIT_SSH_BASE=gittr.space
NEXT_PUBLIC_SITE_URL=https://gittr.space
```

**Note:** `NEXT_PUBLIC_SITE_URL` is used for:
- SEO metadata (sitemap, robots.txt, Open Graph tags)
- GRASP server file fetching (internal API calls)
- Defaults to `https://gittr.space` if not set

**Note:** The `git-nostr-bridge` service doesn't use these environment variables - it uses its own JSON config file (`~/.config/git-nostr/git-nostr-bridge.json`). The frontend uses `NEXT_PUBLIC_GIT_SSH_BASE` to construct clone URLs displayed to users.

**How it works:**
- Web server (nginx) handles HTTPS on port 443
- SSH server (git-nostr-bridge) handles SSH on port 22
- Different ports = no conflict

**For terminal Git to work:**
1. Bridge service must be running (Step 10)
2. SSH port 22 must be accessible
3. Users publish SSH keys via Settings → SSH Keys in the web UI
4. Bridge automatically adds keys to `authorized_keys`

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
