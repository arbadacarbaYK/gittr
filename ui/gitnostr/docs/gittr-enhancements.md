# gittr.space Bridge Enhancements

**Browse on gittr:** [arbadacarbaYK/gitnostr](https://gittr.space/arbadacarbaYK/gitnostr?branch=main) — also built from [gittr `ui/gitnostr/`](https://gittr.space/arbadacarbaYK/gittr?file=ui/gitnostr/README.md&branch=main).  
This document describes production bridge features gittr relies on.

![Diagram of enhancements](./gittr-enhancements.png)

> **Badge legend:** 🆕 marks bridge features used on gittr production.

## Feature summary

| Area | What changed | Why it matters |
| ---- | ------------ | -------------- |
| 🆕 HTTP API endpoint (`/api/event`) | Optional listener that accepts POSTed NIP-34 events and injects them into the bridge without waiting for relay propagation. Configured via `BRIDGE_HTTP_PORT` (defaults to `8080`, can be unset to disable). | Lets the UI confirm a push immediately and avoids 1–5s propagation lag while still staying compatible with relays. |
| 🆕 Direct event channel | New `directEvents` queue for HTTP submissions, merged with relay events via `mergedEvents` channel. | Events published via HTTP and relays are coalesced before processing, so nothing is lost or processed twice. |
| 🆕 Deduplication + "seen" cache | Shared map guarded by mutex ensures that events submitted via HTTP do not retrigger after the relay broadcasts them. | Prevents duplicate repo creation or key updates when events arrive through multiple paths. |
| 🆕 Watch-all mode | If `gitRepoOwners` is empty in the config, the bridge now monitors **all** repos instead of doing nothing. | Enables decentralized hosting: a public bridge can mirror every repo that hits the relays. |
| 🆕 Structured logging | Unified log prefixes (`[Bridge]`, `[Bridge API]`, emojis) make it obvious which subsystem emitted a line. | Helps operators debug mixed HTTP/relay flows quickly. |

### Configuration knobs

- **`BRIDGE_HTTP_PORT` env** – Leave it unset to disable the HTTP listener entirely (pure relay mode,
  identical to relay-only mode). Set it when you want to POST events directly (defaults to `8080`, but any
  port works and you can reverse-proxy it for auth/TLS).
- **`gitRepoOwners` array** – Non-empty = only listed pubkeys. **Empty** = watch-all (mirror every repo on your relays).
- **Clone/source URLs** – No gittr-specific values are hard-coded. The bridge simply tries whatever
  clone/source tags the event provides (GitHub, GitLab, Codeberg, GRASP, etc.); HTTPS URLs are
  preferred, and git@/git:// schemes get normalized automatically.

See [`docs/STANDALONE_BRIDGE_SETUP.md`](docs/STANDALONE_BRIDGE_SETUP.md) for a full
configuration reference for standalone bridge hosts.

