# TODO Review - Current Status

This document reviews all TODO comments in the codebase and categorizes them.

## TODOs Found

### 1. **NIP-39 Identity Verification** (`ui/src/lib/nostr/useContributorMetadata.ts:258`)
```typescript
verified: false, // TODO: Verify proof (fetch Gist, check content, etc.)
```

### 4. **Mention Detection - PRs** (`ui/src/app/pulls/page.tsx:273`)
```typescript
// TODO: Implement mention detection from PR content/description
```
**Status**: ⚠️ **Still Needed** - Feature not implemented
**Priority**: Medium
**Action**: Parse PR description for @mentions and notify mentioned users

### 5. **Mention Detection - Issues** (`ui/src/app/issues/page.tsx:225`)
```typescript
// TODO: Implement mention detection from issue content/description
```
**Status**: ⚠️ **Still Needed** - Feature not implemented
**Priority**: Medium
**Action**: Parse issue description for @mentions and notify mentioned users

### 6. **Fetch LNURL from Profile** (`ui/src/pages/api/zap/create-invoice.ts:58`)
```typescript
// TODO: Fetch recipient's Nostr profile to get lud16/lnurl
```
**Status**: ⚠️ **Still Needed** - Would improve zap functionality
**Priority**: Medium
**Action**: Fetch user's Kind 0 metadata to get Lightning address (lud16)

### 7. **Rate Limiting** (`ui/src/pages/api/bounty/create.ts:7`)
```typescript
// TODO: Add rate limiting for Pages Router API routes
```
**Status**: ⚠️ **Still Needed** - Security improvement
**Priority**: High (for production)
**Action**: Implement rate limiting middleware for API routes

### 8. **Bounty Storage** (`ui/src/pages/api/bounty/create.ts:75`)
```typescript
// TODO: Store bounty in database/relay with issueId, paymentHash, amount, status
```
**Status**: ⚠️ **Still Needed** - Bounties are currently only in localStorage
**Priority**: High
**Action**: Store bounty events in Nostr (kind 9803 with bounty tags) or database

### 9. **SMS Notifications** (`ui/src/lib/notifications/index.ts:52`)
```typescript
// TODO: Send SMS notification if enabled
```
**Status**: ❌ **Removed** - Not a wanted strategy
**Priority**: N/A
**Action**: Code and UI removed, no longer planned

### 10. **Login setAuthor** (`ui/src/app/login/page.tsx:21`)
```typescript
// TODO : setAuthor needs to be tweaked (don't remove but tweak *_*)
```
**Status**: ⚠️ **Unclear** - Needs investigation
**Priority**: Low
**Action**: Review `setAuthor` usage and determine what needs tweaking

### 11. **Load Diff Files** (`ui/src/app/[entity]/[repo]/pulls/new/page.tsx:136`)
```typescript
// TODO: Load diff files from compare
```
**Status**: ⚠️ **Still Needed** - Feature not implemented
**Priority**: Medium
**Action**: Implement diff loading when creating PR from compare view

### 12. **Search Users from Nostr** (`ui/src/app/[entity]/[repo]/issues/[id]/page.tsx:500`)
```typescript
{/* TODO: Search users from Nostr */}
```
**Status**: ⚠️ **Still Needed** - Feature not implemented
**Priority**: Medium
**Action**: Implement user search/autocomplete for assignees/mentions

### 13. **Fetch Contributors** (`ui/src/app/[entity]/[repo]/issues/new/page.tsx:544`)
```typescript
{/* todo: fetch contributors of this repo and list them here */}
```
**Status**: ⚠️ **Still Needed** - Would improve UX
**Priority**: Low
**Action**: Fetch and display repo contributors in assignee dropdown

### 14. **Publish Labels** (`ui/src/app/[entity]/[repo]/issues/new/page.tsx:638`)
```typescript
{/* todo: publish labels with NostrContext when the dropdown menu hides */}
```
**Status**: ⚠️ **Still Needed** - Labels need to be persisted
**Priority**: Medium
**Action**: Publish label definitions to Nostr when created

### 15. **Link to Labels Page** (`ui/src/app/[entity]/[repo]/issues/new/page.tsx:656`)
```typescript
{/* todo: link to the /labels page */}
```
**Status**: ⚠️ **Still Needed** - Missing navigation
**Priority**: Low
**Action**: Add link to labels management page

## Summary

**Total TODOs**: 15

**By Priority**:
- **High**: 2 (Rate limiting, Bounty storage)
- **Medium**: 7 (Identity verification, Mentions, LNURL, Diff files, User search, Labels)
- **Low**: 6 (NWC zap, Zap context, SMS, Login tweak, Contributors, Labels link)

**By Status**:
- **Still Needed**: 14
- **Likely Obsolete**: 1 (NWC zap - needs verification)

## Notes

- **Bounty Storage**: Currently in localStorage only - needs Nostr persistence (kind 9803)
- **Mention Detection**: Not implemented - would require parsing issue/PR descriptions
- **NIP-39 Verification**: Bot-assisted flow works, but automatic proof verification not implemented

## Recommended Actions

1. **Immediate (High Priority)**:
   - Implement rate limiting for API routes
   - Implement bounty storage in Nostr/database

2. **Short-term (Medium Priority)**:
   - Implement NIP-39 identity verification
   - Implement mention detection for issues/PRs
   - Implement user search from Nostr
   - Implement label publishing

3. **Long-term (Low Priority)**:
   - SMS notifications (if needed)
   - Automatic zap context
   - Contributor listing in assignee dropdown

