# Pubkey vs npub Format in gittr

This document explains when to use hex pubkey (64-char) vs npub (NIP-19) format in the gittr push workflow and why.

## NIP-34 Specification Requirements

According to NIP-34 (Nostr Git Repositories):

1. **Clone URLs MUST use npub format**: `https://git.gittr.space/npub1.../repo.git`
2. **Nostr events use hex pubkey**: Event `pubkey` field is always hex (64-char)
3. **Storage is implementation-specific**: Bridge can store by hex or npub, but must support npub in URLs

## Current Implementation

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

1. **User provides**: Hex pubkey (from NIP-07 extension or stored session)
2. **Clone URLs generated**: Convert hex to npub for GRASP clone URLs:
   ```typescript
   const npub = nip19.npubEncode(pubkey);
   const cloneUrl = `https://git.gittr.space/${npub}/repo.git`;
   ```
3. **Bridge API call**: Send hex pubkey to `/api/nostr/repo/push`:
   ```typescript
   {
     ownerPubkey: pubkey, // hex format
     repo: "repo-name",
     files: [...]
   }
   ```
4. **Bridge storage**: Stores by hex pubkey, creates npub symlink
5. **Nostr event**: Published with hex pubkey in `event.pubkey`, npub in clone tags

## Summary Table

| Context | Format | Reason |
|---------|--------|--------|
| **Filesystem storage** | hex | Reliable paths, canonical format |
| **Clone URLs (NIP-34)** | npub | Required by NIP-34 spec |
| **Nostr event.pubkey** | hex | Standard Nostr format |
| **Nostr event tags (clone)** | npub | Required by NIP-34 spec |
| **API endpoints** | both | Accepts both, converts internally |
| **Bridge internal** | hex | Filesystem operations use hex |

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

