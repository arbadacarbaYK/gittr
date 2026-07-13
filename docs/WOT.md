# Web of Trust (WoT) on gittr

gittr shows a **viewer-relative** trust badge next to Nostr identities when you are logged in:

| Badge | Meaning |
|--------|---------|
| **In your network** | 1 hop (you follow them, or extension/oracle agrees) |
| **N hops from you** | Connected through the follow graph within max hops |
| **Outside your network** | No path found within the search limit |
| **Followers see: In their network** | Your own profile — preview of how people who follow you see you |
| *(hidden)* | Logged out |

## Data sources (priority)

1. **[nostr-wot browser extension](https://nostr-wot.com/download)** — `window.nostr.wot.getDistance()` when installed
2. **Your kind-3 follow list** — direct follows only (relay subscription)
3. **[WoT Oracle](https://nostr-wot.com/docs/oracle)** — proxied via `GET /api/wot/distance` (default public server)

Future: NIP-85 kind `10040`, optional third-party providers (e.g. MaximumSats), kept separate from gittr-native signals (merges, bounties).

## Where badges appear (Phase 1)

- Profile header `/{npub}`
- Repo page owner name
- Issue detail author
- `/apps` publisher row
- `/bounty-hunt` issue author

Not on explore/home repo cards (too noisy).

## Server config

Optional in `ui/.env.local`:

```bash
WOT_ORACLE_URL=https://wot-oracle.mappingbitcoin.com
```

Self-host: [nostr-wot-oracle](https://github.com/nostr-wot/nostr-wot-oracle).

## Code

- `ui/src/lib/nostr/wot.ts` — distance resolution
- `ui/src/lib/nostr/useWoTDistance.ts` — React hook
- `ui/src/components/ui/trust-badge.tsx` — UI
- `ui/src/pages/api/wot/distance.ts` — oracle proxy

Tracked in [gittr#26](https://github.com/arbadacarbaYK/gittr/issues/26).
