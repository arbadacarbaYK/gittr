# NIP-34 Format Analysis: npub vs hex

## Summary

Based on NIP-34 specification and Dan Conway's feedback, **npub format is preferred for user identifiers in NIP-34 tags**, but **hex format is still used for standard Nostr protocol operations**.

## Areas Affected

### ✅ FIXED: GRASP Clone URLs
- **Location**: `ui/src/lib/nostr/push-repo-to-nostr.ts` (lines 143-230)
- **Issue**: Was using hex pubkey in GRASP clone URLs
- **Fix**: Now uses npub format per NIP-34 spec: `[http|https]://<grasp-path>/<valid-npub>/<string>.git`
- **Status**: ✅ Fixed

### ✅ FIXED: Maintainers Tags
- **Location**: 
  - `ui/src/lib/nostr/push-repo-to-nostr.ts` (publishing)
  - `ui/src/lib/nostr/events.ts` (publishing)
  - `ui/src/app/explore/page.tsx` (parsing)
  - `ui/src/app/page.tsx` (parsing)
- **Issue**: Was using hex format, but Dan Conway recommended npub
- **Fix**: 
  - Publishing: Uses npub format
  - Parsing: Accepts both npub and hex, normalizes to hex for internal storage
- **Status**: ✅ Fixed

### ✅ VERIFIED: NIP-34 "a" Tags (PRs/Issues)
- **Location**: 
  - `ui/src/lib/nostr/events.ts` (lines 460, 516)
  - `ui/src/app/[entity]/[repo]/pulls/new/page.tsx` (line 295)
- **Current**: Uses hex pubkey: `30617:${ownerPubkey}:${repoName}`
- **NIP-34 Spec**: Shows `30617:<base-repo-owner-pubkey>:<base-repo-id>`
  - Spec uses term "pubkey" (not "npub"), which in Nostr protocol context means hex format
  - Used for protocol-level filtering (`#a` tag filters)
  - Unlike clone URLs which explicitly say `<valid-npub>`, "a" tags use generic "pubkey"
- **Analysis**: 
  - "a" tags are used for filtering (`#a` tag filters)
  - Standard Nostr filtering uses hex format
  - Spec examples show hex format (implicitly via "pubkey" terminology)
- **Recommendation**: **Keep hex format** ✅ (correct as-is)
- **Status**: ✅ Verified - hex format is correct

### ✅ VERIFIED: NIP-34 "p" Tags (Repository Owner)
- **Location**: 
  - `ui/src/lib/nostr/events.ts` (lines 464, 520)
  - `ui/src/app/[entity]/[repo]/pulls/new/page.tsx` (line 299)
- **Current**: Uses hex pubkey
- **NIP-34 Spec**: Shows `["p", "<repository-owner>"]` and `["p", "<other-user>"]`
  - These are standard Nostr "p" tags (NIP-01)
  - Standard Nostr protocol uses hex format for "p" tags
  - Spec examples implicitly use hex (standard Nostr pattern)
- **Analysis**: 
  - "p" tags are standard Nostr protocol tags (NIP-01)
  - All Nostr protocol operations use hex format for "p" tags
  - This is a protocol-level tag, not a display tag
- **Recommendation**: **Keep hex format** ✅ (correct as-is)
- **Status**: ✅ Verified - hex format is correct

### ⚠️ NEEDS REVIEW: gitworkshop.dev URLs
- **Location**: `ui/src/lib/nostr/push-repo-to-nostr.ts` (lines 1417, 1427)
- **Current**: Uses hex pubkey: `https://gitworkshop.dev/${pubkey}/${actualRepositoryName}`
- **Analysis**: 
  - This is a URL, not a NIP-34 tag
  - gitworkshop.dev is an ngit client that follows NIP-34
  - If they follow NIP-34 clone URL pattern (`<valid-npub>`), they might expect npub
  - But URLs might use hex for backend consistency
- **Recommendation**: **Change to npub format** to match NIP-34 clone URL pattern
- **Status**: ⚠️ Should be updated to npub for consistency

### ✅ CORRECT: UI URLs (Entity Links)
- **Location**: 
  - `ui/src/app/explore/page.tsx`
  - `ui/src/app/repositories/page.tsx`
  - `ui/src/app/page.tsx`
- **Current**: Converts pubkey to npub for URLs: `/${npub}/${repo}`
- **Status**: ✅ Correct (npub is user-friendly for URLs)

## Decision Matrix

| Feature | Format | Reason |
|---------|--------|--------|
| GRASP Clone URLs | **npub** | NIP-34 spec explicitly says `<valid-npub>` |
| Maintainers Tags | **npub** | Dan Conway feedback, user identifier |
| "a" Tags (PRs/Issues) | **hex** ✅ | Protocol filtering, spec uses "pubkey" (hex) |
| "p" Tags (Owner) | **hex** ✅ | Standard Nostr protocol tag (NIP-01) |
| UI URLs | **npub** | User-friendly, display format |
| gitworkshop.dev URLs | **?** | Needs verification |

## Next Steps

1. ✅ **DONE**: Fixed GRASP clone URLs to use npub
2. ✅ **DONE**: Fixed maintainers tags to use npub (with hex parsing fallback)
3. ✅ **DONE**: Verified "a" tag format - hex is correct (spec uses "pubkey" terminology)
4. ✅ **DONE**: Verified "p" tag format - hex is correct (standard Nostr protocol)
5. ⚠️ **TODO**: Verify gitworkshop.dev URL format expectations (may need npub if they follow NIP-34 patterns)

## References

- NIP-34 Spec: https://github.com/nostr-protocol/nips/blob/master/34.md
- NIP-34 PR Section: Mentions `<valid-npub>` in clone URLs
- Dan Conway Feedback: Recommended npub for maintainers tags

