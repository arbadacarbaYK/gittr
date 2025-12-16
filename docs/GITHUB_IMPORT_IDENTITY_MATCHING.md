# How GitHub Import Matches Contributors to Nostr Identities

## Overview

When you import a repository from GitHub, the system automatically tries to match GitHub contributors to their Nostr identities. This allows contributors who have linked their GitHub account to Nostr to be displayed with their Nostr profile picture and name instead of just their GitHub avatar.

## The Process

### Step 1: Import Repository
When you import a repo from GitHub (via `/import` page), the system:
1. Fetches the repository data from GitHub API
2. Gets the list of contributors (GitHub usernames, avatars, contribution counts)

### Step 2: Query Nostr for Identity Claims
Before mapping contributors, the system queries Nostr relays for **NIP-39 identity claims**:

```typescript
// From ui/src/app/import/page.tsx (lines 904-916)
const githubLogins = importData.contributors.map((c: any) => c.login).filter(Boolean);
if (subscribe && defaultRelays && githubLogins.length > 0) {
  const { queryGithubIdentitiesFromNostr } = await import("@/lib/github-mapping");
  await queryGithubIdentitiesFromNostr(subscribe, defaultRelays, githubLogins);
}
```

### Step 3: How NIP-39 Identity Claims Work

**NIP-39** is a Nostr standard for external identity verification. Users publish a **Kind 0** (metadata) event with special `i` tags:

```json
{
  "kind": 0,
  "pubkey": "abc123...",
  "tags": [
    ["i", "github:username"]
  ],
  "content": "{...profile data...}"
}
```

This means: "The Nostr pubkey `abc123...` claims to own the GitHub account `username`".

### Step 4: Searching Nostr Relays

The system searches through **all Kind 0 events** on your configured Nostr relays:

```typescript
// From ui/src/lib/github-mapping.ts (lines 63-80)
const unsub = subscribe(
  [{ kinds: [0] }],  // Query all Kind 0 (metadata) events
  defaultRelays,
  (event, isAfterEose) => {
    // Look for "i" tags with "github:username" format
    for (const tag of event.tags) {
      if (tag[0] === "i" && tag[1].startsWith("github:")) {
        const githubUsername = tag[1].substring(7); // Remove "github:" prefix
        // Map: githubUsername -> event.pubkey
        identityMap.set(githubUsername, event.pubkey);
      }
    }
  }
);
```

**Note**: This queries ALL Kind 0 events because not all relays support filtering by tags. The filtering happens in the callback.

### Step 5: Building the Identity Cache

The results are cached for 5 minutes to avoid repeated queries:

```typescript
// Cache for GitHub username -> pubkey mappings from NIP-39
let githubIdentityCache: Map<string, string> | null = null;
let githubIdentityCacheTimestamp: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
```

### Step 6: Mapping Contributors

When mapping GitHub contributors to Nostr contributors:

```typescript
// From ui/src/lib/github-mapping.ts (lines 182-184)
const mapped = validContributors.map((contrib) => {
  const pubkey = getPubkeyFromGithub(contrib.login); // Look up in cache
  // ... use pubkey to get Nostr profile picture/name
});
```

The `getPubkeyFromGithub()` function checks:
1. **First**: localStorage mappings (from old OAuth - backward compatible)
2. **Second**: NIP-39 identity cache (from Nostr queries)

### Step 7: Display Priority

For each contributor, the system uses this priority:

**Profile Picture:**
1. Nostr profile picture (if identity found and metadata available)
2. Current user's Nostr picture (if this contributor is the current user)
3. GitHub avatar (fallback)

**Display Name:**
1. Nostr `display_name` or `name` (if identity found)
2. GitHub login (fallback)

## How Users Link Their GitHub Identity

Users link their GitHub identity via **Settings → Profile → External Identities (NIP-39)**:

1. Go to Settings → Profile
2. Scroll to "External Identities" section
3. Click "Add Identity"
4. Select "GitHub" as platform
5. Enter GitHub username (e.g., `username`)
6. Optionally add a proof (URL to a file/commit proving ownership)
7. Save - this publishes a Kind 0 event with `["i", "github:username"]` tag

## Important Notes

### All Contributors Are Shown
The system **keeps ALL contributors**, even if they haven't linked their Nostr identity:
- Contributors with Nostr identity → shown with Nostr profile picture/name
- Contributors without Nostr identity → shown with GitHub avatar/login

This ensures you see the full contributor list, not just those who have claimed identities.

### Query Performance
- The Nostr query has a **10-second timeout**
- Results are **cached for 5 minutes** to avoid repeated queries
- The query searches through ALL Kind 0 events (can be slow on large relays)

### Backward Compatibility
The system still checks `localStorage` for old OAuth mappings (from when users connected via the OAuth button). This ensures existing imports continue to work.

## Example Flow

1. **Alice** imports a repo with contributors: `bob`, `charlie`, `dave`
2. System queries Nostr: "Who has claimed `github:bob`, `github:charlie`, `github:dave`?"
3. Finds:
   - `bob` → `npub1abc...` (has Nostr identity)
   - `charlie` → not found (no Nostr identity)
   - `dave` → `npub1xyz...` (has Nostr identity)
4. Maps contributors:
   - `bob`: Uses Nostr profile picture/name from `npub1abc...`
   - `charlie`: Uses GitHub avatar/login (no Nostr identity)
   - `dave`: Uses Nostr profile picture/name from `npub1xyz...`

## Troubleshooting

**Contributors not showing Nostr profiles:**
- Check if they've published a NIP-39 identity claim (Settings → Profile → External Identities)
- Verify the GitHub username matches exactly (case-insensitive)
- Check browser console for identity query logs
- Ensure your relays are accessible and returning Kind 0 events

**Slow imports:**
- The Nostr query can take up to 10 seconds
- Large relays with many Kind 0 events may be slower
- Results are cached, so subsequent imports are faster

