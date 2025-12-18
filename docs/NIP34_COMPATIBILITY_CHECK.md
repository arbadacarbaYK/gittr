# NIP-34 Compatibility Check

## Summary

After comprehensive review of the codebase, **all NIP-34 changes are compatible** with existing functionality. No breaking changes detected.

## Changes Made

1. **GRASP Clone URLs**: Changed from hex pubkey to npub format
2. **Maintainers Tags**: Changed from hex to npub format (with hex parsing fallback)
3. **State Event Content**: Empty content per NIP-34 spec
4. **"a" Tags**: Kept hex format (correct per NIP-34)
5. **"p" Tags**: Kept hex format (correct per NIP-34)

## Compatibility Analysis

### ✅ Bridge (git-nostr-bridge)

**Status**: **COMPATIBLE** - No issues

- Bridge does **NOT** extract pubkeys from clone URLs
- Bridge uses `event.PubKey` (event author) to determine repo path: `filepath.Join(reposDir, event.PubKey, repoName+".git")`
- Bridge clones from clone URLs as-is using standard `git clone` command
- Bridge handles both NIP-34 (kind 30617) and legacy (kind 51) events
- Bridge extracts clone URLs from `clone` tags and uses them directly - no parsing of pubkeys

**Code Reference**: `ui/gitnostr/cmd/git-nostr-bridge/repo.go:148-188`

### ✅ localStorage

**Status**: **COMPATIBLE** - No issues

- Repos are stored with clone URLs as-is (no pubkey extraction)
- Clone URLs are used for cloning, not for extracting owner/pubkey
- Owner pubkey is stored separately in `ownerPubkey` field
- Entity is stored as npub format (already correct)
- No code attempts to extract pubkeys from GRASP clone URLs

**Code References**:
- `ui/src/app/explore/page.tsx:1320-1327` - Stores clone URLs as-is
- `ui/src/app/page.tsx:307` - Stores clone URLs as-is
- `ui/src/app/[entity]/[repo]/page.tsx:1863-1884` - Reads clone URLs as-is

### ✅ PR/Issue Aggregation

**Status**: **COMPATIBLE** - NIP-34 compliant

- PRs/Issues use `#a` tag filter: `30617:<owner-pubkey>:<repo-id>`
- `owner-pubkey` is hex format (correct per NIP-34 spec)
- Code correctly parses `a` tags: `aParts[1]` is hex pubkey
- No dependency on clone URLs for PR/issue matching
- Backward compatibility maintained with old `#repo` tag format

**Code References**:
- `ui/src/app/[entity]/[repo]/pulls/page.tsx:193-196` - Parses `#a` tag correctly
- `ui/src/app/[entity]/[repo]/issues/page.tsx:168-171` - Parses `#a` tag correctly
- `ui/src/lib/nostr/events.ts:460, 516` - Creates `#a` tags with hex pubkey

### ✅ Clone URL Parsing

**Status**: **COMPATIBLE** - No pubkey extraction

- `parseNIP34Repository` stores clone URLs as-is
- No code extracts pubkeys from GRASP clone URLs
- `extractOwnerRepo` function (in explore page) only extracts owner/repo from GitHub/GitLab/Codeberg URLs for logo fetching
- GRASP clone URLs are not parsed for owner extraction

**Code References**:
- `ui/src/app/explore/page.tsx:16-95` - `parseNIP34Repository` stores clone URLs as-is
- `ui/src/app/explore/page.tsx:453-480` - `extractOwnerRepo` only handles GitHub/GitLab/Codeberg URLs

### ✅ State Event Content

**Status**: **COMPATIBLE** - Per NIP-34 spec

- State events (kind 30618) have empty content per NIP-34 spec
- Bridge handles empty content correctly (doesn't parse JSON from content)
- All data is in tags (refs, HEAD, etc.) - correct per spec
- Bridge extracts refs from tags, not from content

**Code References**:
- `ui/src/lib/nostr/push-repo-to-nostr.ts:1281` - Sets `content: ""`
- `ui/src/lib/nostr/events.ts:432` - Sets `content: ""`
- `ui/gitnostr/cmd/git-nostr-bridge/repo.go:29-53` - Handles NIP-34 events (tags-based, not content-based)

### ✅ Maintainers Tags

**Status**: **COMPATIBLE** - Handles both formats

- Publishing: Uses npub format
- Parsing: Accepts both npub and hex, normalizes to hex for internal storage
- No code depends on maintainers being in hex format from clone URLs

**Code References**:
- `ui/src/lib/nostr/push-repo-to-nostr.ts:750-762` - Publishes npub format
- `ui/src/app/explore/page.tsx:66-93` - Parses both formats, normalizes to hex

## Potential Issues Checked

### ❌ No Issues Found

1. **Bridge extracting pubkeys from clone URLs**: ✅ Not happening - bridge uses `event.PubKey`
2. **localStorage expecting hex in clone URLs**: ✅ Not happening - clone URLs stored as-is
3. **PR/Issue matching using clone URLs**: ✅ Not happening - uses `#a` tags with hex pubkey
4. **State event content parsing**: ✅ Not happening - bridge reads from tags
5. **Maintainers format dependency**: ✅ Not happening - parsing handles both formats

## Conclusion

**All NIP-34 changes are safe and compatible with existing codebase.**

The changes only affect:
1. **Publishing**: Clone URLs and maintainers tags now use npub format
2. **Parsing**: Maintainers tags accept both formats (backward compatible)

No code depends on extracting pubkeys from clone URLs or parsing state event content. The bridge, localStorage, PR/issue aggregation, and all other functionality work correctly with the NIP-34 changes.

