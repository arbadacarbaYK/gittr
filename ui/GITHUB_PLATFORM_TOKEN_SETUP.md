# GitHub Platform Token Setup (Optional)

**This is OPTIONAL** - only needed if you want 5000 requests/hour instead of 60/hour for GitHub API calls.

## What is GITHUB_PLATFORM_TOKEN?

This is a **Personal Access Token (PAT)**, separate from the OAuth App credentials. It's used for server-side GitHub API calls to increase rate limits.

- **Without token**: 60 requests/hour per IP (shared by all users)
- **With token**: 5000 requests/hour per token

## How to Create a Personal Access Token

1. Go to https://github.com/settings/tokens
2. Click **"Generate new token"** → **"Generate new token (classic)"**
3. Give it a name: `gittr-platform-token`
4. Select scopes:
   - ✅ `public_repo` (to read public repositories)
   - ✅ `repo` (if you need private repos - optional)
5. Click **"Generate token"**
6. **Copy the token immediately** (you'll only see it once!)

## Add to Environment

Add to `ui/.env.local`:

```bash
# Optional: GitHub Personal Access Token for platform API calls
# Increases rate limit from 60/hour to 5000/hour
# Get from: https://github.com/settings/tokens
GITHUB_PLATFORM_TOKEN=ghp_your_token_here
```

## Difference from OAuth App

| Type | Purpose | Where to Get | Used For | Status |
|------|---------|--------------|----------|--------|
| **OAuth App** (CLIENT_ID/SECRET) | User login/authentication OR platform API requests | https://github.com/settings/developers | ~~Users connecting their GitHub accounts~~ (deprecated) OR Platform API requests (if configured) | User auth: **DEPRECATED** (replaced by NIP-39). Platform requests: **OPTIONAL** (can use PAT instead) |
| **Personal Access Token** (PLATFORM_TOKEN) | Server-side API calls | https://github.com/settings/tokens | Platform making API calls on behalf of all users | **ACTIVE** - Recommended for platform requests |

**Note**: 
- The OAuth App was previously used for individual user authentication, but is now deprecated in favor of NIP-39 External Identities.
- For platform API requests (5000 requests/hour), you can use either:
  - **Personal Access Token (PAT)** - Recommended, simpler setup (see this document)
  - **OAuth App credentials** - Alternative, if you prefer OAuth App setup
- The current codebase uses `GITHUB_PLATFORM_TOKEN` (PAT) for platform requests, not OAuth App credentials.

