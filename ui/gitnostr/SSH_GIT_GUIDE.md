# SSH & Git Access Guide for git-nostr-bridge

This guide explains how to access repositories hosted by `git-nostr-bridge` via SSH and Git command-line tools.

## Overview

`git-nostr-bridge` provides SSH-based Git access to repositories stored on Nostr. Users can clone, push, and pull repositories using standard Git commands over SSH, just like GitHub or GitLab.

## How SSH Keys Work with git-nostr-bridge

SSH keys are managed entirely through Nostr events:

1. **Key Publishing**: SSH public keys are published as Nostr events (KIND_SSH_KEY = 52) signed with your Nostr private key
2. **Bridge Processing**: The `git-nostr-bridge` service watches for SSH key events and updates `authorized_keys` automatically
3. **Access Control**: When you SSH to the bridge, `git-nostr-ssh` performs access control checks based on repository permissions stored in the bridge's database

**Important**: KIND_52 is used by the gitnostr protocol for SSH keys, but NIP-52 defines KIND_52 for Calendar Events. This is a known conflict. Some relays may reject KIND_52 events.

## Setting Up SSH Keys

### Option 1: Using git-nostr-cli (gn)

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

### Option 2: Using gittr.space Web UI

If you're using `gittr.space`:
1. Go to **Settings → SSH Keys**
2. Either generate a new key or paste your existing public key
3. Your key will be published to Nostr and processed by the bridge automatically

## Cloning Repositories

Once your SSH key is set up, you can clone repositories using SSH:

```bash
# Format: git clone git@<bridge-host>:<owner-pubkey>/<repo-name>.git
git clone git@gittr.space:npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/repo-name.git
```

**Note**: The bridge supports both `npub` format and hex pubkey format in clone URLs.

## Git Operations Over SSH

All standard Git commands work over SSH:

```bash
# Clone a repository
git clone git@gittr.space:npub1.../repo-name.git

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
```

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

### Relay Compatibility Issues

Some relays may reject KIND_52 (SSH key events) due to NIP-52 conflict. If publishing fails:
1. Try a different relay (relay.damus.io, nos.lol typically work)
2. Check relay logs for rejection messages
3. Use a relay that explicitly supports gitnostr protocol

## Security Considerations

- **SSH Private Keys**: Never share your SSH private key. Only the public key is published to Nostr.
- **Bridge User**: The bridge should run as a dedicated user (e.g., `git-nostr`), not your personal user account, because it overwrites `authorized_keys`.
- **Repository Permissions**: Only grant WRITE/ADMIN permissions to trusted users.
- **Nostr Private Key**: Protect your Nostr private key - if compromised, an attacker could publish malicious SSH keys.

## See Also

- [Main gittr.space SSH Git Guide](../../docs/SSH_GIT_GUIDE.md) - User-facing guide for gittr.space
- [git-nostr-bridge README](README.md) - Setup and configuration instructions
- [git-nostr-cli Usage](README.md#git-nostr-cli-gn) - Command-line tool documentation

