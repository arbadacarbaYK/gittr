# nostr-tools Update Analysis: v1.7.4 → v2.17.2

## Current Status
- **Current Version**: 1.7.4
- **Latest Version**: 2.17.2
- **Gap**: ~1 year of updates (v2.0.0 released around Sept 2023)

## What We're Using from nostr-tools

Based on codebase analysis, we use:
- ✅ `getEventHash` - Event hashing
- ✅ `signEvent` - Event signing
- ✅ `getPublicKey` - Public key derivation
- ✅ `nip04` - NIP-04 encryption (encrypt/decrypt)
- ✅ `nip19` - NIP-19 bech32 encoding/decoding (npub, nsec, etc.)
- ✅ `nip05`, `nip06`, `nip26`, `nip57` - Various NIP utilities
- ⚠️ `nip44` - **NOT AVAILABLE in v1.7.4** (added in v2.x, needed for NIP-47 compliance)

## Key Changes in v2.0.0+

### 1. **NIP-44 Support** ✅
- **Status**: Added in v2.x (PR #221, merged Sept 2023)
- **Impact**: **CRITICAL** - We need this for proper NIP-47 compliance
- **Current Workaround**: We're using NIP-04 with encryption tag, but NIP-44 is preferred

### 2. **Import Structure Changes** ⚠️
- **v2.0.0+**: Introduces `/pure` imports for tree-shaking
- **Example**: `import { getPublicKey } from 'nostr-tools/pure'`
- **Backward Compatibility**: Old imports (`import { getPublicKey } from 'nostr-tools'`) **should still work** but may be deprecated

### 3. **TypeScript Requirements** ⚠️ **BLOCKER**
- **v2.0.0+**: Requires TypeScript >= 5.0
- **Current**: TypeScript 4.9.5
- **Action Required**: Update TypeScript to 5.0+ before updating nostr-tools

### 4. **Dependencies** ✅
- **v2.0.0+**: Only depends on `@scure` and `@noble` packages (cleaner deps)
- **Impact**: Should reduce bundle size and improve security

## Breaking Changes Risk Assessment

### Low Risk (Likely Compatible)
- ✅ `getEventHash` - Core function, unlikely to change
- ✅ `signEvent` - Core function, unlikely to change
- ✅ `getPublicKey` - Core function, unlikely to change
- ✅ `nip04` - Should remain backward compatible
- ✅ `nip19` - Should remain backward compatible

### Medium Risk (Need Testing)
- ⚠️ Import paths - May need to update to `/pure` imports
- ⚠️ Type definitions - May have changed
- ⚠️ Error handling - May have different error types

### High Risk (Requires Code Changes)
- ⚠️ **NIP-44** - New API, but we've already prepared for it with conditional checks

## Recommendation

### ✅ **RECOMMENDED: Update to v2.17.2**

**Reasons:**
1. **NIP-44 Support**: Critical for NIP-47 compliance (we've already coded for it)
2. **Security**: Latest versions include security improvements
3. **Performance**: NIP-44 is ~5x faster than NIP-04
4. **Future-Proofing**: Staying current with Nostr protocol evolution
5. **Low Breaking Risk**: Core functions we use are stable

**Migration Strategy:**
1. **Test in Development First**: Update in dev environment
2. **Verify Imports**: Check if old imports still work (they should)
3. **Test Core Functions**: Verify `getEventHash`, `signEvent`, `getPublicKey` work
4. **Test NIP-04**: Ensure backward compatibility maintained
5. **Test NIP-19**: Verify npub/nsec encoding/decoding
6. **Enable NIP-44**: Once confirmed working, our conditional code will automatically use it

**Testing Checklist:**
- [ ] Event creation and signing
- [ ] NIP-04 encryption/decryption (DM notifications)
- [ ] NIP-19 encoding/decoding (npub/nsec)
- [ ] NWC payments (will automatically use NIP-44 if wallet supports it)
- [ ] All Nostr event publishing
- [ ] Profile metadata updates

## Alternative: Stay on v1.7.4

**Pros:**
- ✅ No risk of breaking changes
- ✅ Known working state

**Cons:**
- ❌ Missing NIP-44 support (required for modern NIP-47 wallets)
- ❌ Missing security updates
- ❌ Missing performance improvements
- ❌ Falling behind protocol evolution

## Conclusion

**Update is recommended** because:
1. We've already written defensive code that checks for NIP-44 availability
2. The breaking change risk is low (core APIs are stable)
3. NIP-44 support is becoming essential for NWC compatibility
4. The benefits (security, performance, features) outweigh the risks

**Action Plan:**
1. **First**: Update TypeScript to >= 5.0 (currently 4.9.5)
   - Update `package.json` devDependencies: `"typescript": "^5.0.0"` (or latest)
   - Run `npm install`
   - Test that project still compiles (`npm run build` or `npx tsc --noEmit`)
   - Fix any TypeScript 5.0 breaking changes if needed
2. **Then**: Update `package.json`: `"nostr-tools": "^2.17.2"`
3. Run `npm install`
4. Test in development environment
5. Verify all imports still work (old imports should work, but test)
6. Test critical paths (events, encryption, NWC)
7. Verify NIP-44 is now available and working
8. Deploy if all tests pass

**Note**: TypeScript 5.0+ may have some breaking changes, but they're usually minimal for most projects. Test thoroughly.

