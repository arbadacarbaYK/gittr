# Terminal Git Commands Setup Guide

## Quick Answer

**You DON'T need a git subdomain.** You can use the same domain (`gittr.space`) for both web and SSH.

## Functions behind the "<>code" Button above repos 

The "<>code" e.g. button provides:
1. **Copy clone URL** - For imported repos, copies the source URL (GitHub/GitLab)
2. **Copy clone SSH URL** - Constructs `git@gittr.space:npub1.../repo.git` (uses `NEXT_PUBLIC_GIT_SSH_BASE`)
3. **SSH/Git Help** - Shows instructions for terminal Git usage

**For these to work, you need:**
- ✅ `NEXT_PUBLIC_GIT_SSH_BASE` configured (can be same as `NEXT_PUBLIC_DOMAIN`)
- ✅ `git-nostr-bridge` service running
- ✅ SSH accessible on the hostname (port 22)
- ✅ Users have published SSH keys via Settings → SSH Keys

## Do You Need a Git Subdomain?

**NO - You can use the same domain!**

### Option 1: Same Domain (Recommended for Simplicity)

```
Web:  https://gittr.space (port 443)
SSH:  gittr.space (port 22)
```

**Configuration:**
```bash
# In ui/.env.local
NEXT_PUBLIC_DOMAIN=gittr.space
NEXT_PUBLIC_GIT_SSH_BASE=gittr.space  # Same domain!
```

**How it works:**
- Web server (nginx) handles HTTPS on port 443
- SSH server (git-nostr-bridge) handles SSH on port 22
- Different ports = no conflict

### Option 2: Git Subdomain (Optional, for Organization)

```
Web:  https://gittr.space (port 443)
SSH:  git.gittr.space (port 22)
```

**Configuration:**
```bash
# In ui/.env.local
NEXT_PUBLIC_DOMAIN=gittr.space
NEXT_PUBLIC_GIT_SSH_BASE=git.gittr.space  # Subdomain
```

**Requires:**
- DNS A record: `git.gittr.space` → your server IP
- SSH server accessible on `git.gittr.space:22`

## What's Required for Terminal Git to Work?

### 1. git-nostr-bridge Service Running

The bridge must be:
- ✅ Installed and running (see `GIT_NOSTR_BRIDGE_SETUP.md`)
- ✅ Configured with same relays as frontend
- ✅ Listening on SSH port 22 (or configured port)

### 2. SSH Port Accessible

Users need to be able to connect via SSH:
```bash
ssh git-nostr@gittr.space  # Should connect (not login, just connect)
```

**Firewall:** Ensure port 22 is open:
```bash
# Check if SSH is accessible
sudo ufw allow 22/tcp
# Or for specific firewall
sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT
```

### 3. Users Must Publish SSH Keys

Users publish SSH keys via:
- **Settings → SSH Keys** in the web UI
- Keys are published to Nostr (KIND_52)
- Bridge automatically adds them to `authorized_keys`

### 4. Bridge Must See Repository Events

The bridge watches Nostr for:
- Repository events (KIND_REPOSITORY)
- SSH key events (KIND_SSH_KEY)
- Permission events

**Ensure:** Bridge config has same relays as frontend!

## Testing Terminal Git

### 1. Test SSH Connection

```bash
# Should connect (may show error about command, that's OK)
ssh git-nostr@gittr.space
```

### 2. Test Git Clone

```bash
# Clone a repository
git clone git@gittr.space:npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/repo-name.git
```

### 3. Test Git Push

```bash
cd repo-name
echo "test" > test.txt
git add test.txt
git commit -m "Test commit"
git push origin main
```

## Troubleshooting

### "Permission denied (publickey)"

**Cause:** User hasn't published SSH key via UI, or bridge hasn't picked it up yet.

**Fix:**
1. Go to Settings → SSH Keys
2. Generate or add SSH key
3. Wait a few seconds for bridge to sync
4. Try again

### "Connection refused" or "Connection timed out"

**Cause:** SSH port 22 not accessible or bridge not running.

**Fix:**
1. Check bridge is running: `sudo systemctl status git-nostr-bridge`
2. Check SSH port is open: `sudo ufw status` or `sudo iptables -L`
3. Test SSH connection: `ssh -v git-nostr@gittr.space`

### "Repository not found"

**Cause:** Bridge hasn't seen the repository event yet, or wrong pubkey in URL.

**Fix:**
1. Ensure repo was pushed to Nostr (check repo status)
2. Verify bridge is connected to same relays
3. Check URL uses correct npub/pubkey

## Summary

**For the "<>code" button to work:**
- ✅ Set `NEXT_PUBLIC_GIT_SSH_BASE=gittr.space` (can be same as domain)
- ✅ Bridge must be running
- ✅ SSH port 22 accessible

**You DON'T need a subdomain** - same domain works fine!

**Terminal Git commands work when:**
- ✅ Bridge is running
- ✅ SSH is accessible
- ✅ Users have published SSH keys
- ✅ Bridge sees repository events

