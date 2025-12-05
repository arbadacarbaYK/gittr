# NIP-25 Stars & NIP-51 Following Implementation

This document explains how to implement repository starring and following using **NIP-25** (Reactions) and **NIP-51** (Lists) in a Nostr-based Git hosting platform.

## Overview

Following the [Nostr community discussion](https://github.com/nostr-protocol/nips/pull/880), we use:
- **NIP-25 (Kind 7)** for repository stars (reactions to Kind 30617 repository events)
- **NIP-51 (Kind 3000/3001)** for following/watching repositories (bookmark lists)

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

- **Kind 7** (NIP-25: Reactions) - Star reactions to repositories
- **Kind 3000** (NIP-51: Bookmark Lists) - Following/watching repositories
- **Kind 30617** (NIP-34: Replaceable Events) - Repository announcements (what we're reacting to)

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
        "#e": [repoEventId],     // Reactions to this repo event
        "#k": ["30617"],         // Reactions to Kind 30617 events
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

## NIP-51 Following Lists

### Event Structure

When a user follows a repository, publish a **Kind 3000** (Bookmark List) event:

```typescript
{
  kind: 3000, // NIP-51: Bookmark List
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ["d", "followed-repos"], // List identifier
    ["r", "30617:<relay>:<repo-event-id>"], // Full reference (preferred)
    // OR
    ["r", ":<ownerPubkey>:<slug>"], // Minimal reference (fallback)
  ],
  content: "", // Empty content for lists
  pubkey: userPubkey,
  // ... id, sig
}
```

### Repository Reference Format

Two formats are supported:

1. **Full reference** (preferred): `30617:<relay>:<repo-event-id>`
   - Example: `30617:wss://relay.noderunners.network:abc123...`
   - Most reliable, includes relay and event ID

2. **Minimal reference** (fallback): `:<ownerPubkey>:<slug>`
   - Example: `:9f07e82e3af121ec0172233d5eff87a914f28a0e3bba809983fc5050299900b8:my-repo`
   - Used when event ID is not available

### Publishing a Follow List

```typescript
// ui/src/lib/nostr/events.ts

export const KIND_BOOKMARK_LIST = 3000; // NIP-51

export function createRepoFollowListEvent(
  listIdentifier: string, // e.g., "followed-repos" or "watched-repos"
  repoReferences: Array<{
    eventId?: string;
    relay?: string;
    ownerPubkey?: string;
    slug?: string;
  }>,
  privateKey: string
): any {
  const pubkey = getPublicKey(privateKey);
  
  const tags: string[][] = [
    ["d", listIdentifier], // List identifier (NIP-51)
  ];
  
  // Add repository references
  for (const ref of repoReferences) {
    if (ref.eventId && ref.relay) {
      // Full reference: 30617:<relay>:<repo-event-id>
      tags.push(["r", `30617:${ref.relay}:${ref.eventId}`]);
    } else if (ref.ownerPubkey && ref.slug) {
      // Minimal reference: :<ownerPubkey>:<slug>
      tags.push(["r", `:${ref.ownerPubkey}:${ref.slug}`]);
    }
  }
  
  const event = {
    kind: KIND_BOOKMARK_LIST,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "", // Empty content for lists
    pubkey,
    id: "",
    sig: "",
  };

  event.id = getEventHash(event);
  event.sig = signEvent(event, privateKey);
  return event;
}
```

### Querying Follow Lists

Query a user's follow list:

```typescript
export async function queryUserFollowList(
  subscribe: (filters: Filter[], onEvent: (event: Event) => void) => () => void,
  userPubkey: string,
  listIdentifier: string = "followed-repos"
): Promise<string[]> {
  return new Promise((resolve) => {
    const repoRefs: string[] = [];
    
    const filters: Filter[] = [
      {
        kinds: [KIND_BOOKMARK_LIST], // 3000
        authors: [userPubkey],
        "#d": [listIdentifier],
      },
    ];
    
    const unsubscribe = subscribe(filters, (event: Event) => {
      // Extract "r" tags (repository references)
      const rTags = event.tags.filter(tag => tag[0] === "r");
      for (const tag of rTags) {
        repoRefs.push(tag[1]);
      }
    });
    
    setTimeout(() => {
      unsubscribe();
      resolve(repoRefs);
    }, 2000);
  });
}
```

## Implementation Notes

### Why NIP-25 for Stars?

- **Standard NIP**: No custom event kinds needed
- **Platform-wide**: Anyone can query and see who starred what
- **Decentralized**: Each user publishes their own reactions
- **Simple aggregation**: Clients count positive reactions

### Why NIP-51 for Following?

- **Standard NIP**: Uses existing list infrastructure
- **Replaceable**: Latest list event replaces previous (NIP-51 replaceable)
- **Flexible**: Can include multiple repos in one list
- **Efficient**: Single event per user, not one per repo

### Handling Negative Reactions

NIP-25 allows negative reactions (`content: "-"`). When aggregating:
- Count only positive reactions (`content: "+"` or `"⭐"`)
- Ignore negative reactions (they cancel out the positive)
- Or: Track both and calculate net count

### Relay Configuration

Ensure your relays allow:
- **Kind 7** (Reactions) - for stars
- **Kind 3000** (Bookmark Lists) - for following
- **Kind 30617** (Replaceable Events) - for repository announcements

Example relay config (nostr-rs-relay):
```toml
[relay]
allowed_kinds = [0, 1, 7, 50, 51, 52, 3000, 30617, 30618, 9735, 9803, 9804]
```

## References

- **NIP-25**: https://nips.nostr.com/25 (Reactions)
- **NIP-51**: https://nips.nostr.com/51 (Lists)
- **NIP-34**: https://nips.nostr.com/34 (Replaceable Events)
- **Discussion**: https://github.com/nostr-protocol/nips/pull/880

## Example Implementation

See our full implementation:
- **Star reactions**: `ui/src/lib/nostr/repo-stars.ts`
- **Event creation**: `ui/src/lib/nostr/events.ts` (createStarReactionEvent, createRepoFollowListEvent)
- **UI integration**: `ui/src/app/[entity]/[repo]/layout.tsx` (handleStar)

