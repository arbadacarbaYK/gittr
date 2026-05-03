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

Aggregate star counts by querying all Kind 7 reactions for a repository:

```typescript
export async function queryRepoStars(
  subscribe: (filters: Filter[], onEvent: (event: Event) => void) => () => void,
  repoEventId: string
): Promise<{ count: number; starers: string[] }> {
  return new Promise((resolve) => {
    const starers = new Set<string>();

    const filters: Filter[] = [
      {
        kinds: [KIND_REACTION], // 7
        "#e": [repoEventId], // Reactions to this repo event
        "#k": ["30617"], // Reactions to Kind 30617 events
      },
    ];

    const unsubscribe = subscribe(filters, (event: Event) => {
      // Only count positive reactions (stars)
      if (event.content === "+" || event.content === "⭐") {
        starers.add(event.pubkey);
      }
      // Negative reactions ("-") are ignored (they cancel out)
    });

    // Wait for events to come in, then resolve
    setTimeout(() => {
      unsubscribe();
      resolve({
        count: starers.size,
        starers: Array.from(starers),
      });
    }, 2000); // 2 second timeout
  });
}
```

### UI Integration

```typescript
// ui/src/app/[entity]/[repo]/layout.tsx

const handleStar = useCallback(async () => {
  if (!pubkey) return;

  const repoEventId = repo?.nostrEventId || repo?.lastNostrEventId;
  const repoOwnerPubkey = ownerPubkey || repo?.ownerPubkey;

  if (isStarred) {
    // Unstar: publish negative reaction
    await removeStarReaction(repoEventId, repoOwnerPubkey, publish, getSigner);
    setIsStarred(false);
  } else {
    // Star: publish positive reaction
    await publishStarReaction(repoEventId, repoOwnerPubkey, publish, getSigner);
    setIsStarred(true);
  }

  // Query aggregated star count
  if (repoEventId) {
    const { count } = await queryRepoStars(subscribe, repoEventId);
    setStarCount(count);
  }
}, [isStarred, pubkey, repo, ownerPubkey, publish, subscribe]);

// Query star count when repo loads
useEffect(() => {
  if (!repo) return;
  const repoEventId = repo?.nostrEventId || repo?.lastNostrEventId;
  if (!repoEventId) return;

  queryRepoStars(subscribe, repoEventId).then(({ count }) => {
    setStarCount(count);
  });
}, [repo, subscribe]);
```

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
