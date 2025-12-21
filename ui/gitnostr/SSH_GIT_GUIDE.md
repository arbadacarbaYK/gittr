# SSH & Git Access Guide for git-nostr-bridge

This guide explains how to access repositories hosted by `git-nostr-bridge` via SSH and Git command-line tools.

**Important**: This guide is for **users** connecting to a `git-nostr-bridge` server. You don't need to install the bridge locally - you just connect to it like you would connect to GitHub or GitLab. For server operators who want to run their own bridge, see [README.md](README.md) for setup instructions.

## Overview

`git-nostr-bridge` provides SSH-based Git access to repositories stored on Nostr. Users can clone, push, and pull repositories using standard Git commands over SSH, just like GitHub or GitLab.

## Quick Start

### 1. Set Up SSH Keys

SSH keys are managed entirely through Nostr events:

#### Option 1: Using git-nostr-cli (gn)

The easiest way to publish your SSH key:

```bash
# Build git-nostr-cli if you haven't already
cd gitnostr
make git-nostr-cli

# Publish your SSH public key to Nostr
./bin/gn ssh-key add ~/.ssh/id_ed25519.pub
# or
./bin/gn ssh-key add ~/.ssh/id_rsa.pub
```

This will:
1. Read your SSH public key file
2. Create a Nostr event (KIND_52) with your public key
3. Publish it to the configured relays
4. The bridge will pick it up and add it to `authorized_keys`

#### Option 2: Using gittr.space Web UI

If you're using `gittr.space`:
1. Go to **Settings → SSH Keys**
2. Either generate a new key or paste your existing public key
3. Your key will be published to Nostr and processed by the bridge automatically

**Important**: KIND_52 is used by the gitnostr protocol for SSH keys, but NIP-52 defines KIND_52 for Calendar Events. This is a known conflict. Some relays may reject KIND_52 events. If publishing fails, try a different relay (relay.damus.io, nos.lol typically work).

### 2. Clone a Repository

Once your SSH key is set up, you can clone repositories using SSH:

```bash
# Format: git clone git@<bridge-host>:<owner-pubkey>/<repo-name>.git
git clone git@git.gittr.space:npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/repo-name.git
```

**Note**: The bridge supports both `npub` format and hex pubkey format in clone URLs. Per NIP-34 specification, `npub` format is preferred.

## Workflows

### Workflow A: Push Existing Local Repository to Bridge

If you have a local git repository with files and want to push it to a bridge:

```bash
# 1. Set up SSH keys (if not already done)
# Use git-nostr-cli or gittr.space web UI to publish your SSH key

# 2. Create the repository on the bridge (via web UI or API)
# The repository must exist before you can push to it

# 3. Add bridge as a remote
cd /path/to/your/local/repo
git remote add bridge git@<bridge-host>:<your-npub>/<repo-name>.git

# 4. Push all your files, commits, and branches to bridge
git push bridge main

# 5. Push other branches if needed
git push bridge feature-branch

# 6. Publish Nostr events via web UI
# Go to gittr.space repository page and click "Push to Nostr"
# This publishes NIP-34 events so other clients can discover your repo
```

**Result**: All your local files, commits, and history are now on the bridge and published to Nostr.

### Workflow B: Push to Both Bridge + GitHub

If you want to maintain your code on both GitHub and a bridge simultaneously:

```bash
# 1. Set up remotes for both services
cd /path/to/your/local/repo

# Add GitHub remote (if not already added)
git remote add github git@github.com:<username>/<repo-name>.git

# Add bridge remote
git remote add bridge git@<bridge-host>:<your-npub>/<repo-name>.git

# 2. Push to both services
git push github main    # Push to GitHub
git push bridge main    # Push to bridge

# 3. (Optional) Publish Nostr events via web UI
# Go to gittr.space repository page and click "Push to Nostr"
```

**Pro Tip**: You can push to both in one command:
```bash
git push github main && git push bridge main
```

Or set up a custom remote that pushes to both:
```bash
# Add a remote that pushes to both
git remote set-url --add --push both github git@github.com:<username>/<repo-name>.git
git remote set-url --add --push both bridge git@<bridge-host>:<your-npub>/<repo-name>.git

# Now push to both at once
git push both main
```

### Workflow C: Create New Repository from Scratch

Complete workflow to create a new repository with files:

```bash
# 1. Set up SSH keys (if not already done)
# Use git-nostr-cli or gittr.space web UI to publish your SSH key

# 2. Create repository (via web UI or API)
# Option A: Use gittr.space web UI to create empty repo
# Option B: Use HTTP API (see link to CLI_PUSH_EXAMPLE.md below)

# 3. Clone the repo
git clone git@<bridge-host>:<your-npub>/<repo-name>.git
cd <repo-name>

# 4. Create your project files
cat > README.md << 'EOF'
# My Project

This is my awesome project on Nostr!

## Features
- Feature 1
- Feature 2

## Installation
\`\`\`bash
npm install
\`\`\`
EOF

cat > index.js << 'EOF'
#!/usr/bin/env node
console.log('Hello from Nostr!');
EOF

cat > package.json << 'EOF'
{
  "name": "my-project",
  "version": "1.0.0",
  "description": "My awesome project",
  "main": "index.js"
}
EOF

mkdir src
cat > src/utils.js << 'EOF'
export function greet(name) {
  return `Hello, ${name}!`;
}
EOF

# 5. Commit and push all files
git add .
git commit -m "Initial commit: Add project files

- Add README with project description
- Add main index.js entry point
- Add package.json with project metadata
- Add src/utils.js with utility functions"

git push origin main

# 6. Publish to Nostr via web UI
# Go to gittr.space repository page and click "Push to Nostr"
```

**Result**: Complete repository with all files, properly committed and published to Nostr.

### Workflow D: Making Changes to Existing Repositories

Complete workflow for updating an existing repository:

```bash
# 1. Clone the repository
git clone git@<bridge-host>:<owner-npub>/<repo-name>.git
cd <repo-name>

# 2. Make your changes
# Edit existing files
echo "# Updated Feature" >> README.md

# Add new files
cat > src/new-feature.js << 'EOF'
export function newFeature() {
  return 'New feature added!';
}
EOF

# Modify existing files
sed -i 's/version: "1.0.0"/version: "1.1.0"/' package.json

# 3. Stage, commit, and push all changes
git add .
git commit -m "Add new feature and update version

- Add new-feature.js with new functionality
- Update package.json version to 1.1.0
- Update README with new feature documentation"

git push origin main

# 4. Changes appear in web UI after pushing
# Refresh the repository page to see your updates
```

## Git Operations Over SSH

All standard Git commands work over SSH:

```bash
# Clone a repository
git clone git@<bridge-host>:npub1.../repo-name.git

# Push changes (requires WRITE permission)
cd repo-name
git add .
git commit -m "Update code"
git push origin main

# Pull latest changes
git pull origin main

# Create and push a new branch
git checkout -b feature-branch
git push origin feature-branch

# Fetch remote branches
git fetch origin

# Switch branches
git checkout <branch-name>

# View commit history
git log

# View changes
git diff
```

**All standard Git commands work as expected!**

## Repository Permissions

Access control is managed through Nostr events (KIND_REPOSITORY_PERMISSION = 50):

- **READ**: Clone and pull (default for all repositories)
- **WRITE**: Push to existing branches
- **ADMIN**: Full control including branch deletion

### Setting Permissions with git-nostr-cli

```bash
# Grant WRITE permission to a user
./bin/gn repo permission <repo-name> <user-pubkey> WRITE

# Grant ADMIN permission
./bin/gn repo permission <repo-name> <user-pubkey> ADMIN
```

## How git-nostr-ssh Works

When you SSH to the bridge:

1. **SSH Connection**: You connect using your SSH key (which was added to `authorized_keys` by the bridge)
2. **Command Execution**: The `authorized_keys` file is configured to run `git-nostr-ssh <your-pubkey>` instead of a shell
3. **Access Control**: `git-nostr-ssh` checks the database to verify you have permission for the requested operation
4. **Git Operation**: If authorized, the git operation (clone/push/pull) is executed

The `authorized_keys` entry looks like:
```
command="/path/to/git-nostr-ssh <pubkey>",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty <ssh-public-key>
```

This ensures:
- Only git operations are allowed (no shell access)
- Port forwarding and X11 forwarding are disabled
- The bridge knows which Nostr pubkey corresponds to your SSH key

## How SSH Keys Work with git-nostr-bridge

SSH keys are managed entirely through Nostr events:

1. **Key Publishing**: SSH public keys are published as Nostr events (KIND_SSH_KEY = 52) signed with your Nostr private key
2. **Bridge Processing**: The `git-nostr-bridge` service watches for SSH key events and updates `authorized_keys` automatically
3. **Access Control**: When you SSH to the bridge, `git-nostr-ssh` performs access control checks based on repository permissions stored in the bridge's database

**Important**: 
- Only public keys are published to Nostr (safe to share)
- Private keys NEVER leave your device
- The bridge processes SSH key events via direct API and relay subscription
- One SSH key pair works for all your repositories (GitHub model)

## Troubleshooting

### SSH Key Not Working

1. **Check if key was published**: Verify the SSH key event exists on Nostr relays
2. **Check bridge logs**: The bridge should log "ssh-key updated" when it processes your key
3. **Check authorized_keys**: Verify your key is in `~/.ssh/authorized_keys` on the bridge server
4. **Check permissions**: Ensure you have the correct repository permissions (READ/WRITE/ADMIN)

### Permission Denied Errors

- **Clone fails**: You need at least READ permission (default for all repos)
- **Push fails**: You need WRITE permission for the repository
- **Branch deletion fails**: You need ADMIN permission

### "Repository not found"

- Check that the repository exists on the bridge
- Verify the clone URL format is correct
- Ensure you have read permission for the repository
- If you just created the repository, wait a moment for the bridge to process it

### "Network is unreachable" (port 22)

**Most common cause**: Hetzner Cloud Firewall blocking port 22.

**Quick fixes:**
1. **Check Hetzner Cloud Firewall** (most important):
   - Log into Hetzner Cloud Console: https://console.hetzner.cloud/
   - Navigate to server → **Firewalls** tab
   - Verify firewall allows **Inbound TCP port 22**
   - If missing, add rule: Direction=Inbound, Protocol=TCP, Port=22, Source=0.0.0.0/0

2. **Check server local firewall:**
   ```bash
   # On the server
   sudo ufw status
   sudo ufw allow 22/tcp  # If ufw is active
   ```

3. **Verify SSH service is running:**
   ```bash
   # On the server
   sudo systemctl status sshd
   ```

4. **Verify SSH port 22 is accessible**: `ssh -v git-nostr@<bridge-host>`
5. **Ensure `git-nostr-bridge` service is running**: `sudo systemctl status git-nostr-bridge`

**For complete troubleshooting**, see the main gittr documentation: [SSH_PORT_22_TROUBLESHOOTING.md](https://github.com/arbadacarbaYK/gittr/blob/main/docs/SSH_PORT_22_TROUBLESHOOTING.md).

### "Push rejected"

- Only repository owners can push directly
- For collaborative changes, create a pull request via the web UI
- Check repository permissions

### Relay Compatibility Issues

Some relays may reject KIND_52 (SSH key events) due to NIP-52 conflict. If publishing fails:
1. Try a different relay (relay.damus.io, nos.lol typically work)
2. Check relay logs for rejection messages
3. Use a relay that explicitly supports gitnostr protocol

## Security Considerations

### ✅ What's Safe

- **Only public keys are published**: SSH public keys are designed to be shared publicly (same as GitHub, GitLab, etc.)
- **Private keys NEVER leave your device**: SSH private keys are only stored locally in `~/.ssh/`

### ⚠️ Important Security Notes

- **SSH Private Keys**: Never share your SSH private key. Only the public key is published to Nostr.
- **Bridge User**: The bridge should run as a dedicated user (e.g., `git-nostr`), not your personal user account, because it overwrites `authorized_keys`.
- **Repository Permissions**: Only grant WRITE/ADMIN permissions to trusted users.
- **Nostr Private Key**: Protect your Nostr private key - if compromised, an attacker could publish malicious SSH keys.

### 🔐 Best Practices

- **Generate strong keys**: Use Ed25519 (recommended) or RSA with 4096-bit keys
- **Protect your private key**: 
  - Never share your private key
  - Use correct permissions: `chmod 600 ~/.ssh/id_ed25519`
  - Consider using SSH agent for key management
- **Monitor your keys**: Regularly check that no unauthorized keys have been published
- **Use different keys**: Consider using different SSH keys for different services/devices

## See Also

- **[Main gittr.space SSH Git Guide](https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr?path=docs&file=docs%2FSSH_GIT_GUIDE.md)** - Complete user-facing guide for gittr.space with web UI workflows
- **[CLI Push Example](https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr?path=docs&file=docs%2FCLI_PUSH_EXAMPLE.md)** - HTTP API examples for pushing repositories programmatically
- [git-nostr-bridge README](README.md) - Setup and configuration instructions
- [git-nostr-cli Usage](README.md#git-nostr-cli-gn) - Command-line tool documentation
