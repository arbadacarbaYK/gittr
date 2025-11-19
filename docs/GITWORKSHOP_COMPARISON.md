# Comparison: ngit vs gitworkshop.dev

This document compares our ngit implementation with gitworkshop.dev's approach and documents what commands are available in each.

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
- **SSH-based Git operations** - Standard Git over SSH (like GitHub/GitLab)
- **Web UI** - Full-featured web interface for all operations
- **No CLI tool** - All operations via web UI or standard Git commands

**Git Commands:**
```bash
# Clone using SSH (standard Git)
git clone git@gitnostr.com:<owner-pubkey>/<repo-name>.git

# Example:
git clone git@gitnostr.com:9a83779e/Pixelbot.git

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

✅ **SSH-based Git operations** - Standard Git commands work  
✅ **Web UI for PRs** - Create, review, merge PRs via web interface  
✅ **Web UI for Issues** - Create issues, add bounties, assign  
✅ **Repository management** - Create, import, fork repos  
✅ **GRASP protocol support** - Client-side GRASP-01, GRASP-02 sync  
✅ **Nostr event subscriptions** - Subscribe to repos from Nostr relays  

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
- Uses **standard Git over SSH** (no special CLI needed)
- All Git commands work directly (no wrapper tool)
- PRs/issues managed via web UI (like GitHub)

### The Real Difference: Protocol, Not Commands

The difference isn't about which Git commands work - **they all work!** The difference is:

1. **gitworkshop.dev**: Uses `nostr://` protocol URLs → requires `git-remote-nostr` helper
2. **Our gittr**: Uses SSH protocol URLs → standard Git SSH (no helper needed)

Both approaches support the same Git commands. The difference is the **protocol layer** (how Git connects to the server).  

## Why Different Approaches?

### gitworkshop.dev
- **Protocol-first**: Uses `nostr://` URLs directly
- **CLI-focused**: Emphasizes command-line workflow
- **Distributed**: Each repo can be on different Grasp servers
- **Lightweight**: Minimal web UI, mostly CLI

### Our gittr
- **SSH-based**: Uses standard Git SSH (familiar to developers)
- **Web-first**: Full-featured web UI (like GitHub)
- **Centralized Git server**: One server handles all Git operations
- **Feature-rich**: Issues, PRs, bounties, payments, all in web UI

## Should We Add gitworkshop.dev Features?

### Option 1: Keep SSH-based approach (Current)
**Pros:**
- Familiar to developers (same as GitHub/GitLab)
- Standard Git commands work
- No additional tools needed
- Better for users who prefer web UI

**Cons:**
- Requires git-nostr-bridge server setup
- Not compatible with `nostr://` protocol
- Can't use `ngit` CLI tool

### Option 2: Add `nostr://` protocol support
**Pros:**
- Compatible with gitworkshop.dev
- Can use `ngit` CLI tool
- More distributed (repos can be on different servers)
- Protocol-first approach

**Cons:**
- Requires `git-remote-nostr` helper installation
- More complex setup for users
- Need to maintain both SSH and `nostr://` support

### Option 3: Hybrid approach
**Pros:**
- Best of both worlds
- Users can choose SSH or `nostr://`
- Compatible with gitworkshop.dev ecosystem

**Cons:**
- More code to maintain
- More complex documentation

## Why We're Not Seeing Repos: It's NOT the Architecture!

**Important**: The problem of not seeing repos from gitworkshop.dev is **NOT** because we use a centralized server vs distributed approach. The issue is likely:

1. **Relay subscriptions**: We might not be subscribed to the same relays that gitworkshop.dev uses
2. **GRASP-02 sync**: Our client-side relay discovery might not be working properly
3. **Event filtering**: Repos might be getting filtered out (deleted/archived checks)

**The architecture difference doesn't prevent repo discovery:**
- Both approaches read from Nostr relays
- Both can discover repos from any relay
- The difference is just how Git operations work (SSH vs `nostr://`)

**To fix repo discovery:**
1. Ensure we're subscribed to Grasp relay instances (`wss://gitnostr.com`, `wss://relay.ngit.dev`)
2. Verify GRASP-02 client-side sync is discovering relays from repo events
3. Check browser console for `📦 [Explore] Repo event received` logs
4. Verify repos aren't being filtered out incorrectly

## Documentation Status

✅ **We document SSH-based commands** in:
- `docs/SSH_GIT_GUIDE.md` - Complete SSH/Git guide
- `GIT_NOSTR_BRIDGE_SETUP.md` - Bridge setup (required for Git ops)
- `SETUP_INSTRUCTIONS.md` - Server admin setup

❌ **We don't document gitworkshop.dev commands** because:
- We don't support `nostr://` protocol
- We don't have `ngit` CLI tool
- Different architecture (SSH vs protocol)

## References

- **gitworkshop.dev Quick Start**: https://gitworkshop.dev/quick-start
- **ngit.dev**: https://ngit.dev
- **GRASP Protocol**: https://ngit.dev/grasp/
- **Our SSH Guide**: `docs/SSH_GIT_GUIDE.md`

