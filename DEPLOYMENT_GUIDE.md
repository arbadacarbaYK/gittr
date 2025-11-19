# gittr.space Deployment Guide for Server Administrators

This guide is designed for server administrators who need to deploy gittr.space on a production server. It provides a comprehensive, step-by-step approach to getting gittr.space running in a production environment.

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start Checklist](#quick-start-checklist)
3. [Detailed Setup Steps](#detailed-setup-steps)
4. [Configuration Reference](#configuration-reference)
5. [Verification & Testing](#verification--testing)
6. [Troubleshooting](#troubleshooting)
7. [Maintenance & Updates](#maintenance--updates)

---

## Prerequisites

Before starting, ensure you have:

- **Server access**: Root or sudo access to a Linux server (Ubuntu 20.04+ recommended)
- **Domain name**: A domain name pointing to your server (for HTTPS)
- **Nostr relay**: Access to configure an existing Nostr relay OR use public relays
- **Blossom server**: Access to a NIP-96 Blossom server OR use a public instance
- **Basic knowledge**: Familiarity with Linux, Git, Node.js, and systemd services

### Software Requirements

- **Node.js 18+** and npm/yarn
- **Go 1.20+** (for git-nostr-bridge)
- **Git** (for cloning repositories)
- **nginx** (or another reverse proxy)
- **SSL certificate** (Let's Encrypt recommended)

---

## Quick Start Checklist

Use this checklist to track your deployment progress:

- [ ] **Step 1**: Configure Nostr relay to allow required event kinds
- [ ] **Step 2**: Configure Blossom server (NIP-96)
- [ ] **Step 3**: Clone repository and install dependencies
- [ ] **Step 4**: Configure frontend environment variables
- [ ] **Step 5**: Set up git-nostr-bridge service
- [ ] **Step 6**: Configure SSH for Git operations
- [ ] **Step 7**: Set up reverse proxy (nginx)
- [ ] **Step 8**: Configure SSL/TLS certificates
- [ ] **Step 9**: Test all functionality
- [ ] **Step 10**: Set up monitoring and backups

---

## Detailed Setup Steps

### Step 1: Configure Nostr Relay

**Why**: gittr requires specific Nostr event kinds to function. Your relay must allow these kinds.

**Required Event Kinds:**
- **Kind 0** (Metadata) - User profiles
- **Kind 1** (Notes) - Comments and discussions
- **Kind 50** (Repository Permissions) - Git access control
- **Kind 51** (Repository) - Repository announcements
- **Kind 52** (SSH Keys) - Git authentication
- **Kind 9735** (Zaps) - Lightning payments
- **Kind 9803** (Issues) - Issue tracking
- **Kind 9804** (Pull Requests) - Code reviews

#### For nostr-rs-relay:

Edit your relay config file (usually `/etc/nostr-rs-relay/config.toml`):

```toml
[relay]
# Allow all kinds (recommended for public relays)
# OR specify allowed kinds:
allowed_kinds = [0, 1, 50, 51, 52, 9735, 9803, 9804]
```

Restart the relay:
```bash
sudo systemctl restart nostr-rs-relay
```

#### For strfry:

Edit your `strfry.conf`:

```yaml
relay:
  eventKinds:
    allow: [0, 1, 50, 51, 52, 9735, 9803, 9804]
```

Restart strfry:
```bash
sudo systemctl restart strfry
```

**Verify**: Test that your relay accepts these kinds by checking relay logs for "event kind not allowed" errors.

---

### Step 2: Configure Blossom Server (NIP-96)

**Why**: Blossom server stores Git pack files (large binary data) for repositories.

1. **Ensure Blossom server allows the same event kinds** as your relay (see Step 1)

2. **Note the Blossom server URL** - You'll need this for the frontend configuration

3. **Test Blossom server** (optional):
```bash
curl -X GET https://blossom.gittr.space/nip96/info
```

**If using a public Blossom instance**: You can use `https://blossom.band` or another public instance.

---

### Step 3: Clone Repository and Install Dependencies

```bash
# Clone repository (Gittr source repo is still hosted under the legacy 'ngit' name)
git clone https://github.com/arbadacarbaYK/gittr.git 
cd ngit

# Install frontend dependencies
cd ui
npm install

# Build for production (optional, for testing)
npm run build
```

---

### Step 4: Configure Frontend Environment Variables

Create the environment file:

```bash
cd ui
cp .env.example .env.local  

##################### TELEGRAM WEBHOOK SETUP ####################
# REQUIRED for NIP-39 verification to work
#
# After deployment to production, configure the webhook:
#
# Option 1: Use the helper script (recommended)
#   cd ui
#   node configure-webhook.js gittr.space
#
# Option 2: Manual configuration
#   curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://gittr.space/api/telegram/webhook"
#
# Verify webhook is configured:
#   curl http://localhost:3000/api/telegram/webhook-status
#   (or https://gittr.space/api/telegram/webhook-status)
#
# The webhook will:
# - Monitor the channel (TELEGRAM_CHAT_ID) for verification messages
# - Reply in channel with message ID when verification message is detected
# - Send private DMs to users with both User ID and Message ID when they DM the bot
# - Help users complete NIP-39 Telegram identity verification
#
# IMPORTANT:
# - For PRODUCTION: NO ngrok needed! Configure directly to your domain.
#   See PRODUCTION_TELEGRAM_SETUP.md for detailed production setup steps.
# - For LOCAL TESTING: Use ngrok (see TELEGRAM_WEBHOOK_LOCAL_SETUP.md)
# - Bot must be ADMIN in the channel with "Post Messages" permission

# Note: No additional dependencies needed for notifications
# - Telegram notifications use native fetch API (built into Node.js 18+)
# - Nostr notifications use nostr-tools (already in dependencies)
# - No Python, python-telegram-bot, or other external services required
```

**Important Notes:**
- For GitHub OAuth setup, see `ui/GITHUB_OAUTH_SETUP.md`
- For GitHub Platform Token setup, see `ui/GITHUB_PLATFORM_TOKEN_SETUP.md`

---

### Step 5: Set Up git-nostr-bridge Service

**Why**: The bridge is essential for `git clone`, `git push`, and `git pull` operations.

#### 5.1: Install Go

```bash
# Linux (Ubuntu/Debian)
wget https://go.dev/dl/go1.21.5.linux-amd64.tar.gz
sudo tar -C /usr/local -xzf go1.21.5.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
source ~/.bashrc
go version  # Verify: should show go1.21.5 or higher
```

#### 5.2: Create Dedicated User

**⚠️ CRITICAL**: Never run the bridge as your own user! It overwrites `authorized_keys`.

```bash
# Create git-nostr user
sudo useradd --create-home --shell /bin/bash git-nostr
sudo su - git-nostr
```

#### 5.3: Build Bridge

```bash
# As git-nostr user
cd ~
git clone https://github.com/arbadacarbaYK/gittr.git 
cd ngit/ui/gitnostr
make git-nostr-bridge

# Verify binaries
ls -la ./bin/
# Should show: git-nostr-bridge, git-nostr-ssh
```

#### 5.4: Configure Bridge

```bash
# Run once to create config file
./bin/git-nostr-bridge
# Press Ctrl+C after you see "no relays connected"
```

Edit `~/.config/git-nostr/git-nostr-bridge.json`:

```json
{
    "repositoryDir": "/home/git-nostr/git-nostr-repositories",
    "DbFile": "/home/git-nostr/.config/git-nostr/git-nostr-db.sqlite",
    "relays": [
        "wss://relay.noderunner.network",
        "wss://nostr.azzamo.net",
        "wss://relay.damus.io",
        "wss://nos.lol",
        "wss://gitnostr.com",
        "wss://relay.ngit.dev"
    ],
    "gitRepoOwners": [
        "<your-nostr-pubkey-here>",
        "<other-authorized-pubkeys>"
    ]
}
```

**Important:**
- `relays`: Use your existing relays plus public Grasp instances
- `gitRepoOwners`: List of Nostr pubkeys (64-char hex) that can create repositories
- `repositoryDir`: Use absolute path in production

#### 5.5: Configure SSH Server

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

#### 5.6: Run Bridge as Service

Create systemd service:

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
WorkingDirectory=/home/git-nostr/ngit/ui/gitnostr
ExecStart=/home/git-nostr/ngit/ui/gitnostr/bin/git-nostr-bridge
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable git-nostr-bridge
sudo systemctl start git-nostr-bridge
sudo systemctl status git-nostr-bridge
```

---

### Step 6: Configure Reverse Proxy (nginx)

**Why**: nginx handles HTTPS, SSL termination, and proxies requests to Next.js.

#### 6.1: Install nginx

```bash
sudo apt update
sudo apt install nginx
```

#### 6.2: Configure nginx

```bash
sudo nano /etc/nginx/sites-available/gittr
```

```nginx
# HTTP to HTTPS redirect
server {
    listen 80;
    server_name gittr.space;
    return 301 https://$server_name$request_uri;
}

# HTTPS server
server {
    listen 443 ssl http2;
    server_name gittr.space;
    
    # SSL certificates (Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/gittr.space/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/gittr.space/privkey.pem;
    
    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    
    # Frontend (Next.js)
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
```

Enable site:

```bash
sudo ln -s /etc/nginx/sites-available/gittr /etc/nginx/sites-enabled/
sudo nginx -t  # Test configuration
sudo systemctl restart nginx
```

---

### Step 7: Configure SSL/TLS Certificates

**Using Let's Encrypt (Recommended):**

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d gittr.space

# Auto-renewal (should be set up automatically)
sudo certbot renew --dry-run
```

---

### Step 8: Set Up Next.js as Production Service

Create systemd service for Next.js:

```bash
sudo nano /etc/systemd/system/gittr-frontend.service
```

```ini
[Unit]
Description=gittr Frontend (Next.js)
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/gittr/ui
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=10
Environment=NODE_ENV=production
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

**Note**: Adjust paths and user as needed. You may want to use PM2 or another process manager instead.

---

## Configuration Reference

### Environment Variables Summary

| Variable | Location | Required | Purpose |
|----------|----------|----------|---------|
| `NEXT_PUBLIC_NOSTR_RELAYS` | `ui/.env.local` | ✅ Yes | Comma-separated relay URLs |
| `NEXT_PUBLIC_BLOSSOM_URL` | `ui/.env.local` | ✅ Yes | Blossom server URL (for Git pack files) |
| `GITHUB_PLATFORM_TOKEN` | `ui/.env.local` | ❌ No | GitHub API token (higher rate limits) |
| `NOSTR_NSEC` | `ui/.env.local` | ❌ No | Nostr private key for notifications |
| `TELEGRAM_BOT_TOKEN` | `ui/.env.local` | ❌ No | Telegram bot token for notifications |
| `TELEGRAM_CHAT_ID` | `ui/.env.local` | ❌ No | Telegram channel ID for notifications |
| `TELEGRAM_BOT_TOKEN` | `ui/.env.local` | ❌ No | Telegram bot token |
| `TELEGRAM_CHAT_ID` | `ui/.env.local` | ❌ No | Telegram chat ID |

**⚠️ Security Note:** All sensitive values (tokens, keys, secrets) are in `.gitignore` and will NOT be committed to git. Only the server admin has access to these values.

### Port Configuration

| Service | Default Port | Production Port | Notes |
|---------|-------------|-----------------|-------|
| Next.js Frontend | 3000 | 3000 (internal) | Proxied through nginx on 443 |
| git-nostr-bridge SSH | 22 | 22 | Standard SSH port |
| nginx HTTP | 80 | 80 | Redirects to HTTPS |
| nginx HTTPS | 443 | 443 | Main entry point |

---

## Verification & Testing

### 1. Check Frontend

```bash
# Visit your domain
curl https://gittr.space

# Should return HTML (Next.js app)
```

### 2. Check Bridge Service

```bash
# Check service status
sudo systemctl status git-nostr-bridge

# Check logs
sudo journalctl -u git-nostr-bridge -n 50

# Should see:
# Connected to relay: wss://relay.noderunner.network
# Connected to relay: wss://nostr.azzamo.net
```

### 3. Test Git Operations

```bash
# From client machine (with SSH key published via gittr.space UI)
git clone git@gittr.space:<pubkey>/<repo-name>.git

# Should successfully clone
```

### 4. Test Repository Creation

1. Visit `https://gittr.space`
2. Log in with Nostr
3. Create a new repository
4. Verify it appears in the UI
5. Try cloning it via `git clone`

---

## Troubleshooting

### Frontend Not Loading

1. **Check Next.js is running:**
   ```bash
   sudo systemctl status gittr-frontend
   curl http://localhost:3000
   ```

2. **Check nginx configuration:**
   ```bash
   sudo nginx -t
   sudo systemctl status nginx
   ```

3. **Check environment variables:**
   ```bash
   cd ui
   cat .env.local  # Verify all required variables are set
   ```

### Bridge Can't Connect to Relays

1. **Check bridge logs:**
   ```bash
   sudo journalctl -u git-nostr-bridge -n 100
   ```

2. **Verify relay URLs in config:**
   ```bash
   sudo -u git-nostr cat ~/.config/git-nostr/git-nostr-bridge.json
   ```

3. **Test network connectivity:**
   ```bash
   ping relay.noderunner.network
   curl -v wss://relay.noderunner.network
   ```

### Git Clone Fails

1. **Check SSH server:**
   ```bash
   sudo systemctl status sshd
   ```

2. **Check git-nostr user:**
   ```bash
   id git-nostr
   sudo -u git-nostr ls -la ~/.ssh/
   ```

3. **Verify SSH key was published:**
   - Check gittr.space UI → Settings → SSH Keys
   - Verify key appears in bridge logs

4. **Test SSH connection:**
   ```bash
   ssh -v git-nostr@gittr.space
   ```

### SSL Certificate Issues

1. **Check certificate validity:**
   ```bash
   sudo certbot certificates
   ```

2. **Renew certificate:**
   ```bash
   sudo certbot renew
   ```

3. **Check nginx SSL config:**
   ```bash
   sudo nginx -t
   ```

---

## Maintenance & Updates

### Updating gittr

```bash
cd /path/to/gittr
git pull origin main
cd ui
npm install
npm run build  # If needed
sudo systemctl restart gittr-frontend
```

### Updating git-nostr-bridge

```bash
sudo systemctl stop git-nostr-bridge
sudo -u git-nostr bash -c "cd ~/gittr && git pull && cd ui/gitnostr && make git-nostr-bridge"
sudo systemctl start git-nostr-bridge
```

### Monitoring

**Set up log monitoring:**
```bash
# Frontend logs
sudo journalctl -u gittr-frontend -f

# Bridge logs
sudo journalctl -u git-nostr-bridge -f

# nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### Backups

**Important data to backup:**
- `~/.config/git-nostr/git-nostr-bridge.json` (bridge configuration)
- `~/.config/git-nostr/git-nostr-db.sqlite` (bridge database)
- `/home/git-nostr/git-nostr-repositories/` (Git repositories)
- `ui/.env.local` (frontend configuration)

**Backup script example:**
```bash
#!/bin/bash
BACKUP_DIR="/backup/gittr/$(date +%Y%m%d)"
mkdir -p "$BACKUP_DIR"

# Backup bridge config and DB
sudo -u git-nostr cp -r ~/.config/git-nostr "$BACKUP_DIR/"

# Backup repositories
sudo -u git-nostr tar -czf "$BACKUP_DIR/repositories.tar.gz" ~/git-nostr-repositories/

# Backup frontend config
cp /path/to/gittr/ui/.env.local "$BACKUP_DIR/"
```

---

## Additional Resources

- **[SETUP_INSTRUCTIONS.md](SETUP_INSTRUCTIONS.md)**: Detailed setup instructions with Docker options
- **[GIT_NOSTR_BRIDGE_SETUP.md](GIT_NOSTR_BRIDGE_SETUP.md)**: Detailed bridge setup guide
- **[ui/GITHUB_OAUTH_SETUP.md](ui/GITHUB_OAUTH_SETUP.md)**: GitHub OAuth configuration
- **[ui/GITHUB_PLATFORM_TOKEN_SETUP.md](ui/GITHUB_PLATFORM_TOKEN_SETUP.md)**: GitHub Platform Token setup
- **[docs/GRASP_RELAY_SETUP.md](docs/GRASP_RELAY_SETUP.md)**: Setting up relay instance (Grasp protocol)

---

## Security Checklist

- [ ] Running bridge as dedicated `git-nostr` user (not your own user)
- [ ] Firewall configured (only expose ports 80, 443, 22)
- [ ] SSL/TLS certificates configured and auto-renewing
- [ ] Environment variables not committed to git
- [ ] SSH keys properly managed (published via gittr.space UI)
- [ ] Regular backups configured
- [ ] Log monitoring set up
- [ ] System updates applied regularly

---

## Recent Updates & Fixes

### NWC Payment Implementation (2024-01) ✅
- **Fixed**: NWC (Nostr Wallet Connect) payments now work reliably
- **Change**: Simplified payment flow - send event, wait for relay `OK`, return success
- **Result**: Payments complete quickly without timeouts
- **Technical**: Removed complex subscription logic for wallet response events; relay acceptance confirms delivery

---

**Last Updated:** 2024-01-XX  
**For Issues:** See [GitHub Issues](https://github.com/arbadacarbaYK/ngit/issues) (repo currently hosted under the legacy `ngit` name)  
**For Questions:** Contact the project maintainers

