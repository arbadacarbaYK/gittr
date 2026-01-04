# NIPs and Event Kinds Used in gittr.space

This document lists all Nostr Improvement Proposals (NIPs) and event kinds used by gittr.space.

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
- **Purpose**: Lightning Network payments
- **Usage**: Repository zaps, contributor tips, bounties
- **Event Kind**: `9735` (KIND_ZAP)

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

### Kind 9806: Bounties
- **Purpose**: Lightning bounties for issues
- **Usage**: Issue bounties with LNURL-withdraw
- **Tags**: `repo`, `e` (issue ID), `amount`, `status`, `withdraw_id`, `lnurl`, `invoice`, `p[]` (creator, claimer)

### Kind 1111: Comments (NIP-22)
- **Purpose**: Comments on issues, PRs, discussions
- **Usage**: Issue/PR comments, discussion replies
- **Tags**: 
  - `E`: Event ID (root or reply) - REQUIRED (uppercase E per NIP-22)
  - `P`: Pubkey (author of root event or reply target) - optional
  - `repo`: Repository context (custom extension, not in NIP-22)
- **Note**: Migrated from kind 1 (NIP-01) to kind 1111 (NIP-22) for proper threading support. Legacy kind 1 comments are still supported for backward compatibility.

## Relay Configuration

For relays to support gittr.space, they must allow these event kinds:

```toml
# nostr-rs-relay config.toml
[relay]
allowed_kinds = [0, 1, 7, 50, 51, 52, 1337, 1111, 1617, 1618, 1619, 1621, 1630, 1631, 1632, 1633, 10317, 30617, 30618, 9735, 9806]
```

```yaml
# strfry config
relay:
  eventKinds:
    allow: [0, 1, 7, 50, 51, 52, 1337, 1111, 1617, 1618, 1619, 1621, 1630, 1631, 1632, 1633, 10317, 30617, 30618, 9735, 9806]
```

## Summary Table

| Kind | NIP | Name | Purpose |
|------|-----|------|---------|
| 0 | NIP-01 | Metadata | User profiles |
| 1 | NIP-01 | Notes | Legacy comments (backward compatibility only) |
| 7 | NIP-25 | Reactions | Stars, likes |
| 50 | Custom | Repository Permissions | Git access control |
| 51 | Custom | Repository (Legacy) | Repository announcements (read-only) |
| 52 | Custom | SSH Keys | Git authentication |
| 1111 | NIP-22 | Comments | Issue/PR/patch comments (primary) |
| 1337 | NIP-C0 | Code Snippets | Code snippet sharing |
| 1617 | NIP-34 | Patches | Patch-based code contributions |
| 1618 | NIP-34 | Pull Requests | Pull request announcements |
| 1619 | NIP-34 | PR Updates | PR branch updates (new commits) |
| 1621 | NIP-34 | Issues | Issue tracking |
| 1630 | NIP-34 | Status: Open | Issue/PR opened |
| 1631 | NIP-34 | Status: Applied/Merged | PR merged or issue resolved |
| 1632 | NIP-34 | Status: Closed | Issue/PR closed |
| 1633 | NIP-34 | Status: Draft | Issue/PR/patch set to draft |
| 10317 | NIP-34 | User GRASP List | Preferred GRASP servers for NIP-34 activity |
| 30617 | NIP-34 | Repository Metadata | Repository announcements (primary) |
| 30618 | NIP-34 | Repository State | Repository state (required for ngit clients) |
| 9735 | NIP-57 | Zaps | Lightning payments |
| 9806 | Custom | Bounties | Issue bounties |

## References

- [Nostr NIPs Repository](https://github.com/nostr-protocol/nips)
- [NIP-C0 Specification](https://github.com/nostr-protocol/nips/blob/master/C0.md)
- [NIP-34 Specification](https://github.com/nostr-protocol/nips/blob/master/34.md)
- [GRASP Protocol](https://github.com/gitnostr/grasp)

