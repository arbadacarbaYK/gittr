# Comparison: gittr vs gitworkshop.dev

This document compares our gittr implementation with gitworkshop.dev's approach and documents what commands are available in each.

**Note**: 
- **gittr** = Our platform (gittr.space)
- **ngit** = The original CLI tool and ecosystem (ngit.dev, used by gitworkshop.dev)
- **gitworkshop.dev** = The reference web interface for the ngit ecosystem

## Key Differences

### gitworkshop.dev Approach

**Tools:**
- **`ngit` CLI tool** - Command-line interface for Nostr Git operations
  - Installation: `curl -Ls https://ngit.dev/install.sh | bash`
  - Commands: `ngit send`, `ngit list`, etc.
- **`git-remote-nostr`** - Git remote helper for `nostr://` protocol
- **`nostr://` protocol URLs** - Direct Nostr protocol URLs for Git operations

**Git Commands:**
```bash
# Clone using nostr:// protocol
git clone nostr://npub123/repo-identifier

# Submit PR
git checkout -b pr/feature-name
git commit -am "commit message"
git push -u
# OR using ngit CLI:
ngit send

# View PRs
git branch -r --list origin/pr/*
# OR using ngit CLI:
ngit list

# Update PR
git commit -am "additional changes"
git push
# For amending:
git commit --amend
git push --force
```

### Our gittr Approach

**Tools:**
- **Multi-protocol Git operations** - SSH, HTTPS, and `nostr://` support
- **Web UI** - Full-featured web interface for all operations
- **Bridge push automation** - "Push to Nostr" button automatically syncs to multiple GRASP servers
- **No CLI tool** - All operations via web UI or standard Git commands

**Git Commands:**
```bash
# Clone using SSH (standard Git - Recommended)
git clone git@gittr.space:<owner-pubkey>/<repo-name>.git

# Example:
git clone git@gittr.space:9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c/repo-name.git

# Clone using HTTPS (from GRASP servers)
git clone https://git.gittr.space/<owner-pubkey>/<repo-name>.git
# Or from other GRASP servers:
git clone https://relay.ngit.dev/<owner-pubkey>/<repo-name>.git
git clone https://gitnostr.com/<owner-pubkey>/<repo-name>.git

# Clone using nostr:// protocol (for ecosystem compatibility)
git clone nostr://<author-name>@<relay-domain>/<repo-name>
# Requires git-remote-nostr helper

# Push changes (standard Git)
git add .
git commit -m "Update code"
git push origin main

# Pull changes
git pull origin main

# Fetch branches
git fetch origin
```

## What We Have

✅ **Multi-protocol Git operations** - SSH, HTTPS, and `nostr://` clone URLs supported  
✅ **Web UI for PRs** - Create, review, merge PRs via web interface  
✅ **Web UI for Issues** - Create issues, add bounties, assign  
✅ **Repository management** - Create, import, fork repos  
✅ **GRASP protocol support** - Client-side GRASP-01 sync, publishes to multiple GRASP servers  
✅ **Nostr event subscriptions** - Subscribe to repos from Nostr relays  
✅ **Automatic bridge sync** - Push to Nostr automatically syncs to all known GRASP servers  
✅ **Distributed hosting** - Repos pushed to multiple GRASP servers (not just one centralized server)  

## Important Clarification: Git Commands vs CLI Tools

**You're right that CLI tools typically just call the same APIs as the frontend!** However, there's an important distinction:

### Standard Git Commands (We Support ALL of These!)

**ALL standard Git commands work with our SSH-based approach:**
- `git clone`, `git push`, `git pull`, `git fetch`
- `git checkout`, `git branch`, `git merge`
- `git add`, `git commit`, `git status`, `git log`, `git diff`
- **Everything that works with GitHub/GitLab works with us!**

These are **standard Git commands** that work with ANY Git repository, regardless of how you access it (SSH, HTTPS, or `nostr://`).

### CLI Tools vs Git Commands

**gitworkshop.dev's `ngit` CLI tool** is NOT just a wrapper around web APIs:
- It's a **protocol-level tool** that works with `nostr://` URLs
- It translates `nostr://` URLs into Git operations
- It's similar to how `git-remote-https` works for HTTPS URLs

**Our approach:**
- Uses **standard Git over SSH/HTTPS** (no special CLI needed)
- Also publishes `nostr://` URLs for ecosystem compatibility
- All Git commands work directly (no wrapper tool)
- PRs/issues managed via web UI (like GitHub)
- Automatically pushes to multiple GRASP servers when you "Push to Nostr"

### The Real Difference: Protocol Priority, Not Commands

The difference isn't about which Git commands work - **they all work!** The difference is:

1. **gitworkshop.dev**: Primarily uses `nostr://` protocol URLs → requires `git-remote-nostr` helper
2. **Our gittr**: Primarily uses SSH/HTTPS URLs → standard Git (no helper needed), but also publishes `nostr://` URLs for compatibility

Both approaches support the same Git commands. The difference is the **primary protocol** (SSH/HTTPS vs `nostr://`), but we support both for maximum compatibility.  

## Why Different Approaches?

### gitworkshop.dev
- **Protocol-first**: Uses `nostr://` URLs directly
- **CLI-focused**: Emphasizes command-line workflow
- **Distributed**: Each repo can be on different Grasp servers
- **Lightweight**: Minimal web UI, mostly CLI

### Our gittr
- **Multi-protocol**: Primarily SSH/HTTPS, but also publishes `nostr://` URLs
- **Web-first**: Full-featured web UI (like GitHub)
- **Distributed Git hosting**: Pushes to multiple GRASP servers automatically
- **Feature-rich**: Issues, PRs, bounties, payments, all in web UI
- **Automatic sync**: "Push to Nostr" button syncs to all known GRASP servers

## Implementation Details

### gittr Implementation
- **Primary clone protocol**: SSH (`git@gittr.space`)
- **HTTPS support**: Available via `git.gittr.space` subdomain and other GRASP servers
- **nostr:// URLs**: Published in NIP-34 events for ecosystem compatibility
- **Bridge push**: Automatic sync to multiple GRASP servers on "Push to Nostr"
- **Git server**: Runs own bridge at `git.gittr.space` with proper subdomain setup
- **GRASP protocol**: Client-side GRASP-01 sync, publishes to all known GRASP servers

### gitworkshop.dev Implementation
- **Primary clone protocol**: `nostr://` (requires `git-remote-nostr` helper)
- **CLI tool**: `ngit` for Git operations
- **Protocol-first**: Uses `nostr://` URLs directly
- **Distributed**: Repos can be on different GRASP servers
- **CLI-focused**: Minimal web UI, emphasizes command-line workflow

## Documentation

✅ **gittr documentation**:
- [SSH_GIT_GUIDE.md](SSH_GIT_GUIDE.md) - Complete SSH/Git guide
- [GIT_NOSTR_BRIDGE_SETUP.md](GIT_NOSTR_BRIDGE_SETUP.md) - Bridge setup
- [SETUP_INSTRUCTIONS.md](SETUP_INSTRUCTIONS.md) - Server admin setup

✅ **gitworkshop.dev documentation**:
- Quick Start: https://gitworkshop.dev/quick-start
- ngit.dev: https://ngit.dev
- GRASP Protocol: https://ngit.dev/grasp/

## References

- **gitworkshop.dev Quick Start**: https://gitworkshop.dev/quick-start
- **ngit.dev**: https://ngit.dev
- **GRASP Protocol**: https://ngit.dev/grasp/
- **Our SSH Guide**: `docs/SSH_GIT_GUIDE.md`

