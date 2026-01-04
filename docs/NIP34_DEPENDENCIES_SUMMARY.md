# NIP-34 Dependencies Extension - Summary & Clarifications

## Scope
This extension (kind 1622) supports **PRs and Issues** with dependency relationships.

## Status & Blocking Behavior

### For `reltype: "blocks"` relationships (workflow dependencies):

✅ **Open/Draft PRs/Issues (1630/1633) can be open but blocked**
- If an issue/PR has status "open" (1630) or "draft" (1633) but has open `blocks` or `parent` dependencies, it should be visually marked as **"blocked"**
- **Blocked status wins** - show as blocked even though status event says "open" or "draft"
- Display: Show as **"open" or "draft" status WITH a blocked badge/indicator** (not a separate "blocked" status)

✅ **Closed/Merged/Resolved (1632/1631) status wins over blocks**
- If something is closed (1632) or merged/resolved (1631), it's done - blocking dependencies are no longer relevant
- Status remains as "closed" or "merged" regardless of dependencies

✅ **When a blocker closes/resolves (1632/1631)**
- The DEPENDENT items are automatically **unblocked** (can now proceed)
- **Status of dependents remains unchanged** (they stay "open" or "draft")
- **Blocking marker is removed** - dependents are no longer marked as "blocked"
- **Closing a blocker does NOT close its dependents** - they just become unblocked

### For `reltype: "resolves"` relationships (explicit closing):

✅ **A PR can close multiple dependent issues + PRs**
- When a PR with `reltype: "resolves"` is merged (status 1631), clients SHOULD automatically **close all target issues/PRs** (publish status 1632 for each target)
- This is different from `blocks` - `resolves` means "this PR fixes/closes these issues" (like GitHub's "Fixes #1, #2, #3")
- **Create multiple kind 1622 events** - one event per relationship (one source-target pair per event)
  - Example: PR #10 resolves Issue #1 → one event
  - PR #10 resolves Issue #2 → another event
  - PR #10 resolves Issue #3 → another event
  - When PR #10 merges, all three issues are automatically closed

**Key Distinction:**
- `blocks` → When blocker closes, dependents are **unblocked** (status unchanged)
- `resolves` → When PR merges, targets are **closed** (status changes to 1632)

## Who Can Set Dependencies?

✅ **Issue/PR author** can create dependencies for their own issues/PRs
✅ **Repository owner/maintainer** (from `maintainers[]` tag in kind 30617) can create dependencies for any issue/PR in their repo
✅ **Anyone** can create `reltype: "related"` dependencies (loose association, no workflow impact)

## UI Display

**Show blocked status as:**
- **Status remains "open" or "draft"** (from status events 1630/1633)
- **Add a "blocked" badge/indicator** to visually show the item is blocked
- Don't create a separate "blocked" status - it's a visual indicator on top of the existing status

Example UI:
- Issue #5: Status = "open" + Badge = "🔒 Blocked by Issue #3"
- PR #10: Status = "draft" + Badge = "🔒 Blocked by Issue #7"

## Repository Context (`a` tag)

✅ **For cross-repo dependencies:**
- `a` tag is **REQUIRED** for efficient queries and to prevent accidental cross-repo relationships
- Format: `["a", "30617:<repo-owner-pubkey>:<repo-id>", "<relay-url>"]`

✅ **For same-repo dependencies:**
- `a` tag is **OPTIONAL** (but recommended for query efficiency)
- If `a` tag is missing and both issues/PRs are in the same repo (determined by querying their `a` tags), assume same-repo

✅ **To support PR-to-PR, PR-to-Issue, Issue-to-PR dependencies:**
- All relationship types work for any combination of PRs and Issues
- The `a` tag requirement is the same regardless of relationship type

## Summary

- **`blocks` relationship**: Workflow dependency - "can't proceed until blocker is done"
  - Blocker closes → Dependents unblocked (status unchanged)
  
- **`resolves` relationship**: Explicit closing - "this PR fixes these issues"
  - PR merges → Targets closed (status changes to 1632)

- **Multiple dependents**: Create multiple kind 1622 events (one per relationship)

- **UI**: Show blocked as badge/indicator on existing status, not separate status

- **Permissions**: Issue/PR author + repo owner/maintainer can set dependencies

- **Repository context**: `a` tag required for cross-repo, optional for same-repo

