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

| Type | Purpose | Where to Get | Used For |
|------|---------|--------------|----------|
| **OAuth App** (CLIENT_ID/SECRET) | User login/authentication | https://github.com/settings/developers | Users connecting their GitHub accounts |
| **Personal Access Token** (PLATFORM_TOKEN) | Server-side API calls | https://github.com/settings/tokens | Platform making API calls on behalf of all users |

**Note**: The OAuth App form you're filling out is for user authentication. The platform token is created separately from the tokens page.

