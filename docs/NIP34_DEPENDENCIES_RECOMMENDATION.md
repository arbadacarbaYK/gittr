# Recommendation: NIP-34 Issue/PR Dependencies Extension (Kind 1622)

## Executive Summary

**Recommendation: ✅ STRONGLY SUPPORT with minor enhancements**

The proposed issue dependencies extension (kind 1622) aligns well with our NIP-34 implementation and would significantly enhance workflow management capabilities. We should support it with a few clarifications and additions.

## Current State Analysis

### What We Have (NIP-34 Compliance)

✅ **Full NIP-34 Compliance:**
- **Kind 1621**: Issues (fully implemented)
- **Kind 1618**: Pull Requests (fully implemented)
- **Kind 1619**: PR Updates (fully implemented)
- **Kinds 1630-1633**: Status Events (Open/Applied/Closed/Draft)

✅ **Current Relationship Tracking:**
- Simple `linkedIssue` field in PRs (event ID string)
- No dependency system
- No blocking relationships
- No parent/child hierarchies

### What We're Missing

❌ **No dependency tracking:**
- Can't express "Issue A blocks Issue B"
- Can't create parent/child issue relationships (epics/subtasks)
- Can't track duplicate issues
- Can't show "ready work" (unblocked issues)

❌ **Limited workflow visibility:**
- No visual indicators for blocked work
- No dependency graphs
- No automatic status updates based on dependencies

## Proposal Analysis

### Strengths of the Proposal

1. **Clean Event Structure:**
   - Uses standard Nostr event model (kind 1622)
   - Follows NIP-34 patterns (uses `a`, `e`, `p` tags consistently)
   - Separate events for each relationship (allows fine-grained control)

2. **Flexible Relationship Types:**
   - `blocks`: Clear blocking semantics
   - `parent`: Hierarchical relationships (epics/subtasks)
   - `related`: Loose associations
   - `duplicates`: Duplicate tracking

3. **Query Efficiency:**
   - Uses `#e` tags for efficient filtering
   - Optional `#a` tag for repository-scoped queries
   - Supports both issue-to-issue and PR-to-issue relationships

4. **Deletion Support:**
   - Uses `deleted` tag pattern (consistent with other NIPs)
   - Latest event wins (by `created_at`)

### Areas for Clarification/Enhancement

1. **PR Dependencies:**
   - Proposal focuses on issues, but mentions PRs
   - Should clarify: Can PRs have dependencies? Can PRs block issues?
   - **Recommendation:** Explicitly support PR-to-PR, PR-to-Issue, Issue-to-PR dependencies

2. **Relationship Direction:**
   - Proposal uses `source` and `target` markers
   - `blocks` relationship: "source is blocked by target" or "target blocks source"?
   - **Recommendation:** Clarify direction semantics:
     - `["e", "<issue-a>", "<relay>", "source"]` + `["e", "<issue-b>", "<relay>", "target"]` + `["reltype", "blocks"]`
     - Means: "Issue A is blocked by Issue B" (Issue B must close before Issue A can proceed)
     - Alternative: "Issue B blocks Issue A"

3. **Repository Context:**
   - Optional `a` tag for repository reference
   - **Recommendation:** Make `a` tag REQUIRED for cross-repo dependencies, optional for same-repo
   - This helps with query efficiency and prevents accidental cross-repo relationships

4. **Status Integration:**
   - Proposal mentions "ready work" calculation
   - **Recommendation:** Clarify interaction with status events (kinds 1630-1633):
     - **Kind 1630 (Open)**: Should NOT override blocking. If an issue/PR has status "open" (1630) but has open `blocks` or `parent` dependencies, it should be visually marked as "blocked" even though the status event says "open". The status event tracks explicit state (user set it to open), but dependencies track implicit blocking (can't actually work on it yet).
     - **Kind 1631 (Applied/Merged/Resolved)**: Status WINS. If something is resolved/merged, it's done - blocking dependencies are no longer relevant. The issue/PR is complete regardless of dependencies.
     - **Kind 1632 (Closed)**: Status WINS. If something is closed, it's closed - blocking dependencies don't matter. The issue/PR is finished.
     - **Kind 1633 (Draft)**: Should NOT override blocking. Draft items can still be blocked by dependencies. Show as "blocked" if dependencies exist.
     - **When a Blocker Closes/Resolves (1632/1631) - `blocks` relationship**: When an issue/PR that was BLOCKING other items (using `reltype: "blocks"`) gets closed (1632) or resolved/merged (1631), the DEPENDENT items should be automatically unblocked. The blocking dependency is effectively resolved - dependents can now proceed. Note: This does NOT automatically change the status of dependents (they remain "open" or "draft"), but they are no longer marked as "blocked". This matches GitHub's behavior where closing a blocker doesn't automatically close dependents, but removes the blocking relationship.
     - **When a PR Merges - `resolves` relationship**: When a PR with `reltype: "resolves"` is merged (status 1631), clients SHOULD automatically close all target issues/PRs (publish status 1632 for each target). This is different from `blocks` - `resolves` means "this PR fixes/closes these issues" (like GitHub's "Fixes #1, #2, #3"). The `resolves` relationship explicitly indicates that merging the PR should close the targets.
     - **Summary**: Only "open" (1630) and "draft" (1633) statuses should respect dependency-based blocking. "Resolved" (1631) and "Closed" (1632) indicate completion and should override blocking. When a blocker closes/resolves, dependents are automatically unblocked (but their status remains unchanged).

5. **Validation Rules:**
   - Who can create dependencies?
   - **Recommendation:** 
     - Issue/PR author can create dependencies
     - Repository maintainers (from `maintainers[]` tag in kind 30617) can create dependencies
     - Anyone can create `related` dependencies (loose association)

6. **Event Kind Number:**
   - Proposal uses kind 1622
   - **Recommendation:** Verify this doesn't conflict with other NIPs or reserved kinds
   - Alternative: Consider 1623 if 1622 is taken

## Implementation Recommendations

### Phase 1: Core Support (MVP)

1. **Event Creation:**
   ```typescript
   // Add to ui/src/lib/nostr/events.ts
   export const KIND_ISSUE_DEPENDENCY = 1622;
   
   export interface IssueDependencyEvent {
     sourceEventId: string;  // Issue/PR that is blocked/dependent
     targetEventId: string;  // Issue/PR that blocks/is parent
     relationshipType: "blocks" | "parent" | "related" | "duplicates";
     repoReference?: string; // Optional: "30617:pubkey:repo-id"
     deleted?: boolean;
   }
   ```

2. **UI Display:**
   - Add dependency section to issue/PR detail pages
   - Show "Blocked by" and "Blocks" lists
   - Show "Parent" and "Children" for hierarchical relationships
   - Visual indicators (badges, icons) for blocked status

3. **Query Support:**
   - Query dependencies when loading issues/PRs
   - Calculate "ready work" (unblocked issues)
   - Show dependency graphs (optional, advanced)

### Phase 2: Enhanced Features

1. **Automatic Status Updates:**
   - When a blocking issue closes, check if dependent issues are now unblocked
   - Show "unblocked" notifications

2. **Dependency Graphs:**
   - Visual graph of issue/PR relationships
   - Highlight blocking chains

3. **Bulk Operations:**
   - Create multiple dependencies at once
   - Import dependencies from GitHub (if importing repos)

### Phase 3: Advanced Workflow

1. **Smart Filtering:**
   - Filter issues by "ready to work" (unblocked)
   - Filter by dependency depth
   - Filter by relationship type

2. **Notifications:**
   - Notify when dependencies are created/removed
   - Notify when blocking issues are resolved

## Proposed Enhancements to the Spec

### 1. Explicit PR Support

Add to the spec:
```jsonc
{
  "kind": 1622,
  "content": "",
  "tags": [
    ["e", "<source-pr-id>", "<relay-url>", "source"],
    ["e", "<target-issue-id>", "<relay-url>", "target"],
    ["reltype", "blocks"],
    ["a", "30617:<repo-owner-pubkey>:<repo-id>", "<relay-url>"],
  ]
}
```

**Note on Multiple Dependents:**
- The proposal uses separate events for each relationship (one kind 1622 event per source-target pair)
- To support "A PR can close multiple dependent issues + PRs" (like GitHub's "Fixes #1, #2, #3"):
  - **Option A (Recommended)**: Create multiple kind 1622 events, one per relationship:
    ```jsonc
    // Event 1: PR resolves Issue #1
    {
      "kind": 1622,
      "tags": [
        ["e", "<pr-id>", "<relay>", "source"],
        ["e", "<issue-1-id>", "<relay>", "target"],
        ["reltype", "resolves"], // New relationship type
        ["a", "30617:...", "<relay>"]
      ]
    }
    // Event 2: PR resolves Issue #2
    {
      "kind": 1622,
      "tags": [
        ["e", "<pr-id>", "<relay>", "source"],
        ["e", "<issue-2-id>", "<relay>", "target"],
        ["reltype", "resolves"],
        ["a", "30617:...", "<relay>"]
      ]
    }
    ```
  - **Option B**: Allow multiple `e` tags with "target" marker in a single event (requires spec change):
    ```jsonc
    {
      "kind": 1622,
      "tags": [
        ["e", "<pr-id>", "<relay>", "source"],
        ["e", "<issue-1-id>", "<relay>", "target"],
        ["e", "<issue-2-id>", "<relay>", "target"],
        ["e", "<issue-3-id>", "<relay>", "target"],
        ["reltype", "resolves"],
        ["a", "30617:...", "<relay>"]
      ]
    }
    ```
- **Recommendation**: Use Option A (multiple events) for consistency with the proposal's design pattern. 
- **Important distinction**: 
  - `reltype: "blocks"` → When blocker closes, dependents are UNBLOCKED (status unchanged, just no longer blocked)
  - `reltype: "resolves"` → When PR merges, targets are CLOSED (status changes to 1632)
  - These are different relationship types with different behaviors. `resolves` explicitly means "this PR closes these issues" (GitHub's "Fixes #1, #2, #3" pattern), while `blocks` means "can't proceed until blocker is done" (workflow dependency).

### 2. Clarified Direction Semantics

Add to spec:
- `blocks`: "Target must close before source can proceed" - When blocker closes, dependents are UNBLOCKED (can proceed) but NOT automatically closed. Their status remains unchanged.
- `parent`: "Source is a child/subtask of target" - Similar to `blocks`, when parent closes, children are unblocked but not closed.
- `related`: "Loose association, no workflow impact" - No automatic status changes.
- `duplicates`: "Source duplicates target (either can be closed independently)" - No automatic status changes.
- `resolves` (NEW): "Source resolves/closes target when source is merged/resolved" (for PR→Issue, PR→PR relationships). **This is different from `blocks`**: When source PR is merged (status 1631), clients SHOULD automatically close target issues/PRs (publish status 1632 for each target). This enables GitHub-style "Fixes #1, #2, #3" functionality where merging a PR explicitly closes the linked issues.

### 3. Repository Context Requirement

Clarify:
- `a` tag is REQUIRED for cross-repo dependencies
- `a` tag is OPTIONAL (but recommended) for same-repo dependencies
- If `a` tag is missing and both issues are in the same repo (determined by querying their `a` tags), assume same-repo

### 4. Status Event Integration

Add guidance:
- Clients SHOULD query dependencies when displaying issue/PR status
- An issue with open `blocks` dependencies SHOULD be visually marked as "blocked" even if status event is "open"
- Status events (kinds 1630-1633) track explicit status; dependencies track implicit blocking

## Compatibility Considerations

### Backward Compatibility

✅ **Fully backward compatible:**
- Existing issues/PRs without dependencies continue to work
- Clients that don't support kind 1622 simply ignore these events
- No changes required to existing NIP-34 events (kinds 1621, 1618, 1619, 1630-1633)

### Relay Configuration

Add to relay allowlist:
```toml
# nostr-rs-relay config.toml
[relay]
allowed_kinds = [..., 1622, ...]
```

```yaml
# strfry config
relay:
  eventKinds:
    allow: [..., 1622, ...]
```

## Testing Strategy

1. **Unit Tests:**
   - Event creation/parsing
   - Relationship direction validation
   - Deletion logic

2. **Integration Tests:**
   - Cross-repo dependencies
   - Status event + dependency interaction
   - Query performance

3. **UI Tests:**
   - Dependency display
   - Blocked status indicators
   - Dependency creation/removal

## Conclusion

The proposed NIP-34 dependencies extension (kind 1622) is **well-designed and should be supported**. It:

✅ Follows NIP-34 patterns consistently  
✅ Provides essential workflow management features  
✅ Is backward compatible  
✅ Enables advanced features (dependency graphs, ready work filtering)  
✅ Fills a gap in our current implementation  

**Recommendation:** Support the proposal with the clarifications and enhancements outlined above. This will significantly improve workflow management capabilities for Nostr-based Git repositories.

## Next Steps

1. **Review and provide feedback** on the GitHub issue: https://github.com/nostrability/nostrability/issues/271
2. **Propose enhancements** (PR support, direction clarification, repository context)
3. **Implement MVP** once spec is finalized
4. **Test with real workflows** to validate the design

## References

- [NIP-34: Git Repository Events](https://nips.nostr.com/34)
- [Proposal Issue: #271](https://github.com/nostrability/nostrability/issues/271)
- Our NIP-34 Implementation: `docs/NIPS_AND_EVENT_KINDS.md`
- Our Events Code: `ui/src/lib/nostr/events.ts`

