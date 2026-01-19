# GitHub Private Repo Access Guide

## ⚠️ SECURITY WARNING

**DO NOT use a platform token with `repo` scope!** This would allow the server to access ANY user's private repos, which is a massive security/privacy violation.

**Correct approach:**
- Platform token should ONLY have `public_repo` scope (for public repos and rate limits)
- Private repos should be accessed via the **bridge** (files are pushed during import)
- If bridge is empty, the issue is with the push process, not GitHub access

## Understanding the Flow

### 1. Import Process (When You Import from GitHub)

When you import a private repo from GitHub:

1. **Frontend calls `/api/import`** → This uses `GITHUB_PLATFORM_TOKEN` (if set) to fetch files from GitHub
2. **Files are stored in `localStorage`** → Your browser stores all the files
3. **Repository event is published to Nostr** → Kind 30617 event with repo metadata
4. **Files are pushed to the bridge** → Via `/api/nostr/repo/push` which sends files directly to the bridge API
5. **Bridge stores files locally** → Files are written to disk at `/opt/ngit/repos/{pubkey}/{repo}.git`

**Why import worked**: The `/api/import` endpoint uses `GITHUB_PLATFORM_TOKEN` to access your private repo.

### 2. File Fetching Process (When Viewing a Repo)

When you view a repo page:

1. **First tries the bridge** → `/api/nostr/repo/files?ownerPubkey=...&repo=...`
   - If bridge has files → ✅ Success!
   - If bridge is empty → Continue to step 2

2. **Multi-source fallback** → Tries all clone URLs in parallel:
   - GRASP servers (git.gittr.space, relay.ngit.dev, etc.)
   - **GitHub** → Uses `/api/github/proxy` which needs `GITHUB_PLATFORM_TOKEN`
   - GitLab, Codeberg, etc.

**Why it's failing now**: The `/api/github/proxy` endpoint needs `GITHUB_PLATFORM_TOKEN` to access private repos, but it's not set on the server.

## External Identities vs Server Tokens

### External Identities (NIP-39)
- **What**: User authentication/verification
- **Where**: Your Nostr profile (Kind 0 event with `i` tags)
- **Purpose**: Proves "I own this GitHub account" to other Nostr users
- **Does NOT**: Grant server-side API access to private repos

### Server Token (GITHUB_PLATFORM_TOKEN)
- **What**: Personal Access Token (PAT) for server-side API calls
- **Where**: Server environment variable
- **Purpose**: Allows the **server** to make GitHub API calls on behalf of all users
- **Required for**: Accessing private repos via the API

**Key Difference**: External identities are for **user verification**, not for **server API access**. The server needs its own token with `repo` scope to access private repos.

## Where to Set GITHUB_PLATFORM_TOKEN (Public Repos Only)

### ⚠️ IMPORTANT: Token Scope

**ONLY use `public_repo` scope!** Do NOT use `repo` scope as it would allow access to any user's private repos.

### On Hetzner Server

The token is optional and only needed for:
- Higher rate limits (5000/hour vs 60/hour)
- Public repo access

You have two options:

#### Option 1: Systemd Service File (Recommended)

Edit the systemd service file:

```bash
sudo nano /etc/systemd/system/gittr-frontend.service
```

Add the `Environment` line:

```ini
[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/ngit/ui
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=GITHUB_PLATFORM_TOKEN=ghp_your_token_here
StandardOutput=journal
StandardError=journal
```

Then reload and restart:

```bash
sudo systemctl daemon-reload
sudo systemctl restart gittr-frontend
```

#### Option 2: .env.local File

Create/edit `/opt/ngit/ui/.env.local`:

```bash
sudo nano /opt/ngit/ui/.env.local
```

Add:

```bash
GITHUB_PLATFORM_TOKEN=ghp_your_token_here
```

Then restart the service:

```bash
sudo systemctl restart gittr-frontend
```

**Note**: Next.js reads `.env.local` automatically, but systemd environment variables take precedence.

## How to Create the Token (Public Repos Only)

1. Go to https://github.com/settings/tokens
2. Click **"Generate new token"** → **"Generate new token (classic)"**
3. Give it a name: `gittr-platform-token`
4. Select scopes:
   - ✅ `public_repo` (to read public repositories)
   - ❌ **DO NOT select `repo`** (this would allow access to private repos - security issue!)
5. Click **"Generate token"**
6. **Copy the token immediately** (you'll only see it once!)

## Why Bridge Might Be Empty

Even after pushing to Nostr, the bridge might be empty if:

1. **Bridge didn't receive the event** → Check bridge logs: `sudo journalctl -u git-nostr-bridge -f`
2. **Bridge received event but clone failed** → Check if clone URLs are valid
3. **Files weren't pushed to bridge** → The push process sends files directly to bridge API, but if that fails, files might only be in Nostr events

### Check Bridge Status

```bash
# Check if bridge has the repo
curl http://localhost:8080/api/nostr/repo/files?ownerPubkey=YOUR_PUBKEY&repo=mylnbitch

# Check bridge logs
sudo journalctl -u git-nostr-bridge -n 50
```

## Current Issue Summary

1. ✅ **Import worked** → Used `GITHUB_PLATFORM_TOKEN` (if set) to fetch files during import
2. ✅ **Files pushed to Nostr** → Repository event published
3. ❌ **Bridge is empty** → **This is the real issue!** Files should be in the bridge after push
4. ❌ **GitHub fallback fails** → Correctly fails for private repos (security feature)

## Solution

**The real fix is to ensure files are in the bridge after push:**

1. **Check bridge logs**: `sudo journalctl -u git-nostr-bridge -f`
2. **Verify push completed**: Check browser console during push - should see "Bridge received event"
3. **Re-push if needed**: If bridge is empty, re-push the repo to Nostr
4. **GitHub fallback is NOT the solution** for private repos - it's a security risk!

**For public repos only:**
- Optional: Set `GITHUB_PLATFORM_TOKEN` with `public_repo` scope (for rate limits)
- This will help with public repo fallbacks, but private repos should use the bridge

## Testing

**For private repos:**
1. Files should load from the bridge (primary source)
2. If bridge is empty, check why push failed
3. GitHub fallback will correctly fail for private repos (security feature)

**For public repos:**
1. After setting token (optional), test by opening a public repo
2. Check browser console - should see:
   - `✅ [Git Source] Got default branch from repo: main`
   - `✅ [Git Source] Fetched X files from github.com`
3. Files should load from GitHub if bridge is empty

## Troubleshooting

**Private repo returns 404 from GitHub?**
- ✅ **This is correct behavior!** Private repos should NOT be accessible via platform token
- Files should be in the bridge after push
- If bridge is empty, that's the real issue to fix

**Bridge still empty?**
- Check if files were pushed: Look for "Bridge received event" in browser console during push
- Check bridge logs: `sudo journalctl -u git-nostr-bridge -f`
- Verify push completed: Check for "Bridge push failed" errors
- Re-push the repo: Files should be pushed to bridge during import/push
- Manually trigger bridge clone: The multi-source fetch should trigger clone automatically for GRASP servers

**Public repo returns 404?**
- Verify token has `public_repo` scope (NOT `repo` scope)
- Check token is set correctly: `sudo systemctl show gittr-frontend | grep GITHUB`
- Check Next.js logs: `sudo journalctl -u gittr-frontend -f`

