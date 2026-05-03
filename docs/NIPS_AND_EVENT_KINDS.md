# NIPs and Event Kinds Used in gittr.space

This document lists all Nostr Improvement Proposals (NIPs) and event kinds used by gittr.space.

## Interop Baseline (ngit/gitworkshop)

To keep event behavior consistent with other major NIP-34 clients (including ngit/gitworkshop), gittr enforces these interoperability rules:

- For kind `1621` (issues), required NIP-34 tags are always present: `a`, `r`, `p`, `subject`.
- For kind `1617` (patches), required NIP-34 tags are always present: `a`, `r`, `p`.
- For kind `1618` (pull requests), required NIP-34 tags are always present: `a`, `r`, `p`, `subject`, `c`, and at least one `clone`.
- Repository references use canonical repo identifiers (`repositoryName` / `d` tag identity), so `a` tags stay consistent across clients.
- NIP-22 comment threading for discussion replies preserves real parent references (`E/K/P` root + `e/k/p` parent), so nested threads render correctly in external clients.
- NIP-51 git follow lists (`kind:10018`) are used for followed repositories (`a` tags to `30617` addresses).
- NIP-32 label overlays (`kind:1985`) are supported for post-creation metadata overlays (labels and subject-style updates).
- Experimental `kind:1624` cover notes are treated as optional/non-blocking (feature-flagged behavior).

## Standard NIPs

### NIP-01: Basic Protocol

- **Purpose**: Core Nostr protocol (events, relays, subscriptions)
- **Usage**: All Nostr communication
- **Event Kinds**: All kinds

### NIP-11: Relay Information Document

- **Purpose**: Relay metadata and capabilities
- **Usage**: `/api/nostr/info` endpoint returns NIP-11 document
- **Features**: Lists supported GRASP versions, event kinds, git server URL

### NIP-19: bech32-encoded entities

- **Purpose**: Human-readable encoding of pubkeys, event IDs, etc.
- **Usage**:
  - `npub1...` for user profiles
  - `note1...` for event IDs
  - `nprofile1...` for profiles with relays

### NIP-25: Reactions

- **Purpose**: Event reactions (likes, stars)
- **Usage**: Repository stars
- **Event Kind**: `7` (KIND_REACTION)

### NIP-33: Parameterized Replaceable Events

- **Purpose**: Replaceable events with parameters
- **Usage**: NIP-34 repository events (kind 30617)
- **Event Kind**: `30617` (KIND_REPOSITORY_NIP34)

### NIP-34: Replaceable Events

- **Purpose**: Replaceable events (can be updated)
- **Usage**: Repository announcements (primary method)
- **Event Kind**: `30617` (KIND_REPOSITORY_NIP34)
- **Tags**: `d` (identifier), `name`, `description`, `clone[]`, `relay[]`, etc.

### NIP-46: Remote Signer (NIP-07)

- **Purpose**: Browser extension-based signing
- **Usage**: User authentication and event signing
- **Support**: NIP-07 extensions (Alby, nos2x, etc.)

### NIP-57: Lightning Zaps

- **Purpose**: Lightning Network payments with zap requests (`9734`) and receipts (`9735`) on relays
- **Usage**: Owner-only **repository** zaps use a real NIP-57 flow when the recipient’s LNURL-pay endpoint sets `allowsNostr` and `nostrPubkey`. **Bounties**, **pay-to-merge**, and other flows that need fast server-side confirmation keep using **LNbits** (or similar) instead of waiting on gossip for receipts.
- **Event Kind**: `9735` (KIND_ZAP) — the **Your Zaps** page merges live `9735` events from the user’s relay set (filters `#p` / `#P` per NIP-57) with the local `gittr_zaps` ledger and drops duplicate **pending** rows when a matching receipt arrives.
- **Repo header “Zaps” badge**: subscribes to `9735` with `#p` = repo owner, sums receipts whose embedded zap request matches this repo’s `Zap for entity/repo` text, merges with the local `gittr_zaps` ledger for the same repo (dedupes when a receipt matches a local paid row), so the number reflects the **network** where your relay set delivers receipts, not this browser alone.

### NIP-51: Lists

- **Purpose**: Standard user list events (NIP-51 “standard lists”)
- **Usage**: **Watch** on a repo (with NIP-07): publishes your followed-Git-repositories list so other clients can read it from relays.
- **Event Kind**: `10018` (KIND_GIT_REPOSITORIES_LIST) — _Git repositories list_ (not kind `3000` bookmark lists).
- **Tags**:
  - `a[]` only: each value is a **repository address** `30617:<64-hex-owner-pubkey>:<repositoryName>` (same shape as elsewhere in NIP-34 interop). There is no per-repo “patch” event: **each publish carries the full current set** of `a` tags; relays treat the latest `10018` from your pubkey as the replaceable list. That is spec behavior, not data loss — you are **replacing the list document** with old entries **plus** adds/removes computed in the client.
- **gittr UI behavior** (`ui/src/app/[entity]/[repo]/layout-client.tsx`): reads `gittr_watched_repos` from `localStorage`, computes `nextWatched` (either `[...watched, repoId]` or `watched` minus this repo), maps each watched `entity/repo` to a `30617:…` address using `gittr_repos` cache where possible, then publishes **one** signed `10018` whose `a` tags are that full set (current repo is always included on follow via `repoAddress` when hex owner is known). **Caveat:** if a watched repo’s owner cannot be resolved to hex from the local repo cache, that row may be omitted from the **published** list while still remaining in `gittr_watched_repos` until cache improves.
- **Star vs Watch**: **Star** in gittr is primarily **local** (`gittr_starred_repos`, Stars page). **Watch** drives the `10018` list when NIP-07 publish runs. Optional NIP-25 stars on relays live in `ui/src/lib/nostr/repo-stars.ts` and are not the same control as the Stars button unless wired later.
- **Parsing helpers**: `createGitRepositoriesListEvent` / `parseGitRepositoriesListEvent` in `ui/src/lib/nostr/events.ts`.

### NIP-32: Labeling

- **Purpose**: Post-hoc labeling and metadata overlays
- **Usage**: Overlay labels and subject-like metadata updates for issue/PR workflows
- **Event Kind**: `1985` (KIND_LABEL_OVERLAY)
- **Tags**:
  - `a`/`e`: Target event reference
  - `L`: Label namespace
  - `l[]`: Label values within namespace

### NIP-96: Blossom (File Storage)

- **Purpose**: Large file storage for Nostr events
- **Usage**: Git pack files, large binaries
- **Endpoint**: `/nip96/` API

### NIP-C0: Code Snippets

- **Purpose**: Share code snippets on Nostr
- **Usage**: Code snippet sharing from repositories
- **Event Kind**: `1337` (KIND_CODE_SNIPPET)
- **Tags**:
  - `l`: Language (lowercase, e.g., "javascript")
  - `extension`: File extension (without dot, e.g., "js")
  - `name`: Filename
  - `description`: Description
  - `runtime`: Runtime environment (e.g., "node v18.15.0")
  - `license[]`: License(s) (SPDX identifiers, can be multiple)
  - `dep[]`: Dependencies (can be multiple)
  - `repo`: Repository reference (URL or NIP-34 format: "30617:<pubkey>:<d tag>")
- **Content**: The actual code (string)

## Custom Event Kinds

### Kind 50: Repository Permissions

- **Purpose**: Git repository access control
- **Usage**: Managing read/write permissions for repositories
- **Tags**: `repo` (owner pubkey, repo name), `p` (target pubkey), permission level

### Kind 51: Repository Announcements (Legacy)

- **Purpose**: Repository metadata and announcements
- **Usage**: Legacy format, read-only support for backwards compatibility
- **Replaced by**: Kind 30617 (NIP-34)

### Kind 52: SSH Keys

- **Purpose**: Git authentication via SSH
- **Usage**: Storing SSH public keys for Git operations
- **Content**: SSH public key in format: `<key-type> <base64-key> <title>`

### Kind 1337: Code Snippets (NIP-C0)

- **Purpose**: Share code snippets
- **Usage**: Standalone code sharing, discoverable across Nostr network
- **See**: NIP-C0 section above

### Kind 30617: Repository Metadata (NIP-34)

- **Purpose**: Repository announcements (primary method)
- **Usage**: Repository metadata, discovery, announcements
- **Tags**:
  - `d`: Repository identifier (required)
  - `name`: Human-readable project name
  - `description`: Repository description
  - `clone[]`: Git server URLs
  - `relay[]`: Nostr relay URLs
  - `t[]`: Topics/tags
  - `p[]`: Contributors (with weights)
  - `maintainers[]`: Maintainer pubkeys (used for access control)
  - `r`: Source URL (e.g., GitHub)
  - `image`: Logo URL
  - `web[]`: Web links
  - `default_branch`: Default branch name
  - `branch[]`: Branch names and commits
  - `release[]`: Release tags and metadata
  - `link[]`: Repository links (docs, social media, etc.)
  - `push_cost_sats` (optional, **gittr / git-nostr-bridge extension**): Integer sats charged per push when the bridge enforces a paywall. **Not** part of the core NIP-34 text; we reuse kind **30617** so the amount is owner-attested on the same replaceable repo announcement other clients already follow. The bridge copies this tag into `RepositoryPushPolicy` for `/api/nostr/repo/push` and SSH enforcement; purely local UI state alone cannot secure server-side push.
- **Privacy**: Privacy is NOT encoded in NIP-34 event tags (per spec). The NIP-34 spec does not include `public-read` or `public-write` tags. Privacy is determined by the `maintainers[]` tag (which IS in the spec) and bridge-level access control. Repository events are public on relays (for discoverability), but file access is restricted to maintainers via the bridge.

### Kind 30618: Repository State (NIP-34)

- **Purpose**: Repository state announcements (required for ngit clients)
- **Usage**: Tracks branches, tags, and commit SHAs for repository state
- **Tags**:
  - `d`: Repository identifier (matches kind 30617)
  - `refs/heads/<branch>`: Branch name and latest commit SHA
  - `refs/tags/<tag>`: Tag name and commit SHA
  - `HEAD`: Default branch reference (e.g., "ref: refs/heads/main")
- **Content**: Empty (state is in tags)
- **Required for**: Full NIP-34 compliance and recognition by ngit clients (e.g., gitworkshop.dev)

### Kind 1621: Issues (NIP-34)

- **Purpose**: Issue tracking
- **Usage**: Repository issues with bounties
- **Tags**:
  - `a`: Repository reference (`30617:<owner-pubkey>:<repo-id>`) - REQUIRED
  - `r`: Earliest unique commit ID - REQUIRED
  - `p`: Repository owner - REQUIRED
  - `subject`: Issue title - REQUIRED
  - `t[]`: Labels (optional)
  - `p[]`: Assignees (optional, custom extension)
- **Content**: Markdown description text (not JSON)
- **Interop requirement**: If local cache is missing `r`, derive it from git root commit history (earliest unique commit) before publishing.

### Kind 1618: Pull Requests (NIP-34)

- **Purpose**: Code review and merging
- **Usage**: Pull request workflow
- **Tags**:
  - `a`: Repository reference (`30617:<owner-pubkey>:<repo-id>`) - REQUIRED
  - `r`: Earliest unique commit ID - REQUIRED
  - `p`: Repository owner - REQUIRED
  - `subject`: PR title - REQUIRED
  - `c`: Current commit ID (tip of PR branch) - REQUIRED
  - `clone[]`: Git clone URLs - REQUIRED (at least one)
  - `branch-name`: Branch name (optional)
  - `merge-base`: Most recent common ancestor (optional)
  - `t[]`: Labels (optional)
- **Content**: Markdown description text (not JSON)
- **Interop requirement**: If local cache is missing `r`, derive it from git root commit history (earliest unique commit) before publishing.

### Kind 1619: Pull Request Updates (NIP-34)

- **Purpose**: Update PR when new commits are pushed
- **Usage**: Published when PR branch is updated with new commits
- **Tags**:
  - `a`: Repository reference (`30617:<owner-pubkey>:<repo-id>`) - REQUIRED
  - `r`: Earliest unique commit ID - REQUIRED
  - `p`: Repository owner - REQUIRED
  - `E`: PR event ID (NIP-22) - REQUIRED
  - `P`: PR author (NIP-22) - REQUIRED
  - `c`: Updated commit ID (tip of PR branch) - REQUIRED
  - `clone[]`: Git clone URLs - REQUIRED
  - `merge-base`: Most recent common ancestor (optional)
- **Content**: Empty (all data in tags)

### Kind 1624: Cover Notes (Experimental)

- **Purpose**: Optional "cover note"/summary primitive used by some ngit ecosystem workflows
- **Usage**: Feature-flagged only; never required for core PR/issue interoperability
- **Status**: Experimental/non-canonical

### Kinds 1630-1633: Status Events (NIP-34)

- **Purpose**: Track status of issues, PRs, and patches
- **Usage**: Separate events for status changes (not tags in main event)
- **Tags**:
  - `e`: Root event ID (issue/PR/patch) with marker "root" - REQUIRED
  - `p`: Repository owner - REQUIRED
  - `p`: Root event author - REQUIRED
  - `a`: Repository reference (optional, for filter efficiency)
  - `r`: Earliest unique commit (optional, for filter efficiency)
  - For kind 1631 (Applied/Merged): `e` (accepted revision), `q[]` (applied patch IDs), `merge-commit`, `applied-as-commits[]`
- **Content**: Optional markdown text
- **Kinds**:
  - **1630**: Open
  - **1631**: Applied/Merged (for PRs/patches) or Resolved (for issues)
  - **1632**: Closed
  - **1633**: Draft

### Kind 10317: User GRASP List (NIP-34)

- **Purpose**: List of GRASP servers the user generally wishes to use for NIP-34 related activity
- **Usage**: Similar in function to NIP-65 relay list and NIP-B7 blossom list
- **Tags**:
  - `g[]`: GRASP service websocket URLs (wss://) in order of preference - zero or more
- **Content**: Empty per NIP-34 spec

### Kind 10018: Git Repositories List (NIP-51)

- **Purpose**: User follow list of NIP-34 repositories
- **Usage**: Repo layout **Watch** / **Unwatch** (with NIP-07) publishes this list so follows are visible on the network; also synced when reading the user’s list from relays. (Related: NIP-51 **kind 10017** is _Git authors_ follow lists — different from repos.)
- **Replaceable semantics (not “spam every click”)**: Under [NIP-51](https://github.com/nostr-protocol/nips/blob/master/51.md), standard lists like `10018` are **normal replaceable events** — you publish **one event whose tags are the whole current list** each time it changes. There is no Nostr message that means “add only this `a` tag”; relays/clients keep **one** logical list per user (newer `created_at` wins). That is intentional, not a missing incremental API.
- **Tags**:
  - `a[]`: Repository addresses (`30617:<owner-pubkey>:<repo-id>`)
- **Content**: Empty

### Kind 1985: Label Overlay (NIP-32)

- **Purpose**: Attach labels and mutable metadata overlays to existing events
- **Usage**: Post-creation labels and subject-style overlays for issues/PRs
- **Tags**:
  - `a` and/or `e`: Target references
  - `L`: Namespace
  - `l[]`: Label values
- **Content**: Empty

### Kind 30023: Long-form Content (NIP-23) — Repository discussion topics

- **Purpose**: Long-form text (articles, blog posts). Used by gittr for **repo discussion board topics** so any NIP-23 client can read them.
- **Usage**: One event per discussion topic; replies use NIP-22 kind 1111 (per NIP-23).
- **Tags**:
  - `d`: Replaceable identifier (required)
  - `title`: Topic title
  - `summary`: Short summary (optional)
  - `published_at`: Unix timestamp (string)
  - `t`: Topic/category (NIP-23 hashtag)
  - `repo`: Repository scope — `entity/repo` (e.g. `npub.../my-repo`) for filtering
  - `status`: `open` or `closed` (gittr extension)
  - `category`: Category label (gittr extension)
- **Content**: Markdown body (discussion description)

### Kind 9806: Bounties

- **Purpose**: Lightning bounties for issues
- **Usage**: Issue bounties with LNURL-withdraw
- **Tags**: `repo`, `e` (issue ID), `amount`, `status`, `withdraw_id`, `lnurl`, `invoice`, `p[]` (creator, claimer)

### Kind 1111: Comments (NIP-22)

- **Purpose**: Comments on issues, PRs, patches, and **discussion topics** (NIP-23 kind 30023)
- **Usage**: Issue/PR comments; discussion replies (root event = 30023, K=30023)
- **Tags**:
  - `E`: Root event ID - REQUIRED (uppercase E per NIP-22)
  - `K`: Root event kind - REQUIRED (e.g. 1621 issue, 1618 PR, 30023 discussion)
  - `P`: Root event author pubkey - REQUIRED when available
  - `e`: Parent event ID - REQUIRED (lowercase for parent scope)
  - `k`: Parent event kind - REQUIRED
  - `p`: Parent event author pubkey - REQUIRED when available
  - `repo`: Repository context (custom extension, not in NIP-22)

## Relay Configuration

For relays to support gittr.space, they must allow these event kinds:

```toml
# nostr-rs-relay config.toml
[relay]
allowed_kinds = [0, 1, 7, 50, 51, 52, 1337, 1111, 1617, 1618, 1619, 1621, 1624, 1630, 1631, 1632, 1633, 1985, 10018, 10317, 30023, 30617, 30618, 9735, 9806]
```

```yaml
# strfry config
relay:
  eventKinds:
    allow:
      [
        0,
        1,
        7,
        50,
        51,
        52,
        1337,
        1111,
        1617,
        1618,
        1619,
        1621,
        1624,
        1630,
        1631,
        1632,
        1633,
        1985,
        10018,
        10317,
        30617,
        30618,
        9735,
        9806,
      ]
```

## Summary Table

| Kind  | NIP          | Name                   | Purpose                                       |
| ----- | ------------ | ---------------------- | --------------------------------------------- |
| 0     | NIP-01       | Metadata               | User profiles                                 |
| 1     | NIP-01       | Notes                  | Legacy comments (backward compatibility only) |
| 7     | NIP-25       | Reactions              | Stars, likes                                  |
| 50    | Custom       | Repository Permissions | Git access control                            |
| 51    | Custom       | Repository (Legacy)    | Repository announcements (read-only)          |
| 52    | Custom       | SSH Keys               | Git authentication                            |
| 1111  | NIP-22       | Comments               | Issue/PR/patch/discussion comments            |
| 30023 | NIP-23       | Long-form              | Repo discussion topics (replies = 1111)       |
| 1337  | NIP-C0       | Code Snippets          | Code snippet sharing                          |
| 1617  | NIP-34       | Patches                | Patch-based code contributions                |
| 1618  | NIP-34       | Pull Requests          | Pull request announcements                    |
| 1619  | NIP-34       | PR Updates             | PR branch updates (new commits)               |
| 1621  | NIP-34       | Issues                 | Issue tracking                                |
| 1624  | Experimental | Cover Notes            | Optional cover notes for PR/issue summaries   |
| 1630  | NIP-34       | Status: Open           | Issue/PR opened                               |
| 1631  | NIP-34       | Status: Applied/Merged | PR merged or issue resolved                   |
| 1632  | NIP-34       | Status: Closed         | Issue/PR closed                               |
| 1633  | NIP-34       | Status: Draft          | Issue/PR/patch set to draft                   |
| 1985  | NIP-32       | Label Overlay          | Post-hoc labels and metadata overlays         |
| 10018 | NIP-51       | Git Repositories List  | Followed repositories list                    |
| 10317 | NIP-34       | User GRASP List        | Preferred GRASP servers for NIP-34 activity   |
| 30617 | NIP-34       | Repository Metadata    | Repository announcements (primary)            |
| 30618 | NIP-34       | Repository State       | Repository state (required for ngit clients)  |
| 9735  | NIP-57       | Zaps                   | Lightning payments                            |
| 9806  | Custom       | Bounties               | Issue bounties                                |

## References

- [Nostr NIPs Repository](https://github.com/nostr-protocol/nips)
- [NIP-C0 Specification](https://github.com/nostr-protocol/nips/blob/master/C0.md)
- [NIP-34 Specification](https://github.com/nostr-protocol/nips/blob/master/34.md)
- [GRASP Protocol](https://github.com/gitnostr/grasp)
