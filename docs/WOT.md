# Web of Trust (WoT) on gittr

gittr shows a **viewer-relative** trust badge next to Nostr identities when you are logged in:

| Badge | Meaning |
|--------|---------|
| **In your network** | 1 hop (you follow them, or extension/oracle agrees) |
| **N hops from you** | Connected through the follow graph within max hops |
| **Outside your network** | Oracle reported no path within its search limit; not proof of no relationship |
| **Distance unknown** | Provider unavailable, or extension returned no distance (including incomplete snapshots or mute exclusions) — **not** the same as Outside |
| **Followers see: In their network** | Your own profile — preview of how people who follow you see you |
| *(hidden)* | Logged out |

### False “Outside” (fixed Aug 2026)

If the public oracle returns **502**, older code treated that like “no path” and showed **Outside your network** for everyone you don’t follow directly. Multi-hop friends looked “outside” even when you were connected.

**Distance unknown** is expected when the public oracle (`wot-oracle.mappingbitcoin.com`) returns 502 and the profile is not in your kind-3 list. Direct follows still show **In your network** without the oracle — so a failed Follow click (Amber gated as “not ready”) also leaves the badge unknown until kind 3 is published.

### `/apps` TrustBadge stampede (fixed Aug 2026)

Logged-in `/apps` used to mount a TrustBadge on every card (~hundreds). Without throttling that fan-out hit `/api/wot/distance` once per card whenever the public oracle was 502, flooding the browser console and our proxy. The directory now paints 48 cards first (Load more), which also keeps the Home button from waiting ~8s on a starved soft navigation.

Load more is **not** enough on its own: search can show one card while a live NIP-82 scrape still flushes the full catalog. After the server snapshot lands, `/apps` skips that live 4000/12000 subscribe. While Zapstore is still paging (50 events per REQ), the hub refetches every 8s; afterwards every 150s. Leaving the hub pauses catalog `setState` so owner-name and chrome clicks are not ignored.

Client `wot.ts` now: (1) coalesces in-flight requests for the same `(from,to,max_hops)`, (2) caps concurrent oracle HTTP to 2, (3) opens a **60s circuit** after the first oracle failure so remaining badges return **Distance unknown** without more HTTP. Independent of NIP-46 / Amber bunker sockets.

## Public follow counts (profile legitimacy)

On every public profile (`/{npub}`), gittr shows **Following** and **Followers** in the stats row (visible logged out):

| Stat | Source |
|------|--------|
| **Following** | That profile’s NIP-02 kind **3** contact list (`p` tags, union across relays). If relays have no kind 3, gittr uses Primal’s HTTP `contact_list` cache (`GET /api/nostr/contact-list`) so profiles that only exist in that index (e.g. 16 follows, 0 on websocket) still show a count. |
| **Followers** | Distinct authors of kind **3** events that tag this pubkey (`#p`), using each author’s **newest** list so unfollows drop off |

Follower totals are **relay-dependent lower bounds**, not a global census — still useful for WoT-style legitimacy next to repos. Tooltips explain this. The logged-in **TrustBadge** (hops from *you*) remains separate.

Chrome **Apps / Home / Explore** from a profile must not wait for those counts: kind-3 follower events (up to 400) plus the live 30617 catalog used to `setState` on every event and starve `router.push`. Leaving a profile now **pauses** that work (same `gittr:pause-heavy-catalog` event as `/apps`) and hard-falls back in ~1.2s if `/apps` still has not committed. Counts may stay `…` after you leave — that is intended.

Code: `ui/src/lib/nostr/useProfileFollowCounts.ts`, helpers in `contact-list.ts`.

## Data sources (priority)

1. **Your kind-3 follow list** — direct follows (`hops: 1` → **In your network**). Uses the same local backup/session as the Follow button, plus a multi-event relay fetch (`limit: 20`, tags + JSON content). A successful Follow immediately refreshes the badge (no oracle wait).
2. **[nostr-wot browser extension](https://nostr-wot.com/download)** — `window.nostr.wot.getDistance(target)` when enabled and authorized for the site. The active extension identity must match your Gittr login; it is checked before and after the query. A successful `null` is shown as unknown without bypassing extension mute policy through the oracle.
3. **[WoT Oracle](https://nostr-wot.com/docs/oracle)** (optional) — proxied via `GET /api/wot/distance`

### Extension setup and oracle availability

The optional integration uses the [Nostr WoT extension](https://github.com/nostr-wot/nostr-wot-extension) browser API and the [WoT Oracle](https://github.com/nostr-wot/nostr-wot-oracle).

In Nostr WoT 0.8.0, enable the experimental Web of Trust option, grant Gittr identity/public-key access, and sync the graph when using local mode. Installation alone does not expose `window.nostr.wot`. The API takes a target hex key or npub and returns a hop count or `null`; permission and availability failures reject. Gittr falls back to the oracle if the extension is absent, rejects, or uses a different identity. Direct follows still take priority, so these badges are relationship distances, not the extension's mute-aware trust scores.

The public `wot-oracle.mappingbitcoin.com` endpoint is optional. Outages must remain unknown results, not evidence that someone is outside a network. Operators can configure their own instance below. Historical outages and GitHub star counts do not establish current availability or adoption.

`window.nostr.wot` is an experimental API, not a finalized NIP. See the [browser API proposal](https://github.com/nostr-wot/nostr-wot-extension/blob/main/nips/wot/01-browser-wot-api.md), [scoring and data semantics](https://github.com/nostr-wot/nostr-wot-extension/blob/main/nips/wot/02-scoring-and-data.md), and [NIPs discussion #2236](https://github.com/nostr-protocol/nips/issues/2236).

**gittr does not depend on the oracle** for core UX: if you Follow someone, the badge must show **In your network** from your kind-3 / local list even when the oracle is down. Multi-hop (“2 hops from you”) still needs a working oracle or extension local graph.

Future: self-hosted oracle on gittr infra, NIP-85 kind `10040`, optional third-party providers — kept separate from gittr-native signals (merges, bounties).

## Where badges appear (Phase 1)

- Profile header `/{npub}`
- Repo page owner name
- Issue detail author
- `/apps` publisher row
- `/pages` author row
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
