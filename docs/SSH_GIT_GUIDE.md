# SSH & Git Access Guide

This guide explains how to access gittr.space repositories via SSH and Git command-line tools.

**Important**: You don't need to install anything locally! The `git-nostr-bridge` service runs on gittr's servers. You just push to it like you would push to GitHub or GitLab. 
This guide is for **users**, not server operators but if you like you can run a bridge yourself, too. For instructions, see [GIT_NOSTR_BRIDGE_SETUP.md](GIT_NOSTR_BRIDGE_SETUP.md).

## Quick Start

### 1. Set Up SSH Keys

1. Go to **Settings → SSH Keys** on gittr.space
2. Either:
   - **Generate new key**: Click "Generate SSH Key", download the private key, and save it to `~/.ssh/id_ed25519`
   - **Add existing key**: Paste your public key from `~/.ssh/id_*.pub`
3. Your SSH key will be published to Nostr (only public key, safe to share)

### 2. Clone a Repository

gittr.space repositories support multiple clone URL formats:

#### Option A: SSH (Standard Git - Recommended)
```bash
git clone git@gittr.space:<owner-npub>/<repo-name>.git
```

Example:
```bash
git clone git@gittr.space:npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/repo-name.git
```

**Note**: 
- SSH cloning requires SSH keys to be set up (see Step 1 above)
- Clone URLs use `npub` format (not hex pubkey) per NIP-34 specification

#### Option B: HTTPS (GRASP Git Servers)
```bash
git clone https://git.gittr.space/<owner-npub>/<repo-name>.git
```

HTTPS clones work exactly like GitHub/GitLab. No SSH keys needed for read-only access.

#### Option C: nostr:// Protocol (Ecosystem Standard)
```bash
git clone nostr://<author-name>@<relay-domain>/<repo-name>
```

**Note**: Requires `git-remote-nostr` helper tool. See details below.

**Which format to use?**
- **SSH**: Preferred for contributors with keys configured (push + pull)
- **HTTPS**: Good for quick read-only clones or CI systems without SSH keys
- **nostr://**: Use when following guides from other NIP-34 clients (requires `git-remote-nostr`)

## Workflows

### Workflow A: Web UI (For Beginners)

Use the web UI at gittr.space to create and manage repositories visually.

#### A1. Import from GitHub/GitLab/Codeberg

**Web UI Workflow:**
1. Go to **"Create repository"** page
2. Enter `owner/repo` (e.g., `arbadacarbaYK/gittr`) or full URL
3. Click **"Import & Create"**
4. Files are fetched and stored in your browser
5. Click **"Push to Nostr"** to publish to the network

**Result**: Repository is created with all files visible in web UI immediately.

#### A2. Create Empty Repository (Web UI)

**Web UI Workflow:**
1. Go to **"Create repository"** page
2. Enter a repository name
3. Click **"Create Empty Repository"**

**Then use CLI to add files:**
```bash
# Clone the empty repo
git clone git@gittr.space:<your-npub>/<repo-name>.git

# Add files
cd <repo-name>
echo "# My Project" > README.md
git add .
git commit -m "Initial commit"
git push origin main
```

**Result**: Files appear in web UI after pushing via CLI.

### Workflow B: CLI-Only (For Developers)

Use Git CLI commands exclusively - no web UI required.

#### B1. Create Repository from Local Git Repo

If you have a local git repository and want to push it to gittr:

```bash
# 1. Set up SSH keys (if not already done)
# Go to Settings → SSH Keys on gittr.space, add your public key

# 2. Create the repository on gittr (via web UI or API)
# Option A: Use web UI to create empty repo
# Option B: Use HTTP API (see CLI_PUSH_EXAMPLE.md)

# 3. Add gittr as a remote
cd /path/to/your/local/repo
git remote add gittr git@gittr.space:<your-npub>/<repo-name>.git

# 4. Push to gittr
git push gittr main

# 5. (Optional) Publish to Nostr via web UI
# Go to the repository page and click "Push to Nostr"
```

#### B2. Create Repository from Scratch (CLI-Only)

```bash
# 1. Set up SSH keys (if not already done)
# Go to Settings → SSH Keys on gittr.space, add your public key

# 2. Create empty repository via web UI
# (Currently requires web UI for initial creation)

# 3. Clone the empty repo
git clone git@gittr.space:<your-npub>/<repo-name>.git
cd <repo-name>

# 4. Add your files
echo "# My Project" > README.md
# ... add more files ...

# 5. Commit and push
git add .
git commit -m "Initial commit"
git push origin main

# 6. (Optional) Publish to Nostr via web UI
# Go to the repository page and click "Push to Nostr"
```

### Workflow C: Push to Both Nostr + GitHub

If you want to maintain your code on both GitHub and Nostr simultaneously:

```bash
# 1. Set up remotes for both services
cd /path/to/your/local/repo

# Add GitHub remote (if not already added)
git remote add github git@github.com:<username>/<repo-name>.git

# Add gittr remote
git remote add gittr git@gittr.space:<your-npub>/<repo-name>.git

# 2. Push to both services
git push github main    # Push to GitHub
git push gittr main     # Push to gittr/Nostr

# 3. (Optional) Publish Nostr events via web UI
# Go to gittr.space repository page and click "Push to Nostr"
# This publishes NIP-34 events so other clients can discover your repo
```

**Pro Tip**: You can push to both in one command:
```bash
git push github main && git push gittr main
```

Or set up a custom remote that pushes to both:
```bash
# Add a remote that pushes to both
git remote set-url --add --push both github git@github.com:<username>/<repo-name>.git
git remote set-url --add --push both gittr git@gittr.space:<your-npub>/<repo-name>.git

# Now push to both at once
git push both main
```

### Workflow D: Making Changes to Existing Repositories

For any existing repository (whether created via web UI or CLI):

```bash
# 1. Clone the repository
git clone git@gittr.space:<owner-npub>/<repo-name>.git
cd <repo-name>

# 2. Make your changes
# Edit files, add new files, delete files, etc.

# 3. Commit and push
git add .
git commit -m "Your commit message"
git push origin main

# 4. Changes appear in web UI after pushing
```

## Publishing to Nostr (NIP-34 Events)

When you push via `git push`, your code goes to the git-nostr-bridge server. To make your repository discoverable by other Nostr clients, you need to publish NIP-34 events:

### Option 1: Web UI (Easiest)
1. Go to your repository page on gittr.space
2. Click **"Push to Nostr"**
3. Confirm the prompt in your NIP-07 wallet

This publishes:
- **Announcement event** (kind 30617) - Announces your repository
- **State event** (kind 30618) - Contains current repository state (branches, commits, etc.)

### Option 2: HTTP API
See [CLI_PUSH_EXAMPLE.md](CLI_PUSH_EXAMPLE.md) for programmatic publishing via API.

**Important**: 
- `git push` updates the repository on the bridge server
- "Push to Nostr" publishes NIP-34 events to Nostr relays
- Both are needed for full functionality: bridge for git operations, Nostr events for discovery

## How It Works

### SSH Key Management

- **Storage**: SSH public keys are published as Nostr events (KIND_SSH_KEY = 52)
- **Security**: Only public keys are stored on Nostr (safe to share)
- **Processing**: The `git-nostr-bridge` service (running on gittr's servers) receives SSH key events and updates authorized keys automatically
- **User-level keys**: One SSH key pair works for all your repositories (GitHub model)

### Git Operations Over SSH

When you run `git clone` or `git push`:

1. SSH connects to the gittr server using your SSH key
2. The server authenticates you via your Nostr pubkey
3. Permission is checked (read/write/admin based on repository permissions)
4. Git operations execute on the server's repository storage

### Supported Operations

**All standard Git commands work!**

- ✅ `git clone` - Clone repositories
- ✅ `git push` - Push changes (owner/admin only)
- ✅ `git pull` - Pull latest changes
- ✅ `git fetch` - Fetch remote branches
- ✅ `git checkout` - Switch branches or create new branches
- ✅ `git branch` - List, create, or delete branches
- ✅ `git merge` - Merge branches
- ✅ `git status` - Check repository status
- ✅ `git log` - View commit history
- ✅ `git diff` - View changes
- ✅ All other standard Git commands work as expected!

**Note**: PRs are created via the web UI, but once you clone a repo, you can use ALL standard Git commands just like with GitHub or GitLab.

## How git-remote-nostr Works

`git-remote-nostr` is a Git helper tool that translates `nostr://` URLs into standard git operations:

1. **Installation**: `pip install git-remote-nostr` or install from source
2. **Usage**: `git clone nostr://alex@git.gittr.space/repo-name`
3. **How it works**:
   - Queries Nostr relays for NIP-34 repository events
   - Extracts clone URLs (SSH and HTTPS) from the event's `clone` tags
   - Uses standard git operations to clone from those URLs
4. **After cloning**: You have a normal git repository and can use ALL standard git commands

**SSH Keys with nostr:// URLs:**
- NIP-34 events include both SSH and HTTPS clone URLs
- `git-remote-nostr` prefers SSH URLs if available (for authenticated operations)
- Falls back to HTTPS if no SSH keys configured

## Troubleshooting

### "Permission denied (publickey)"
- Ensure your SSH key is added in Settings → SSH Keys
- Check that your private key is in `~/.ssh/` with correct permissions (600)
- Verify the bridge service has processed your key (may take a few seconds)

### "Permission denied" (for read/write operations)
- **Read operations**: The repository may not be publicly readable and you don't have read permission
- **Write operations**: The repository may not be publicly writable and you don't have write permission
- Only repository owners and users with WRITE or ADMIN permissions can push

### "Repository not found"
- Check that the repository exists on gittr
- Verify the clone URL format is correct
- Ensure you have read permission for the repository
- If you just created the repository, wait a moment for the bridge to process it

### "Network is unreachable" (port 22)
- Verify SSH port 22 is accessible: `ssh -v git-nostr@gittr.space`
- Check if your network/firewall blocks port 22
- Try HTTPS clone instead: `git clone https://git.gittr.space/<owner-npub>/<repo-name>.git`

### "Push rejected"
- Only repository owners can push directly
- For collaborative changes, create a pull request via the web UI
- Check repository permissions in Settings → Repository → Permissions

## Security Notes

### ✅ What's Safe

- **Only public keys are published**: SSH public keys are designed to be shared publicly (same as GitHub, GitLab, etc.)
- **Private keys NEVER leave your device**: SSH private keys are only stored locally in `~/.ssh/`

### ⚠️ Important: localStorage Security

**Critical**: Data stored in browser localStorage is **NOT encrypted**.

**What's stored in localStorage**:
- ✅ **SSH Public Keys**: Safe - public keys are meant to be public
- ✅ **Repositories, settings, UI preferences**: Low risk
- ⚠️ **Nostr Private Keys (nsec)**: **STORED AS PLAINTEXT** - Accessible via browser dev tools (if using nsec login instead of NIP-07)

**What's NOT stored in localStorage**:
- ❌ **SSH Private Keys**: **NEVER stored** - Only downloaded once and saved to `~/.ssh/` on your local machine

**Best Practices**:
- ✅ **Use NIP-07 Extension** (recommended): Nostr private keys stay in the extension, never in localStorage
- ✅ **SSH Private Keys**: Never stored in browser - only in `~/.ssh/` on your local machine
- ⚠️ **Nostr Private Keys**: If you must use nsec login, use a dedicated browser profile

### ⚠️ Relay Compatibility Note

**Important**: KIND_52 is used by the gitnostr protocol for SSH keys, but NIP-52 defines KIND_52 for Calendar Events. This is a known conflict.

**Relay Compatibility**:
- Most relays accept any kind number, so KIND_52 should work on most relays
- Some relays may reject or filter KIND_52 if they specifically implement NIP-52
- If you experience issues, try using a different relay (relay.damus.io, nos.lol, relay.azzamo.net typically work)

## Infrastructure

gittr uses the following services (all server-side, you don't need to install anything):

- **`git-nostr-ssh`**: SSH server that handles git operations (runs on gittr's servers)
- **`git-nostr-bridge`**: Service that watches Nostr for SSH key events and updates authorized keys (runs on gittr's servers)
- **Nostr relays**: Store SSH key events (KIND_SSH_KEY = 52) and repository events

You just push to these services like you would push to GitHub - no local installation required!

## See Also

- [CLI_PUSH_EXAMPLE.md](CLI_PUSH_EXAMPLE.md) - Push repositories to the bridge via HTTP API (alternative to SSH)
- [GIT_NOSTR_BRIDGE_SETUP.md](GIT_NOSTR_BRIDGE_SETUP.md) - Bridge setup documentation (for server operators)
