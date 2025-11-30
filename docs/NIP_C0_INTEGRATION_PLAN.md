# NIP-C0 (Code Snippets) Integration Plan

This document outlines the exact changes needed to add NIP-C0 code snippet support to gittr.space **without breaking existing functionality**.

## What Are NIP-C0 Code Snippets?

**NIP-C0 snippets are NOT:**
- ❌ Code examples in README files (those are already in the repo)
- ❌ A way to fetch parts of files (that's what the file viewer does)
- ❌ Part of the repository structure
- ❌ The same as the existing "Share" button (that shares the **entire repository URL**)

**NIP-C0 snippets ARE:**
- ✅ **Standalone code sharing** on Nostr (like a decentralized pastebin)
- ✅ **Discoverable snippets** that can be found across the Nostr network
- ✅ **Shareable code** that optionally links back to a source repository
- ✅ **Social code sharing** - like sharing a function/algorithm on social media, but on Nostr

### Difference from Existing Share Button

**Existing "Share" button** (in repo layout):
- Shares the **entire repository** (as a URL/link)
- Creates a `kind:1` note on Nostr with the repo URL
- Shows QR code for the repo URL
- Shares to Telegram/other platforms

**NIP-C0 "Share as Snippet" button** (in code viewer):
- Shares **selected code** (actual code content)
- Creates a `kind:1337` snippet event on Nostr
- Contains the code itself, not just a link
- Optionally links back to source repository
- Can be discovered by language, description, etc.

### Use Cases:

1. **Share code from a repo (Primary Feature):**
   - User selects code lines in file viewer
   - "Share as Snippet" button appears
   - Clicks button to publish snippet as standalone Nostr event
   - Snippet is discoverable on Nostr network
   - Optionally links back to source repository

2. **Display snippets in issue/PR comments (Secondary Feature):**
   - When someone references a snippet in a comment (via event ID or `#e` tag)
   - Snippet appears inline with syntax highlighting
   - Better than pasting raw code in text comments
   - Makes code discussions more readable

## Overview

NIP-C0 defines `kind:1337` for sharing code snippets on Nostr. Snippets are **separate events** that can reference repositories but are **NOT stored in localStorage** with repos. They're just Nostr events that get subscribed to and displayed.

## What Changes (Detailed Breakdown)

### 1. **`ui/src/lib/nostr/events.ts`** - Add Event Type Support

**Changes:**
- Add constant: `export const KIND_CODE_SNIPPET = 1337;`
- Add interface: `CodeSnippetEvent` (with all NIP-C0 fields)
- Add function: `createCodeSnippetEvent()` (similar to `createIssueEvent()`)

**Impact:** ✅ **Non-breaking** - Just adding new exports, existing code unaffected

**Code to add:**
```typescript
export const KIND_CODE_SNIPPET = 1337;

export interface CodeSnippetEvent {
  content: string; // The actual code
  language?: string; // From 'l' tag
  extension?: string; // From 'extension' tag
  name?: string; // From 'name' tag
  description?: string; // From 'description' tag
  runtime?: string; // From 'runtime' tag
  license?: string[]; // From 'license' tags (can be multiple)
  dependencies?: string[]; // From 'dep' tags
  repo?: string; // From 'repo' tag (URL or NIP-34 format: "30617:<pubkey>:<d tag>")
  repoRelay?: string; // Recommended relay for repo event
}

export function createCodeSnippetEvent(
  snippet: CodeSnippetEvent,
  privateKey: string
): any {
  // Similar structure to createIssueEvent()
  // Builds tags array with all NIP-C0 tags
}
```

---

### 2. **`ui/src/components/ui/code-viewer.tsx`** - Add "Share as Snippet" Button

**Changes:**
- Add a button that appears when lines are selected
- Button opens a modal/dialog to:
  - Show selected code preview
  - Optional: Edit description
  - Optional: Add runtime/dependencies
  - Publish as NIP-C0 snippet

**Impact:** ✅ **Non-breaking** - Just adding UI, existing code viewer unchanged

**What to add:**
- New button in the selection UI (next to "Copy permalink")
- Modal component for snippet creation
- Integration with `createCodeSnippetEvent()` and `publish()`

---

### 3. **`ui/src/components/ui/code-snippet-renderer.tsx`** - New Component (NEW FILE)

**Changes:**
- Create new component to render `kind:1337` events
- Features:
  - Syntax highlighting (using existing library or new one)
  - Display language, extension, description
  - Show repository link if `repo` tag present
  - Copy code button
  - Download as file button (using `name` and `extension` tags)

**Impact:** ✅ **Non-breaking** - New component, doesn't affect existing code

**Dependencies:**
- May need to add syntax highlighting library (e.g., `react-syntax-highlighter` or `shiki`)

---

### 4. **Comment Rendering in Issues/PRs** - Parse and Display Snippets

**Files to modify:**
- `ui/src/app/[entity]/[repo]/issues/[id]/page.tsx`
- `ui/src/app/[entity]/[repo]/pulls/[id]/page.tsx`
- `ui/src/app/[entity]/[repo]/discussions/[id]/page.tsx` (if exists)

**Changes:**
- In comment subscription, also subscribe to `kind:1337` events
- When rendering comments, check if content references a snippet event ID
- OR: Parse `kind:1337` events that reference the issue/PR via `#e` tag
- Render snippets inline in comments using `CodeSnippetRenderer`

**Impact:** ✅ **Non-breaking** - Adds new event type to subscription, existing comments still work

**Example subscription change:**
```typescript
// Current:
kinds: [KIND_COMMENT]

// New (add both):
kinds: [KIND_COMMENT, KIND_CODE_SNIPPET]
```

---

### 5. **Issues/PRs List Pages** - No Changes Needed

**Files:**
- `ui/src/app/issues/page.tsx`
- `ui/src/app/pulls/page.tsx`
- `ui/src/app/[entity]/[repo]/issues/page.tsx`
- `ui/src/app/[entity]/[repo]/pulls/page.tsx`

**Changes:** ❌ **None** - These pages list issues/PRs, not comments. Snippets appear in comments, so no changes needed here.

---

### 7. **localStorage** - No Changes Needed

**Why:** Snippets are Nostr events, not stored in localStorage. They're fetched via subscriptions when needed.

**Files affected:** ❌ **None**

**Note:** If we want to cache snippets locally for performance, we could add a separate `gittr_snippets` localStorage key, but it's **not required** for basic functionality.

---

### 8. **Push to Nostr (`ui/src/lib/nostr/push-repo-to-nostr.ts`)** - No Changes Needed

**Why:** Snippets are published separately, not as part of repo push. They use the same `publish()` function but are independent events.

**Files affected:** ❌ **None**

---

### 9. **User Settings Pages** - No Changes Needed

**Why:** Snippet sharing doesn't require new settings. It uses existing Nostr keys and relays.

**Files affected:** ❌ **None**

---

### 10. **Help/Documentation** - Update Help Page

**Files to modify:**
- `ui/src/app/help/page.tsx`
- `README.md` (optional)

**Changes:**
- Add section explaining code snippet sharing
- Show how to use "Share as Snippet" button
- Explain NIP-C0 format

**Impact:** ✅ **Non-breaking** - Just adding documentation

---

## Summary: What Actually Changes

### Files That Need Changes:
1. ✅ `ui/src/lib/nostr/events.ts` - Add snippet event type
2. ✅ `ui/src/components/ui/code-viewer.tsx` - Add share button
3. ✅ `ui/src/components/ui/code-snippet-renderer.tsx` - **NEW FILE**
4. ✅ `ui/src/app/[entity]/[repo]/issues/[id]/page.tsx` - Parse snippets in comments
5. ✅ `ui/src/app/[entity]/[repo]/pulls/[id]/page.tsx` - Parse snippets in comments
6. ✅ `ui/src/app/help/page.tsx` - Add documentation

### Files That DON'T Change:
- ❌ `ui/src/lib/repos/storage.ts` - No localStorage changes
- ❌ `ui/src/lib/nostr/push-repo-to-nostr.ts` - Snippets published separately
- ❌ `ui/src/app/page.tsx` - **No homepage snippets** (explicitly excluded)
- ❌ `ui/src/app/issues/page.tsx` - Lists issues, not comments
- ❌ `ui/src/app/pulls/page.tsx` - Lists PRs, not comments
- ❌ `ui/src/app/settings/*` - No new settings needed
- ❌ Any other existing functionality

## Implementation Strategy

### Phase 1: Core Support (Minimal Changes)
1. Add `KIND_CODE_SNIPPET` and `createCodeSnippetEvent()` to `events.ts`
2. Add "Share as Snippet" button to code viewer
3. Create basic snippet renderer component

### Phase 2: Integration (Display Snippets)
4. Parse snippets in issue/PR comments
5. Render snippets inline using snippet renderer

### Phase 3: Polish (Optional)
6. Add syntax highlighting
7. Update help documentation

## Breaking Changes: **NONE**

All changes are additive:
- New event kind (doesn't conflict with existing)
- New UI components (doesn't modify existing)
- New subscriptions (adds to existing, doesn't replace)
- New documentation (doesn't remove existing)

## Testing Checklist

- [ ] Can create snippet from code viewer
- [ ] Snippet publishes to Nostr successfully
- [ ] Snippet appears in issue/PR comments
- [ ] Snippet syntax highlighting works
- [ ] Repository link in snippet works
- [ ] Copy code button works
- [ ] Download as file works
- [ ] Existing functionality (issues, PRs, repos) still works

## Dependencies to Add

- Syntax highlighting library (if not already present):
  - Option 1: `react-syntax-highlighter` (lightweight)
  - Option 2: `shiki` (better highlighting, more features)
  - Option 3: Use existing code viewer's highlighting if available

## Questions to Decide

1. **Syntax Highlighting:** Which library to use? (or reuse existing?)
2. **Snippet Caching:** Cache snippets in localStorage or always fetch from Nostr?

