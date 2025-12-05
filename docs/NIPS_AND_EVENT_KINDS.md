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
  - `maintainers[]`: Maintainer pubkeys
  - `r`: Source URL (e.g., GitHub)
  - `image`: Logo URL
  - `web[]`: Web links
  - `default_branch`: Default branch name
  - `branch[]`: Branch names and commits
  - `release[]`: Release tags and metadata
  - `link[]`: Repository links (docs, social media, etc.)

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

### Kind 9803: Issues
- **Purpose**: Issue tracking
- **Usage**: Repository issues with bounties
- **Tags**: `repo` (owner pubkey, repo name), `t[]` (labels), `p[]` (assignees), `e` (related events)

### Kind 9804: Pull Requests
- **Purpose**: Code review and merging
- **Usage**: Pull request workflow
- **Tags**: `repo` (owner pubkey, repo name), `from_branch`, `to_branch`, `commit[]`, `t[]` (labels), `p[]` (assignees)

### Kind 9806: Bounties
- **Purpose**: Lightning bounties for issues
- **Usage**: Issue bounties with LNURL-withdraw
- **Tags**: `repo`, `e` (issue ID), `amount`, `status`, `withdraw_id`, `lnurl`, `invoice`, `p[]` (creator, claimer)

### Kind 9807: Comments
- **Purpose**: Comments on issues, PRs, discussions
- **Usage**: Issue/PR comments, discussion replies
- **Tags**: `repo`, `e` (reply-to event ID), `issueId`, `prId`

## Relay Configuration

For relays to support gittr.space, they must allow these event kinds:

```toml
# nostr-rs-relay config.toml
[relay]
allowed_kinds = [0, 1, 7, 50, 51, 52, 1337, 30617, 30618, 9735, 9803, 9804, 9806, 9807]
```

```yaml
# strfry config
relay:
  eventKinds:
    allow: [0, 1, 7, 50, 51, 52, 1337, 30617, 30618, 9735, 9803, 9804, 9806, 9807]
```

## Summary Table

| Kind | NIP | Name | Purpose |
|------|-----|------|---------|
| 0 | NIP-01 | Metadata | User profiles |
| 1 | NIP-01 | Notes | Comments, discussions |
| 7 | NIP-25 | Reactions | Stars, likes |
| 50 | Custom | Repository Permissions | Git access control |
| 51 | Custom | Repository (Legacy) | Repository announcements (read-only) |
| 52 | Custom | SSH Keys | Git authentication |
| 1337 | NIP-C0 | Code Snippets | Code snippet sharing |
| 30617 | NIP-34 | Repository Metadata | Repository announcements (primary) |
| 30618 | NIP-34 | Repository State | Repository state (required for ngit clients) |
| 9735 | NIP-57 | Zaps | Lightning payments |
| 9803 | Custom | Issues | Issue tracking |
| 9804 | Custom | Pull Requests | Code reviews |
| 9806 | Custom | Bounties | Issue bounties |
| 9807 | Custom | Comments | Issue/PR comments |

## References

- [Nostr NIPs Repository](https://github.com/nostr-protocol/nips)
- [NIP-C0 Specification](https://github.com/nostr-protocol/nips/blob/master/C0.md)
- [NIP-34 Specification](https://github.com/nostr-protocol/nips/blob/master/34.md)
- [GRASP Protocol](https://github.com/gitnostr/grasp)

