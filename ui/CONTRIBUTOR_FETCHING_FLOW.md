# Contributor Fetching Flow

## Overview

Contributors can come from multiple sources depending on the repo type:

1. **External repos (GitHub/GitLab/Codeberg)**: Fetched from their APIs
2. **Nostr-only repos**: Extracted from Nostr event "p" tags
3. **Hybrid repos**: Combination of both

## When Contributors Are Fetched

### 1. On Page Load (from localStorage)
- **Location**: `ui/src/app/[entity]/[repo]/page.tsx` lines 545-619
- **When**: Immediately when repo is loaded from localStorage
- **Source**: Stale data from previous visits
- **Format Check**: Detects if contributors are in GitHub format (have `login`) or Nostr format (have `pubkey`)
- **Action**: Uses as-is if Nostr format, maps if GitHub format

### 2. Fresh Fetch from External Sources (async, non-blocking)
- **Location**: `ui/src/app/[entity]/[repo]/page.tsx` lines 574-619 and 864-900
- **When**: 
  - If repo has `sourceUrl` pointing to GitHub/GitLab/Codeberg
  - Runs asynchronously (doesn't block file loading)
  - Happens in parallel with file fetching
- **API Endpoint**: `/api/git/contributors?sourceUrl=...`
- **Uses**: `GITHUB_PLATFORM_TOKEN` for GitHub (if available)
- **Updates**: Merges fresh contributors with existing ones

### 3. From Nostr Events (p tags)
- **Location**: `ui/src/app/[entity]/[repo]/page.tsx` lines 1778-1808, 1870-1900, 1999-2018
- **When**: When Nostr events are received during file fetching
- **Format**: `["p", pubkey, weight, role]` tags in Nostr events
- **Action**: Extracts contributors from p tags and merges with content contributors

## GITHUB_PLATFORM_TOKEN Usage

### GitHub
- **Location**: `ui/src/pages/api/git/contributors.ts` lines 52-73
- **Used**: Yes, if available in `process.env.GITHUB_PLATFORM_TOKEN`
- **Benefit**: 
  - Higher rate limits (5000/hour vs 60/hour)
  - Access to private repos (if token has permissions)
- **Header**: `Authorization: Bearer ${token}`

### GitLab
- **Location**: `ui/src/pages/api/git/contributors.ts` lines 74-99
- **Used**: No token needed (public API)
- **Note**: GitLab API is public and doesn't require authentication for public repos

### Codeberg
- **Location**: `ui/src/pages/api/git/contributors.ts` lines 100-125
- **Used**: No token needed (public API)
- **Note**: Codeberg uses Gitea API which is public

## Where Links Are Created

### Location
- **File**: `ui/src/components/ui/contributors.tsx` lines 87-110
- **When**: During component render (for each contributor)

### Logic
1. **If contributor has valid pubkey (64 hex chars)**:
   - Encode to npub format using `nip19.npubEncode()`
   - Link: `/${npub}` (Nostr profile page)

2. **Else if contributor has githubLogin**:
   - Link: `https://github.com/${githubLogin}` (GitHub profile)

3. **Else**:
   - Link: `#` (no link)

### Current Issue
- All contributors showing same link suggests they all have the same pubkey
- This happens when contributors from p tags are incorrectly assigned the owner's pubkey
- Or when contributors are duplicated/overwritten during merge

## Fetching Process Flow

### For External Repos (GitHub/GitLab/Codeberg)
```
1. Load repo from localStorage
2. Check if sourceUrl exists and matches GitHub/GitLab/Codeberg
3. If yes, fetch fresh contributors from API (async, non-blocking)
4. Map contributors using mapGithubContributors()
5. Merge with existing contributors (avoid duplicates)
6. Update repoData with merged contributors
```

### For Nostr-Only Repos
```
1. Load repo from localStorage (contributors from previous visit)
2. Query Nostr for repo events
3. Extract contributors from "p" tags in events
4. Merge with contributors from JSON content
5. Merge with existing contributors from localStorage
6. Update repoData and localStorage
```

## Blocking vs Non-Blocking

### File Fetching
- **Non-blocking**: Files are fetched in parallel from multiple sources
- **First success wins**: Files displayed immediately from first successful source
- **Other sources continue**: Background fetching continues for redundancy

### Contributor Fetching
- **Non-blocking**: Contributor fetching happens asynchronously
- **Doesn't wait**: File loading doesn't wait for contributors
- **Updates when ready**: Contributors update when API responds

## Relay Usage

### For File Fetching
- **All relays**: Files fetched from all available relays (GRASP servers + regular relays)
- **First success**: Uses files from first successful relay
- **No specific relay**: Doesn't target a specific relay for contributors

### For Contributor Fetching
- **External repos**: Uses HTTP API (not relays)
- **Nostr repos**: Uses same relays as file fetching (for event queries)

## Current Problems

1. **All contributors have same pubkey**: Likely bug in p tag extraction or merge logic
2. **Wrong links**: All pointing to owner's profile instead of individual profiles
3. **Icons broken**: Probably because all contributors have same pubkey, so same metadata is fetched
4. **No fresh fetch for Nostr repos**: Nostr-only repos don't have sourceUrl, so no API fetch happens

## Debugging

The enhanced logging will show:
- Each contributor extracted from p tags (with pubkey, weight, role)
- If all contributors have the same pubkey (error logged)
- Full contributor data when rendering (pubkey, githubLogin, name, role)
- Link generation for each contributor (what href is created and why)

