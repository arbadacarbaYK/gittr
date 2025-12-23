# SSH & Git Access Guide

This guide explains how to use SSH to create, add, and modify files in gittr.space repositories.

**Important**: You don't need to install anything locally! The `git-nostr-bridge` service runs on gittr's servers. You just push to it like you would push to GitHub or GitLab.

## Quick Start: Set Up SSH Keys

1. Go to **Settings → SSH Keys** on gittr.space
2. Either:
   - **Generate new key**: Click "Generate SSH Key", download the private key, and save it to `~/.ssh/id_ed25519`
   - **Add existing key**: Paste your public key from `~/.ssh/id_*.pub`
3. Your SSH key will be published to Nostr (only public key, safe to share)

## Repository URL Formats

gittr.space supports multiple formats for the owner identifier in clone URLs:

```bash
# Using npub (recommended, per NIP-34 specification)
git clone git@git.gittr.space:npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/repo-name.git

# Using NIP-05 (human-readable)
git clone git@git.gittr.space:geek@primal.net/repo-name.git

# Using hex pubkey (64-char)
git clone git@git.gittr.space:daa41bedb68591363bf4407f687cb9789cc543ed024bb77c22d2c84d88f54153/repo-name.git
```

All three formats resolve to the same repository.

## Workflow 1: Create and Add Files via SSH

### 1.1 From a Local Source

Create a new repository and push your local files:

```bash
# 1. Create the repository on gittr.space (via web UI)
# Go to "Create repository" page, enter name, click "Create Empty Repository"

# 2. Clone the empty repository
git clone git@git.gittr.space:<your-identifier>/<repo-name>.git
cd <repo-name>

# 3. Copy your local files into the cloned repository
cp -r /path/to/your/local/files/* .

# 4. Commit and push
git add .
git commit -m "Initial commit: Add files from local source"
git push origin main

# 5. Publish to Nostr (via web UI)
# Go to the repository page and click "Push to Nostr"
```

### 1.2 From GitHub to Nostr Using Gittr

Import a GitHub repository to Nostr:

```bash
# 1. Clone from GitHub
git clone https://github.com/<username>/<repo-name>.git
cd <repo-name>

# 2. Create the repository on gittr.space (via web UI)
# Go to "Create repository" page, enter name, click "Create Empty Repository"

# 3. Add gittr as a remote
git remote add gittr git@git.gittr.space:<your-identifier>/<repo-name>.git

# 4. Push to gittr
git push gittr main

# 5. Publish to Nostr (via web UI)
# Go to the repository page and click "Push to Nostr"
```

### 1.3 From a Git Server

Import from any Git server (GitLab, self-hosted, etc.):

```bash
# 1. Clone from the Git server
git clone https://git.example.com/<username>/<repo-name>.git
cd <repo-name>

# 2. Create the repository on gittr.space (via web UI)
# Go to "Create repository" page, enter name, click "Create Empty Repository"

# 3. Add gittr as a remote
git remote add gittr git@git.gittr.space:<your-identifier>/<repo-name>.git

# 4. Push to gittr
git push gittr main

# 5. Publish to Nostr (via web UI)
# Go to the repository page and click "Push to Nostr"
```

### 1.4 From Codeberg

Import from Codeberg:

```bash
# 1. Clone from Codeberg
git clone https://codeberg.org/<username>/<repo-name>.git
cd <repo-name>

# 2. Create the repository on gittr.space (via web UI)
# Go to "Create repository" page, enter name, click "Create Empty Repository"

# 3. Add gittr as a remote
git remote add gittr git@git.gittr.space:<your-identifier>/<repo-name>.git

# 4. Push to gittr
git push gittr main

# 5. Publish to Nostr (via web UI)
# Go to the repository page and click "Push to Nostr"
```

## Workflow 2: Delete or Add Files in Existing Repos via SSH

### 2.1 From a Local Source

Update an existing repository with local changes:

```bash
# 1. Clone the existing repository
git clone git@git.gittr.space:<owner-identifier>/<repo-name>.git
cd <repo-name>

# 2. Make your changes
# Add new files
cp /path/to/local/file.txt .

# Delete files
rm unwanted-file.txt

# Modify existing files
echo "# Updated content" >> README.md

# 3. Commit and push
git add .
git commit -m "Update: add new files, remove old files, modify existing"
git push origin main

# 4. Changes appear in web UI after pushing
```

### 2.2 From GitHub to Nostr Using Gittr

Sync updates from GitHub to an existing Nostr repository:

```bash
# 1. Clone the existing Nostr repository
git clone git@git.gittr.space:<your-identifier>/<repo-name>.git
cd <repo-name>

# 2. Add GitHub as a remote
git remote add github https://github.com/<username>/<repo-name>.git

# 3. Fetch and merge from GitHub
git fetch github
git merge github/main --allow-unrelated-histories

# 4. Push to gittr
git push origin main

# 5. Publish updated state to Nostr (via web UI)
# Go to the repository page and click "Push to Nostr"
```

### 2.3 From a Git Server

Sync updates from any Git server to an existing Nostr repository:

```bash
# 1. Clone the existing Nostr repository
git clone git@git.gittr.space:<your-identifier>/<repo-name>.git
cd <repo-name>

# 2. Add the Git server as a remote
git remote add source https://git.example.com/<username>/<repo-name>.git

# 3. Fetch and merge
git fetch source
git merge source/main --allow-unrelated-histories

# 4. Push to gittr
git push origin main

# 5. Publish updated state to Nostr (via web UI)
# Go to the repository page and click "Push to Nostr"
```

### 2.4 From Codeberg

Sync updates from Codeberg to an existing Nostr repository:

```bash
# 1. Clone the existing Nostr repository
git clone git@git.gittr.space:<your-identifier>/<repo-name>.git
cd <repo-name>

# 2. Add Codeberg as a remote
git remote add codeberg https://codeberg.org/<username>/<repo-name>.git

# 3. Fetch and merge
git fetch codeberg
git merge codeberg/main --allow-unrelated-histories

# 4. Push to gittr
git push origin main

# 5. Publish updated state to Nostr (via web UI)
# Go to the repository page and click "Push to Nostr"
```

## Publishing to Nostr (NIP-34 Events)

When you push via `git push`, your code goes to the git-nostr-bridge server. To make your repository discoverable by other Nostr clients, you need to publish NIP-34 events:

1. Go to your repository page on gittr.space
2. Click **"Push to Nostr"**
3. Confirm the prompt in your NIP-07 wallet

This publishes:
- **Announcement event** (kind 30617) - Announces your repository
- **State event** (kind 30618) - Contains current repository state (branches, commits, etc.)

**Important**: 
- `git push` updates the repository on the bridge server
- "Push to Nostr" publishes NIP-34 events to Nostr relays
- Both are needed for full functionality: bridge for git operations, Nostr events for discovery

## Troubleshooting

### "Permission denied (publickey)"
- Ensure your SSH key is added in Settings → SSH Keys
- Check that your private key is in `~/.ssh/` with correct permissions (600)
- Verify the bridge service has processed your key (may take a few seconds)

### "Permission denied" (for write operations)
- Only repository owners and users with WRITE or ADMIN permissions can push
- Check repository permissions in Settings → Repository → Permissions

### "Repository not found"
- Check that the repository exists on gittr
- Verify the clone URL format is correct
- If you just created the repository, wait a moment for the bridge to process it

### "Network is unreachable" (port 22)
- Verify SSH port 22 is accessible: `ssh -v git-nostr@git.gittr.space`
- Check if your network/firewall blocks port 22
- Try HTTPS clone instead: `git clone https://git.gittr.space/<owner-identifier>/<repo-name>.git`

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
