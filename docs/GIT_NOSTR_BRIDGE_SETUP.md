# Git-Nostr-Bridge Installation Guide

> **Badge legend:** 🆕 highlights gittr.space additions layered on top of @spearson78’s original
> gitnostr bridge so it’s clear what we’re contributing upstream.

The git-nostr-bridge is **essential** for Git operations (`git clone`, `git push`, `git pull`) to work with gittr.space repositories. This service watches Nostr for SSH key and repository events and manages Git repositories on the server.

## ⚠️ Important Security Warning

**DO NOT RUN THE BRIDGE AS YOUR OWN USER** - It will overwrite your `~/.ssh/authorized_keys` file!

## Prerequisites

### 1. Install Go (Required)

**Minimum version: Go 1.20+**

#### Linux (Ubuntu/Debian):
```bash
# Remove old Go if installed
sudo rm -rf /usr/local/go

# Download and install Go
wget https://go.dev/dl/go1.21.5.linux-amd64.tar.gz
sudo tar -C /usr/local -xzf go1.21.5.linux-amd64.tar.gz

# Add to PATH (add to ~/.bashrc or ~/.zshrc)
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
source ~/.bashrc

# Verify installation
go version  # Should show go1.21.5 or higher
```

#### macOS:
```bash
# Using Homebrew
brew install go

# Verify installation
go version
```

#### Production Server:
- Install Go following the same steps
- Ensure Go is in PATH for the system user that will run the bridge

### 2. Install Git (if not already installed)

```bash
# Linux
sudo apt-get update && sudo apt-get install -y git

# macOS
brew install git
```

## Installation Steps

### Step 1: Create Dedicated User for Git Operations

**This is critical for security!** The bridge overwrites `authorized_keys`, so it must run as a dedicated user.

```bash
# Create git-nostr user
sudo useradd --create-home --shell /bin/bash git-nostr

# Optionally set a password (for SSH access if needed)
sudo passwd git-nostr

# Switch to the new user
sudo su - git-nostr
```

### Step 2: Build git-nostr-bridge

While logged in as `git-nostr` user:

```bash
cd ~
git clone https://github.com/arbadacarbaYK/gittr.git
cd gittr/ui/gitnostr

# Build the bridge components
make git-nostr-bridge

# Verify binaries were created
ls -la ./bin/
# Should show:
# - git-nostr-bridge (main service)
# - git-nostr-ssh (SSH command handler)
```

### Step 3: Initialize Configuration

```bash
# Run bridge once to create config file
./bin/git-nostr-bridge
# You should see: "no relays connected"
# Press Ctrl+C to stop
```

### Step 4: Configure the Bridge

Edit the config file:

```bash
nano ~/.config/git-nostr/git-nostr-bridge.json
```

**Default config:**
```json
{
    "repositoryDir": "~/git-nostr-repositories",
    "DbFile": "~/.config/git-nostr/git-nostr-db.sqlite",
    "relays": [],
    "gitRepoOwners": []
}
```

**Production config example:**
```json
{
    "repositoryDir": "/home/git-nostr/git-nostr-repositories",
    "DbFile": "/home/git-nostr/.config/git-nostr/git-nostr-db.sqlite",
    "relays": [
        "wss://gitnostr.com",
        "wss://relay.ngit.dev",
        "wss://relay.damus.io",
        "wss://nos.lol",
        "wss://nostr.azzamo.net",
        "wss://nostr.mom",
        "wss://relay.nostr.band"
    ],
    "gitRepoOwners": [
        "<your-nostr-pubkey-here>"
    ]
}
```

**Important settings:**
- `repositoryDir`: Where Git repositories will be stored (use absolute path in production)
- `relays`: List of Nostr relays to watch for events. **Recommended**: Include Grasp protocol relays:
  - `wss://gitnostr.com` - Public Grasp instance
  - `wss://relay.ngit.dev` - gitworkshop.dev relay instance (part of ngit ecosystem)
  - See `docs/GRASP_RELAY_SETUP.md` for more Grasp instances and setting up your own
- `gitRepoOwners`: List of Nostr pubkeys that can create repositories on this server (leave empty to mirror *all* repos)
- `BRIDGE_HTTP_PORT` env var (optional): Set when you want the REST fast-lane on `/api/event`. Leave it unset to keep the bridge in relay-only mode. Defaults to `8080` if set.

| Key | Required | Default | Description |
| --- | --- | --- | --- |
| `repositoryDir` | ✅ | `~/git-nostr-repositories` | Filesystem path where bare repositories live. Use an absolute path in production. |
| `DbFile` | ✅ | `~/.config/git-nostr/git-nostr-db.sqlite` | SQLite database that caches repo + permission events so SSH checks are instant even if relays lag. |
| `relays` | ✅ | `[]` | Array of read-enabled relays (kinds 50/51/30617 + 52). Match the relays you publish to. |
| `gitRepoOwners` | optional | `[]` | When empty the bridge accepts repo events from anyone (“watch-all”). Add pubkeys to restrict creation. |
| `BRIDGE_HTTP_PORT` (env) | optional | unset | When set, exposes `/api/event` for POSTing signed events directly into the bridge. |

Need more context? The extracted gitnostr repository ships with
[`docs/STANDALONE_BRIDGE_SETUP.md`](STANDALONE_BRIDGE_SETUP.md)
containing a full standalone guide plus fleet-tested defaults.

**⚠️ Relay Configuration Required:** Ensure your relays allow the following event kinds:
- **Kind 50** (Repository Permissions) - Required for access control
- **Kind 51** (Repository) - Required for repository announcements
- **Kind 52** (SSH Keys) - Required for Git authentication
- See `docs/GRASP_RELAY_SETUP.md` for complete relay configuration instructions

### Step 5: Set Up SSH Server

The bridge needs SSH server to be running and configured to use `git-nostr-ssh` as the command handler.

#### Install SSH Server (if not installed):

```bash
# Ubuntu/Debian
sudo apt-get install -y openssh-server

# macOS (usually pre-installed, check with: sudo systemsetup -getremotelogin)
```

#### Configure SSH for git-nostr user:

```bash
# As git-nostr user, create SSH directory
mkdir -p ~/.ssh
chmod 700 ~/.ssh

# The bridge will manage authorized_keys automatically
# But you need to ensure SSH server allows the git-nostr user
```

#### SSH Server Configuration (as root):

Edit `/etc/ssh/sshd_config`:

```bash
sudo nano /etc/ssh/sshd_config
```

Add or verify these settings:

```
# Allow git-nostr user
AllowUsers git-nostr

# Enable SSH key authentication
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys

# Allow command execution (required for git operations)
PermitUserEnvironment yes
```

Restart SSH server:

```bash
sudo systemctl restart sshd  # Linux
# OR
sudo launchctl unload /System/Library/LaunchDaemons/ssh.plist  # macOS
sudo launchctl load /System/Library/LaunchDaemons/ssh.plist
```

### Step 6: Run the Bridge

🆕 **HTTP fast lane**: The bridge now includes an optional HTTP server for direct event submission,
which eliminates relay propagation delays. Events are processed immediately when sent directly to the
bridge, while the bridge still subscribes to relays for events from other clients (upstream behavior).

#### HTTP Server Configuration

**NEW FEATURE (gittr.space enhancement)**: The bridge exposes a REST API endpoint (`POST /api/event`) that accepts Nostr events directly. This allows the frontend to submit events immediately after publishing to relays, eliminating the typical 1-5 second delay for relay propagation.

The bridge HTTP server runs on port **8080** by default whenever `BRIDGE_HTTP_PORT` is set. Configure it via:

1. **Environment variable**: `export BRIDGE_HTTP_PORT=8080`
2. **Systemd service file**: `Environment=BRIDGE_HTTP_PORT=8080`

**🆕 HTTP Endpoint**: `POST http://localhost:8080/api/event`

**Request format:**
```json
{
  "id": "<event-id>",
  "pubkey": "<pubkey>",
  "created_at": <timestamp>,
  "kind": 30617,
  "tags": [
    ["d", "<repo-name>"],
    ["name", "<repo-name>"],
    ["description", "<description>"],
    ["clone", "https://relay.ngit.dev/<pubkey>/<repo>.git"],
    ["clone", "nostr://<author>@<relay>/<repo>"],
    ["relays", "wss://relay.damus.io"],
    ["maintainers", "<pubkey>"],
    ["t", "<topic>"],
    ["web", "<logo-url>"],
    ["web", "<link-url>"],
    ["r", "<commit-id>", "euc"],
    ["source", "<source-url>"],
    ["forkedFrom", "<forked-from-url>"]
  ],
  "content": "{...JSON content with files, metadata...}",
  "sig": "<signature>"
}
```

**Tag Details:**

**NIP-34 Standard Tags:**
- **Required** (NIP-34 spec): `d`, `name`, `description`, `clone` (at least one), `relays` (at least one), `maintainers`
- **Optional** (NIP-34 spec):
  - `["t", "<topic>"]` - Repository topics/tags (multiple allowed)
  - `["web", "<url>"]` - Web links (logoUrl, links array) - multiple allowed
  - `["r", "<commit-id>", "euc"]` - Earliest unique commit (if commits exist)

**🆕 gittr.space Extensions** (not in NIP-34 spec, but included for compatibility):
- `["source", "<url>"]` - Source URL (if imported from GitHub/GitLab/Codeberg) - *gittr.space addition*
- `["forkedFrom", "<url>"]` - Forked from URL (if repository is a fork) - *gittr.space addition*
- `["link", "<type>", "<url>", "<label>"]` - Structured links with type and label (docs, discord, slack, youtube, twitter, github, other) - *gittr.space addition*

**Note**: The bridge accepts the full NIP-34 event structure with all optional tags, including gittr.space extensions. These optional fields are included to make repository metadata available to other clients in the Nostr ecosystem. Standard NIP-34 clients will ignore unknown tags, so extensions are safe to include.

**Response:**
- `200 OK`: Event accepted and queued for processing
- `400 Bad Request`: Invalid event (missing required fields, event ID mismatch, or malformed JSON)
- `503 Service Unavailable`: Event queue full

**Event Validation:**
The bridge uses a **lenient validation approach** for direct API submissions:
- ✅ **Event ID verification**: If the provided event ID matches the calculated hash, the event structure is valid
- ✅ **Signature check**: Attempts to verify the event signature, but if it fails due to JSON serialization differences between JavaScript and Go libraries, the event is still accepted if the event ID is correct
- ✅ **Relay trust**: Events that were successfully published to Nostr relays are trusted (relays validate signatures before accepting events)
- ⚠️ **Note**: Signature check failures are logged as warnings but don't block processing, as serialization differences between `nostr-tools` (JS) and `go-nostr` (Go) can cause false negatives

The frontend (`ui/src/pages/api/nostr/repo/event.ts`) automatically proxies events to this endpoint after publishing to Nostr relays, ensuring immediate processing without waiting for relay propagation.

#### For Development (manual):

```bash
# As git-nostr user
cd ~/gittr/ui/gitnostr
./bin/git-nostr-bridge

# You should see:
# 🌐 [Bridge] Starting HTTP server on port 8080 for direct event submission
```

#### For Production (systemd service - Linux):

Create service file:

```bash
sudo nano /etc/systemd/system/git-nostr-bridge.service
```

**Service file content:**
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
# Optional: Configure HTTP server port (default: 8080)
Environment=BRIDGE_HTTP_PORT=8080

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable git-nostr-bridge
sudo systemctl start git-nostr-bridge

# Check status
sudo systemctl status git-nostr-bridge

# View logs
sudo journalctl -u git-nostr-bridge -f
```

#### For Production (launchd - macOS):

Create plist file:

```bash
nano ~/Library/LaunchAgents/com.gitnostr.bridge.plist
```

**Plist content:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.gitnostr.bridge</string>
    <key>ProgramArguments</key>
    <array>
        <string>/home/git-nostr/ngit/ui/gitnostr/bin/git-nostr-bridge</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/home/git-nostr/ngit/ui/gitnostr</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/home/git-nostr/git-nostr-bridge.log</string>
    <key>StandardErrorPath</key>
    <string>/home/git-nostr/git-nostr-bridge.error.log</string>
</dict>
</plist>
```

Load the service:

```bash
launchctl load ~/Library/LaunchAgents/com.gitnostr.bridge.plist
launchctl start com.gitnostr.bridge
```

## Configuration in gittr.space UI

After setting up the bridge, configure your gittr.space instance:

### 1. Set Git SSH Base

**⚠️ CRITICAL: There are TWO different SSH configurations - don't confuse them!**

#### A. Frontend Git SSH Base (for displaying clone URLs)

**Location:** `ui/.env.local`  
**Variable:** `NEXT_PUBLIC_GIT_SSH_BASE`  
**Format:** Just hostname (no `user@`)  
**Example:** `gittr.space`

This is used by the frontend to construct clone URLs displayed to users (e.g., `git@gittr.space:owner/repo.git`).

You can override this per-repository in **Repo Settings → Advanced → Git SSH Base** if needed.

#### B. git-nostr-cli Configuration (for CLI tool)

**Location:** `~/.config/git-nostr/git-nostr-cli.json`  
**Variable:** `gitSshBase`  
**Format:** Full `user@host` format  
**Example:** `git-nostr@gittr.space` (production) or `root@localhost` (Docker)

If you're using the `git-nostr-cli` tool (optional), configure it separately:

```bash
# Build the CLI tool
cd ui/gitnostr
make git-nostr-cli

# Run once to create config file
./bin/gn
# You should see: "no relays connected"
```

Edit `~/.config/git-nostr/git-nostr-cli.json`:

```json
{
    "relays": ["wss://relay.damus.io", "wss://nostr.fmt.wiz.biz", "wss://nos.lol"],
    "privateKey": "<your-nostr-private-key-hex>", // used for sen
    "gitSshBase": "git-nostr@gittr.space"  // user@host format (NOT just hostname!)
}
```

**Key difference:**
- **Frontend (`NEXT_PUBLIC_GIT_SSH_BASE`)**: Just hostname like `gittr.space` (used for display, configured in `ui/.env.local`, can be overridden per-repo in settings)
- **CLI (`gitSshBase`)**: Full `user@host` format like `git-nostr@gittr.space` (used for SSH connection, configured in `~/.config/git-nostr/git-nostr-cli.json`)

**For Docker containers** (as in original NostrGit example), use `root@localhost` because Docker runs as root. For production, use `git-nostr@gittr.space` (the dedicated user you created).

**See [SETUP_INSTRUCTIONS.md](SETUP_INSTRUCTIONS.md) for complete server admin setup guide including Docker, relay configuration, and connecting all parts together.**

### 2. Publish SSH Keys

Users need to publish their SSH public keys via gittr.space UI:
1. Go to **Settings → SSH Keys**
2. Generate or add SSH public key
3. Key will be published to Nostr (KIND_52)
4. Bridge will automatically pick it up and add to `authorized_keys`

## Verification

### 1. Check Bridge is Running

```bash
# Linux
sudo systemctl status git-nostr-bridge

# Check logs
sudo journalctl -u git-nostr-bridge -n 50

# Verify HTTP server is running
curl http://localhost:8080/api/event -X POST -H "Content-Type: application/json" -d '{}'
# Should return error (expected - needs valid event), but confirms server is running
```

**Expected log output:**
```
🌐 [Bridge] Starting HTTP server on port 8080 for direct event submission
✅ [Bridge API] Event accepted: kind=30617, id=...
```

### 2. Check Relay Connections

The bridge should show relay connection status in logs. You should see:
```
Connected to relay: wss://relay.damus.io
Connected to relay: wss://nos.lol
...
```

### 3. Test SSH Access

From a client machine (with SSH key added via gittr.space UI):

```bash
# Test SSH connection
ssh git-nostr@your-server.com

# Should connect and show git-nostr-ssh command prompt
```

### 4. Test Git Clone

```bash
# Clone a repository
git clone git@gittr.space:<pubkey>/<repo-name>.git

# Should successfully clone
```

## Troubleshooting

### Bridge won't start

1. Check Go is installed: `go version`
2. Check binaries exist: `ls -la ~/gittr/ui/gitnostr/bin/`
3. Rebuild if needed: `cd ~/gittr/ui/gitnostr && make git-nostr-bridge`
4. Check config file: `cat ~/.config/git-nostr/git-nostr-bridge.json`
5. Check logs: `sudo journalctl -u git-nostr-bridge -n 100`

### Can't connect to relays

1. Check relay URLs are correct (must start with `wss://`)
2. Check network/firewall allows outbound connections
3. Test relay manually: `curl -v <relay-url>`

### SSH connection fails

1. Check SSH server is running: `sudo systemctl status ssh`
2. Check git-nostr user exists: `id git-nostr`
3. Check SSH config: `cat /etc/ssh/sshd_config | grep -i git-nostr`
4. Check authorized_keys: `cat ~git-nostr/.ssh/authorized_keys`
5. Check SSH logs: `sudo tail -f /var/log/auth.log`

### Git operations fail

1. Check repository directory exists and has permissions:
   ```bash
   ls -la ~git-nostr/git-nostr-repositories/
   ```
2. Check bridge logs for repository creation errors
3. Verify repository was published to Nostr (check relays)

## Local Development Setup

For **local development**, you can run the bridge on localhost:

### 1. Use Local User (Development Only)

**⚠️ Warning**: Only for local development! Don't do this on a shared/production server!

```bash
# Create config in your home directory
mkdir -p ~/.config/git-nostr
nano ~/.config/git-nostr/git-nostr-bridge.json
```

**Local dev config:**
```json
{
    "repositoryDir": "~/git-nostr-repositories",
    "DbFile": "~/.config/git-nostr/git-nostr-db.sqlite",
    "relays": ["wss://relay.damus.io", "wss://nos.lol"],
    "gitRepoOwners": ["<your-pubkey>"]
}
```

### 2. Run Bridge Manually

```bash
cd ~/gittr/ui/gitnostr
./bin/git-nostr-bridge
```

### 3. Configure gittr.space UI for Localhost

In `ui/.env.local`:
```
NEXT_PUBLIC_DOMAIN=localhost
NEXT_PUBLIC_GIT_SSH_BASE=localhost
```

Or use SSH config for localhost:
```bash
# In ~/.ssh/config
Host localhost-git
    HostName localhost
    User git-nostr
    IdentityFile ~/.ssh/id_ed25519
```

Then use: `git clone git@localhost-git:<pubkey>/repo.git`

## Production Deployment Checklist

- [ ] Go 1.20+ installed
- [ ] `git-nostr` user created
- [ ] Bridge built and binaries in `~/gittr/ui/gitnostr/bin/`
- [ ] Config file created at `~/.config/git-nostr/git-nostr-bridge.json`
- [ ] Relays configured
- [ ] `gitRepoOwners` list populated with authorized pubkeys
- [ ] SSH server installed and configured
- [ ] Systemd/launchd service created
- [ ] Bridge service enabled and running
- [ ] Firewall allows SSH (port 22)
- [ ] Git SSH base working (defaults to `gittr.space`)
- [ ] Test SSH connection works
- [ ] Test `git clone` works
- [ ] Monitor logs for errors

## Additional Resources

- **[SETUP_INSTRUCTIONS.md](SETUP_INSTRUCTIONS.md)**: Complete server admin setup guide (Docker, relays, Blossom, step-by-step order)
- Original gitnostr README: `ui/gitnostr/README.md`
- Git Commands Test Plan: `GIT_COMMANDS_TEST_PLAN.md`
- SSH & Git Guide: `docs/SSH_GIT_GUIDE.md`
- **Grasp Relay Setup**: `docs/GRASP_RELAY_SETUP.md` - Set up your own relay instance (Grasp protocol) for repository discovery and distributed Git hosting

