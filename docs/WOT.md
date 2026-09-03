# Web of Trust (WoT) on gittr

gittr shows a **viewer-relative** trust badge next to Nostr identities when you are logged in:

| Badge | Meaning |
|--------|---------|
| **In your network** | 1 hop (you follow them, or extension/oracle agrees) |
| **N hops from you** | Connected through the follow graph within max hops |
| **Outside your network** | Oracle/extension confirmed: no path within the search limit |
| **Distance unknown** | Oracle/extension unreachable (e.g. 502) and not in your follow list — **not** the same as Outside |
| **Followers see: In their network** | Your own profile — preview of how people who follow you see you |
| *(hidden)* | Logged out |

### False “Outside” (fixed Aug 2026)

If the public oracle returns **502**, older code treated that like “no path” and showed **Outside your network** for everyone you don’t follow directly. Multi-hop friends looked “outside” even when you were connected.

**Distance unknown** is expected when the public oracle (`wot-oracle.mappingbitcoin.com`) returns 502 and the profile is not in your kind-3 list. Direct follows still show **In your network** without the oracle — so a failed Follow click (Amber gated as “not ready”) also leaves the badge unknown until kind 3 is published.

### `/apps` TrustBadge stampede (fixed Aug 2026)

Logged-in `/apps` used to mount a TrustBadge on every card (~hundreds). Without throttling that fan-out hit `/api/wot/distance` once per card whenever the public oracle was 502, flooding the browser console and our proxy. The directory now paints 48 cards first (Load more), which also keeps the Home button from waiting ~8s on a starved soft navigation.

Client `wot.ts` now: (1) coalesces in-flight requests for the same `(from,to)`, (2) caps concurrent oracle HTTP to 2, (3) opens a **60s circuit** after the first oracle failure so remaining badges return **Distance unknown** without more HTTP. Independent of NIP-46 / Amber bunker sockets.

## Public follow counts (profile legitimacy)

On every public profile (`/{npub}`), gittr shows **Following** and **Followers** in the stats row (visible logged out):

| Stat | Source |
|------|--------|
| **Following** | That profile’s NIP-02 kind **3** contact list (`p` tags, union across relays). If relays have no kind 3, gittr uses Primal’s HTTP `contact_list` cache (`GET /api/nostr/contact-list`) so profiles that only exist in that index (e.g. 16 follows, 0 on websocket) still show a count. |
| **Followers** | Distinct authors of kind **3** events that tag this pubkey (`#p`), using each author’s **newest** list so unfollows drop off |

Follower totals are **relay-dependent lower bounds**, not a global census — still useful for WoT-style legitimacy next to repos. Tooltips explain this. The logged-in **TrustBadge** (hops from *you*) remains separate.

Code: `ui/src/lib/nostr/useProfileFollowCounts.ts`, helpers in `contact-list.ts`.

## Data sources (priority)

1. **Your kind-3 follow list** — direct follows (`hops: 1` → **In your network**). Uses the same local backup/session as the Follow button, plus a multi-event relay fetch (`limit: 20`, tags + JSON content). A successful Follow immediately refreshes the badge (no oracle wait).
2. **[nostr-wot browser extension](https://nostr-wot.com/download)** — `window.nostr.wot.getDistance()` when installed
3. **[WoT Oracle](https://nostr-wot.com/docs/oracle)** (optional) — proxied via `GET /api/wot/distance`

### Oracle reality check (2026-07)

The public instance `wot-oracle.mappingbitcoin.com` is **documented** as the primary dev server (Mapping Bitcoin / Joel Acosta), not a guaranteed SLA service. Docs say *“for production use, consider self-hosting.”* As of July 2026 it often returns **502** (Cloudflare → dead origin). GitHub traction is tiny (~6–7 stars); the only listed production integrator is Mapping Bitcoin. NIP-07 WoT (`window.nostr.wot`) is still an **open NIPs issue ([#2236](https://github.com/nostr-protocol/nips/issues/2236))**, not a finalized NIP.

**gittr does not depend on the oracle** for core UX: if you Follow someone, the badge must show **In your network** from your kind-3 / local list even when the oracle is down. Multi-hop (“2 hops from you”) still needs a working oracle or extension local graph.

Future: self-hosted oracle on gittr infra, NIP-85 kind `10040`, optional third-party providers — kept separate from gittr-native signals (merges, bounties).

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

Tracked previously in [gittr#26](https://github.com/arbadacarbaYK/gittr/issues/26) (**closed** — WoT shipped). Optional **L402** payment rail: [gittr#34](https://github.com/arbadacarbaYK/gittr/issues/34).
