# NIP-25 Stars & NIP-51 Following Implementation

This document explains how to implement repository starring and following using **NIP-25** (Reactions) and **NIP-51** (Lists) in a Nostr-based Git hosting platform.

## Overview

Following the [Nostr community discussion](https://github.com/nostr-protocol/nips/pull/880), we use:

- **NIP-25 (Kind 7)** for repository stars (reactions to Kind 30617 repository events), when enabled.
- **NIP-51 (Kind 10018)** for **followed Git repositories** (standard list: full `a` tag set per publish), used by **Watch** with NIP-07 in the web UI.

**Key Benefits:**

- Platform-wide visibility (everyone sees who starred what)
- No server storage needed (each user publishes their own events)
- Decentralized aggregation (clients query and count reactions)
- Standard NIPs (no custom event kinds needed)

## Dependencies

This implementation uses standard Nostr libraries:

- `nostr-tools` - For event creation, signing, and hashing
- No additional dependencies required for starring/following functionality

## Event Kinds Used

- **Kind 7** (NIP-25: Reactions) — star reactions to repositories (optional / `repo-stars.ts`)
- **Kind 10018** (NIP-51: Git repositories list) — followed/watched repos (`a` tags only)
- **Kind 30617** (NIP-34) — repository announcements (reaction targets and `a` address format)

## NIP-25 Star Reactions

### Event Structure

When a user stars a repository, publish a **Kind 7** event:

```typescript
{
  kind: 7, // NIP-25: Reaction
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ["e", repoEventId],      // Reference to the repository event (Kind 30617)
    ["k", "30617"],          // Indicates this is a reaction to a Kind 30617 event
    ["p", repoOwnerPubkey],  // Repository owner's pubkey
  ],
  content: "+",  // Star reaction (NIP-25 standard: "+" for like/star)
  pubkey: userPubkey,
  // ... id, sig
}
```

### Publishing a Star

```typescript
// ui/src/lib/nostr/repo-stars.ts
import { KIND_REACTION } from "./events";

export async function publishStarReaction(
  repoEventId: string,
  repoOwnerPubkey: string,
  publish: (event: Event) => Promise<void>,
  getSigner: () => Promise<{ signEvent: (event: any) => Promise<any> }>
): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    const signer = await getSigner();

    // Create unsigned event
    const unsignedEvent = {
      kind: KIND_REACTION, // 7
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["e", repoEventId],
        ["k", "30617"],
        ["p", repoOwnerPubkey],
      ],
      content: "+", // Star reaction
      pubkey: "", // Will be set by signer
    };

    // Sign the event
    const signedEvent = await signer.signEvent(unsignedEvent);

    // Publish to relays
    await publish(signedEvent);

    return {
      success: true,
      eventId: signedEvent.id,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || "Failed to publish star reaction",
    };
  }
}
```

### Removing a Star (Unstar)

Publish a negative reaction:

```typescript
export async function removeStarReaction(
  repoEventId: string,
  repoOwnerPubkey: string,
  publish: (event: Event) => Promise<void>,
  getSigner: () => Promise<{ signEvent: (event: any) => Promise<any> }>
): Promise<{ success: boolean; error?: string }> {
  try {
    const signer = await getSigner();

    // Create negative reaction (NIP-25: "-" means remove reaction)
    const unsignedEvent = {
      kind: KIND_REACTION, // 7
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["e", repoEventId],
        ["k", "30617"],
        ["p", repoOwnerPubkey],
      ],
      content: "-", // Negative reaction (unstar)
      pubkey: "", // Will be set by signer
    };

    const signedEvent = await signer.signEvent(unsignedEvent);
    await publish(signedEvent);

    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || "Failed to remove star reaction",
    };
  }
}
```

### Querying Star Counts

Implementation: `ui/src/lib/nostr/repo-stars.ts`.

- **`aggregateRepoStarReactions(events)`** — per pubkey, the **latest** kind `7` wins; `+` / `⭐` count as starred, `-` removes that user’s star.
- **`queryRepoStars(subscribe, relays, repoEventId, opts?)`** — one-shot query using **`subscribe(filters, relays, onEvent, maxDelayms?, onEose?, options?)`** (same as `NostrContext` / `nostr-relaypool`), not a two-argument subscribe.
- **Repo header** uses a live subscription: `#e` = current `30617` event id, `#k` = `30617`.

When the repo is re-published, the `30617` event id may change; reactions on an **old** id will not appear until aggregation supports `a`-tag matching (possible follow-up).

### UI integration (gittr repo header)

Concepts in the repo header:

1. **Star** — NIP-25 kind `7` on the current repo 30617 event (`publishStarReaction` / `removeStarReaction`). The **Stars** page lists your kind `7` reactions with `#k` `30617` from relays (matched to `gittr_repos` by event id). `gittr_starred_repos` is updated in the background when you star/unstar so the list stays usable offline and before relays echo.
2. **GitHub / Import** — live GitHub stargazer **count** when `sourceUrl` is GitHub; otherwise an **Import** snapshot from stored `repo.stars` if present. This is display-only, not “your GitHub stars” OAuth.
3. **Watch** — NIP-51 kind `10018` followed repos; separate from Star.

## NIP-51: Followed repositories (kind 10018)

### Event structure (as implemented in gittr)

Publish a **kind `10018`** event whose tags are **only** `["a", "<address>"]` entries. Each address is a **NIP-34-style repository coordinate**:

`30617:<64-hex-owner-pubkey>:<repositoryName>`

```typescript
{
  kind: 10018,
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ["a", "30617:<hex64>:<repoId>"],
    ["a", "30617:<hex64>:<otherRepoId>"],
    // ... full current list — one event replaces the previous logical list
  ],
  content: "",
  pubkey: userPubkey,
}
```

There is **no** Nostr-level “append this one `a`” message for this list type: the client **merges in memory** (previous watched repos ± the repo you toggled), then publishes **one** new `10018` that contains **all** `a` tags. Relays keep the latest; that is **not** deleting your history on purpose — it is how replaceable standard lists work.

### Server-side helpers

Use **`createGitRepositoriesListEvent`** and **`parseGitRepositoriesListEvent`** in `ui/src/lib/nostr/events.ts` (they validate `30617:<hex>:…` shapes).

### Querying a user’s followed-repo list

Subscribe with `authors: [<user pubkey>]` and `kinds: [10018]`, then read **`a`** tags from the newest matching event (same as the repo layout client when syncing watch state).

## Implementation Notes

### Why NIP-25 for Stars?

- **Standard NIP**: No custom event kinds needed
- **Platform-wide**: Anyone can query and see who starred what
- **Decentralized**: Each user publishes their own reactions
- **Simple aggregation**: Clients count positive reactions

### Why NIP-51 kind 10018 for following / watch?

- **Standard NIP-51** “git repositories” list kind
- **Replaceable list**: latest `10018` from the user is the source of truth; payload is the **full** set of `a` tags
- **One publish per UI toggle** (not one permanent event per repo forever)

### Handling Negative Reactions

NIP-25 allows negative reactions (`content: "-"`). When aggregating:

- Count only positive reactions (`content: "+"` or `"⭐"`)
- Ignore negative reactions (they cancel out the positive)
- Or: Track both and calculate net count

### Relay Configuration

Ensure your relays allow:

- **Kind 7** (Reactions) — for stars (if used)
- **Kind 10018** — followed Git repositories list (Watch)
- **Kind 30617** / **30618** — repository announcements and state

Example relay config (nostr-rs-relay):

```toml
[relay]
allowed_kinds = [0, 1, 7, 50, 51, 52, 10018, 30617, 30618, 9735, 9803, 9804]
```

## References

- **NIP-25**: https://nips.nostr.com/25 (Reactions)
- **NIP-51**: https://nips.nostr.com/51 (Lists)
- **NIP-34**: https://nips.nostr.com/34 (Replaceable Events)
- **Discussion**: https://github.com/nostr-protocol/nips/pull/880

## Example Implementation

See our full implementation:

- **Star reactions**: `ui/src/lib/nostr/repo-stars.ts`
- **Kind 10018 helpers**: `ui/src/lib/nostr/events.ts` (`createGitRepositoriesListEvent`, `parseGitRepositoriesListEvent`)
- **Watch publish + list sync**: `ui/src/app/[entity]/[repo]/layout-client.tsx` (`handleWatch`)
- **Star (local) + counts**: same file (`handleStar`)
