# Local Development Setup

Complete guide for running gittr.space on localhost for development.

## Prerequisites

```bash
# Check Node.js
node --version  # Should be 18 or higher
npm --version

# Check Git
git --version
```

If missing:
```bash
# Node.js (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Git
sudo apt-get update && sudo apt-get install -y git
```

## Setup Steps

### Step 1: Clone Repository

```bash
git clone https://github.com/arbadacarbaYK/gittr.git  
cd gittr
```

### Step 2: Install Dependencies

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

All configuration is in `.env.local` - domain, relays, Blossom URL, GitHub Platform Token (optional), etc. are already set with working defaults.

### Step 4: Start Frontend

```bash
cd ui
yarn dev
# Or: npm run dev (works but yarn is preferred)
```

Frontend runs on `http://localhost:3000`

### Step 5: Set Up git-nostr-bridge (Optional, for Git operations)

**Install Go:**

**Option 1: System-wide installation (requires sudo):**
```bash
# Check latest Go version at https://go.dev/dl/
wget https://go.dev/dl/go1.23.4.linux-amd64.tar.gz
sudo tar -C /usr/local -xzf go1.23.4.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
export PATH=$PATH:/usr/local/go/bin  # For immediate use in current session
go version
```

**Use this option if:** You have sudo access and want Go installed system-wide (available to all users).

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

**Use this option if:** You don't have sudo access, or prefer to install Go in your home directory.

**Important clarification:** "Your user" means the **Linux system user account** you're logged in as (e.g., `homie`, `www-data`). This is **NOT** the Nostr nsec/pubkey from your `.env.local` file. The Nostr keys are for platform authentication, while the system user is your Linux account.

**For Docker installations:** If you're using Docker, Go is already included in the Docker image, so you don't need to install it separately. See Docker setup in [SETUP_INSTRUCTIONS.md](https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr?path=docs&file=docs%2FSETUP_INSTRUCTIONS.md).

**Important:** After installing Go, you must either:
- Run `export PATH=$PATH:/usr/local/go/bin` (Option 1) or `export PATH=$HOME/go-local/go/bin:$PATH` (Option 2) in your current terminal session, OR
- Open a new terminal session (which will source `~/.bashrc` automatically)

**Create bridge config:**
```bash
mkdir -p ~/.config/git-nostr
nano ~/.config/git-nostr/git-nostr-bridge.json
```

```json
{
    "repositoryDir": "/home/YOUR_USERNAME/git-nostr-repositories",
    "DbFile": "/home/YOUR_USERNAME/.config/git-nostr/git-nostr-db.sqlite",
    "relays": ["wss://relay.damus.io", "wss://nos.lol"],
    "gitRepoOwners": []
}
```

**Important:** Replace `YOUR_USERNAME` with your actual Linux username (run `whoami` to check). Use absolute paths, not `~`, as JSON doesn't expand tildes.

**Build and run bridge:**
```bash
cd ui/gitnostr
# Make sure Go is in PATH (see above)
make git-nostr-bridge
./bin/git-nostr-bridge
```

**To run in background with logs:**
```bash
cd ui/gitnostr
nohup ./bin/git-nostr-bridge > /tmp/git-nostr-bridge.log 2>&1 &
tail -f /tmp/git-nostr-bridge.log  # Watch logs
```

**What to expect in the logs:**
- `relay connected: wss://...` - Successful relay connections
- `relay connect failed: ...` - Some relays may fail (this is normal for Nostr)
- `connected to X/Y relays: [...]` - Summary of connected relays
- `⚠️ [Bridge] Since timestamp for kind X is very old, resetting to 1 hour ago` - Bridge automatically resets old filters (normal)
- `📥 [Bridge] Received event: ...` - Bridge is receiving events
- `✅ [Bridge] Successfully processed repository event: ...` - Repos are being processed

**Configure for localhost:**
In `ui/.env.local`:
```
NEXT_PUBLIC_DOMAIN=localhost
NEXT_PUBLIC_GIT_SSH_BASE=localhost
```

### Step 6: Set Up Telegram (Optional, for notifications)

**Note:** No special dependencies are required for Telegram notifications. The platform uses the Telegram Bot API via HTTP requests (built into Node.js), so no additional npm packages are needed beyond what's already installed in Step 2.

**Configure environment:**
In `ui/.env.local`:
```
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_channel_id
```

**Get channel ID:**
```bash
cd ui
node get-channel-id.js
```

**Start ngrok (in separate terminal):**
```bash
ngrok http 3000
```

**Configure webhook:**
```bash
cd ui
node configure-webhook.js <ngrok-url>
```

Replace `<ngrok-url>` with your ngrok URL (without `https://`).

**Verify:**
```bash
curl http://localhost:3000/api/telegram/webhook-status
```

## Testing

- Frontend: `http://localhost:3000`
- Git clone: `git clone git@localhost:<pubkey>/repo.git`
- Telegram webhook: Check status endpoint

