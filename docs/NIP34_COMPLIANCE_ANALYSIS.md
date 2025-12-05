# NIP-34 Compliance Analysis for Issues and Pull Requests

## Current Implementation vs NIP-34 Spec

### Issues

**Current Implementation:**
- Event Kind: `9803` (custom)
- Tags: `["repo", entity, repo]`, `["status", "open"]`, `["label", ...]`, `["p", ...]`
- Content: JSON stringified object with `{title, description, status, ...}`

**NIP-34 Spec (Kind 1621):**
- Event Kind: `1621` ✅ **NEEDS CHANGE**
- Required Tags:
  - `["a", "30617:<base-repo-owner-pubkey>:<base-repo-id>"]` ❌ **MISSING**
  - `["r", "<earliest-unique-commit-id-of-repo>"]` ❌ **MISSING**
  - `["p", "<repository-owner>"]` ✅ Present (but as `["repo", ...]`)
  - `["subject", "<issue-subject>"]` ❌ **MISSING** (should be separate tag, not in JSON)
- Optional Tags:
  - `["t", "<issue-label>"]` ✅ Present (but as `["label", ...]`)
- Content: Markdown text (not JSON) ❌ **NEEDS CHANGE**

### Pull Requests

**Current Implementation:**
- Event Kind: `9804` (custom)
- Tags: `["repo", entity, repo]`, `["branch", baseBranch, headBranch]`, `["status", "open"]`
- Content: JSON stringified object with `{title, description, status, changedFiles}`

**NIP-34 Spec (Kind 1618):**
- Event Kind: `1618` ✅ **NEEDS CHANGE**
- Required Tags:
  - `["a", "30617:<base-repo-owner-pubkey>:<base-repo-id>"]` ❌ **MISSING**
  - `["r", "<earliest-unique-commit-id-of-repo>"]` ❌ **MISSING**
  - `["p", "<repository-owner>"]` ✅ Present (but as `["repo", ...]`)
  - `["subject", "<PR-subject>"]` ❌ **MISSING** (should be separate tag, not in JSON)
  - `["c", "<current-commit-id>"]` ❌ **MISSING** (tip of PR branch)
  - `["clone", "<clone-url>", ...]` ❌ **MISSING** (at least one git clone URL where commit can be downloaded)
- Optional Tags:
  - `["t", "<PR-label>"]` ✅ Present (but as `["label", ...]`)
  - `["branch-name", "<branch-name>"]` ❌ **MISSING** (recommended branch name)
  - `["e", "<root-patch-event-id>"]` ✅ Present (but as `["e", ..., "linked"]`)
  - `["merge-base", "<commit-id>"]` ❌ **MISSING** (most recent common ancestor with target branch)
- Content: Markdown text (not JSON) ❌ **NEEDS CHANGE**

### Status Events

**Current Implementation:**
- Status stored in issue/PR event itself as `["status", "open"]` tag or in JSON content
- No separate status events

**NIP-34 Spec (Kinds 1630-1633):**
- Status should be separate events, not tags in the issue/PR:
  - `1630`: Open
  - `1631`: Applied/Merged (for Patches/PRs) or Resolved (for Issues)
  - `1632`: Closed
  - `1633`: Draft
- Required Tags:
  - `["e", "<issue-or-PR-or-original-root-patch-id-hex>", "", "root"]` ❌ **MISSING**
  - `["p", "<repository-owner>"]` ❌ **MISSING**
  - `["p", "<root-event-author>"]` ❌ **MISSING**
  - `["p", "<revision-author>"]` (optional, for revisions) ❌ **MISSING**
- Optional Tags:
  - `["a", "30617:<base-repo-owner-pubkey>:<base-repo-id>", "<relay-url>"]` ❌ **MISSING**
  - `["r", "<earliest-unique-commit-id-of-repo>"]` ❌ **MISSING**
  - For `1631` (Applied/Merged):
    - `["q", "<applied-or-merged-patch-event-id>", "<relay-url>", "<pubkey>"]` ❌ **MISSING**
    - `["merge-commit", "<merge-commit-id>"]` ❌ **MISSING**
    - `["r", "<merge-commit-id>"]` ❌ **MISSING**
    - `["applied-as-commits", "<commit-id-in-master-branch>", ...]` ❌ **MISSING**
- Content: Markdown text ❌ **MISSING**

### Pull Request Updates

**Current Implementation:**
- No PR update events

**NIP-34 Spec (Kind 1619):**
- Event Kind: `1619` ❌ **MISSING**
- Required Tags:
  - `["a", "30617:<base-repo-owner-pubkey>:<base-repo-id>"]` ❌ **MISSING**
  - `["r", "<earliest-unique-commit-id-of-repo>"]` ❌ **MISSING**
  - `["p", "<repository-owner>"]` ❌ **MISSING**
  - NIP-22 tags:
    - `["E", "<pull-request-event-id>"]` ❌ **MISSING**
    - `["P", "<pull-request-author>"]` ❌ **MISSING**
  - `["c", "<current-commit-id>"]` ❌ **MISSING** (updated tip of PR)
  - `["clone", "<clone-url>", ...]` ❌ **MISSING**
- Optional Tags:
  - `["merge-base", "<commit-id>"]` ❌ **MISSING**
- Content: Empty string ❌ **MISSING**

## Summary of Required Changes

### Critical Changes (Breaking):
1. **Change event kinds**: `9803` → `1621` (Issues), `9804` → `1618` (PRs)
2. **Add `a` tag**: `["a", "30617:<owner-pubkey>:<repo-id>"]` to all issues/PRs
3. **Add `r` tag**: `["r", "<earliest-unique-commit-id>"]` to all issues/PRs
4. **Change content format**: JSON → Markdown text
5. **Add `subject` tag**: Extract title from JSON to `["subject", "..."]` tag
6. **Change `repo` tag**: `["repo", entity, repo]` → `["p", "<repository-owner>"]`
7. **Change `label` tag**: `["label", ...]` → `["t", ...]`
8. **Implement status events**: Separate events (kinds 1630-1633) instead of status tags
9. **Add PR-specific tags**: `["c", "<commit-id>"]`, `["clone", "<url>"]`, `["branch-name", "..."]`
10. **Implement PR updates**: Kind 1619 for PR tip changes

### Migration Strategy:
1. Support both old (9803/9804) and new (1621/1618) kinds during transition
2. Migrate existing events by republishing with correct format
3. Update all clients to read new event kinds
4. Deprecate old event kinds after migration period

