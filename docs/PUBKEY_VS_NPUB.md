# Pubkey vs npub Format in gittr

This document explains when to use hex pubkey (64-char) vs npub (NIP-19) format in the gittr push workflow and why.

## NIP-34 Specification Requirements

According to NIP-34 (Nostr Git Repositories):

1. **Clone URLs MUST use npub format**: `https://git.gittr.space/npub1.../repo.git`
2. **Nostr events use hex pubkey**: Event `pubkey` field is always hex (64-char)
3. **Storage is implementation-specific**: Bridge can store by hex or npub, but must support npub in URLs

## Current Implementation

### localStorage (Browser/Client)

**Storage**: Repositories are stored in `localStorage` with **BOTH formats**:
```javascript
{
  entity: "npub1abc...",        // npub format (for display/URLs)
  ownerPubkey: "9a83779e...",   // hex format (64-char, for API calls)
  repo: "my-repo",
  // ... other fields
}
```

**Why both?**
- `entity` (npub): Used for URLs, display, and user-facing identifiers
- `ownerPubkey` (hex): Used for API calls to bridge, Nostr events, and internal operations
- Both are needed: npub for user experience, hex for technical operations

**Storage keys**: All repo-related localStorage keys use `entity` (npub):
- `gittr_files__{entity}__{repo}`
- `gittr_overrides__{entity}__{repo}`
- `gittr_commits__{entity}__{repo}`

### Filesystem Storage (git-nostr-bridge)

**Storage**: Repositories are stored by **hex pubkey** in the filesystem:
```
reposDir/{hexPubkey}/{repoName}.git
```

**Why hex?**
- Filesystem paths are more reliable with hex (no special characters like `npub1...`)
- Hex is the canonical format for Nostr pubkeys
- Easier to validate and sanitize

**NIP-34 Compatibility**: The bridge creates a **symlink from npub to hex**:
```
reposDir/npub1... -> reposDir/{hexPubkey}
```

This allows both formats to work:
- Clone URLs use npub: `https://git.gittr.space/npub1.../repo.git` ✅
- Filesystem storage uses hex: `reposDir/{hexPubkey}/repo.git` ✅
- Both resolve to the same repository ✅

**Important**: The symlink is created by the bridge, NOT stored in localStorage. It's a filesystem-level compatibility layer.

### API Endpoints

**Current behavior**: All API endpoints accept **both hex and npub** formats:
- `/api/nostr/repo/push` - accepts both, auto-decodes npub to hex
- `/api/nostr/repo/files` - accepts both
- `/api/nostr/repo/file-content` - accepts both
- `/api/nostr/repo/clone` - accepts both

**Internal processing**: All endpoints convert npub to hex internally for filesystem operations.

### Nostr Events

**Event fields**: Always use **hex pubkey**:
- `event.pubkey` - hex format (64-char)
- `event.sig` - hex format (64-char)

**Event tags**: Use format as specified by NIP-34:
- Clone tags: `["clone", "https://git.gittr.space/npub1.../repo.git"]` - **npub format** ✅
- Relay tags: `["relays", "wss://relay.com"]` - relay URLs
- Other tags: As per NIP-34 spec

### Push Workflow

1. **Load from localStorage**: 
   ```typescript
   const repo = loadStoredRepos().find(r => r.entity === entity && r.repo === repoSlug);
   // repo.entity = "npub1..." (npub format)
   // repo.ownerPubkey = "9a83779e..." (hex format)
   ```

2. **Get pubkey for push**: Use `ownerPubkey` (hex) from repo, or resolve from `entity`:
   ```typescript
   const pubkey = repo.ownerPubkey || resolveEntityToPubkey(repo.entity);
   // pubkey is always hex format (64-char)
   ```

3. **Clone URLs generated**: Convert hex to npub for GRASP clone URLs:
   ```typescript
   const npub = nip19.npubEncode(pubkey);
   const cloneUrl = `https://git.gittr.space/${npub}/repo.git`;
   ```

4. **Bridge API call**: Send hex pubkey to `/api/nostr/repo/push`:
   ```typescript
   {
     ownerPubkey: pubkey, // hex format (from repo.ownerPubkey)
     repo: "repo-name",
     files: [...]
   }
   ```

5. **Bridge storage**: 
   - Stores by hex pubkey: `reposDir/{hexPubkey}/repo.git`
   - Creates npub symlink: `reposDir/npub1... -> reposDir/{hexPubkey}`
   - Symlink is filesystem-only, NOT stored in localStorage

6. **Nostr event**: Published with hex pubkey in `event.pubkey`, npub in clone tags

**Key Point**: localStorage stores BOTH formats (entity=npub, ownerPubkey=hex). The bridge only stores hex (with npub symlink for compatibility). The symlink is NOT part of localStorage - it's a filesystem feature.

## Summary Table

| Context | Format | Reason |
|---------|--------|--------|
| **localStorage.entity** | npub | User-facing identifier, used in URLs |
| **localStorage.ownerPubkey** | hex | Technical operations, API calls, events |
| **Filesystem storage** | hex | Reliable paths, canonical format |
| **Filesystem symlink** | npub→hex | Compatibility layer (created by bridge) |
| **Clone URLs (NIP-34)** | npub | Required by NIP-34 spec |
| **Nostr event.pubkey** | hex | Standard Nostr format |
| **Nostr event tags (clone)** | npub | Required by NIP-34 spec |
| **API endpoints** | both | Accepts both, converts internally |
| **Bridge internal** | hex | Filesystem operations use hex |
| **Database (bridge)** | hex | Stores by hex pubkey |

## Is This Correct?

**Yes, this is correct and compliant with NIP-34:**

1. ✅ Clone URLs use npub (per NIP-34 spec)
2. ✅ Filesystem storage uses hex (implementation detail, not specified by NIP-34)
3. ✅ Symlink provides compatibility (both formats work)
4. ✅ API accepts both formats (user convenience)
5. ✅ Events use hex pubkey (standard Nostr format)

The bridge's approach of storing by hex and symlinking npub is a best practice:
- Maintains filesystem reliability (hex paths)
- Provides NIP-34 compliance (npub URLs)
- Supports both formats seamlessly

## References

- [NIP-34: Nostr Git Repositories](https://github.com/nostr-protocol/nips/blob/master/34.md)
- [NIP-19: bech32-encoded entities](https://github.com/nostr-protocol/nips/blob/master/19.md)
- Bridge implementation: `ui/gitnostr/cmd/git-nostr-bridge/repo.go` (lines 222-257)

