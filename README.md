# gittr.space

Git hosting and forge UI on [Nostr](https://github.com/nostr-protocol/nips): NIP-34 repos on GRASP relays, issues/PRs as signed events, optional Lightning bounties, static **Pages**, and an **apps** directory.

Live: [gittr.space](https://gittr.space) · [Apps](https://gittr.space/apps) · [Pages](https://pages.gittr.space)

Import from GitHub, GitLab, Codeberg, or your own git remote when you want a Nostr mirror or a path off a centralized host—not a skin on top of another forge’s login.

## Use it for

- **Mirror / backup** — Push or import a repo; files live on git-nostr-bridge (and/or upstream); metadata on relays.
- **Issues & PRs on Nostr** — Same workflow as a normal forge; events are NIP-34 (and related kinds).
- **Pages** — Publish static sites from a repo (`/pages` in the app).
- **Apps** — List/install NIP-82 software (`/apps`).
- **Bounties** — Fund issues; zaps via LNbits / NWC / LNURL.

Sitemap/SEO: dynamic from relays — [docs/SEO.md](docs/SEO.md).

## Features (summary)

Repos: create, import (incl. bulk), fork, browse/edit files, blame, diffs, releases, tags. Collaboration: issues (bounties), PRs, projects, discussions, notifications (Nostr/Telegram). Payments: repo zaps, issue bounties, optional `push_cost_sats` paywall on GUI + SSH push. Dev UX: fuzzy finder, code search, permalinks, HTTPS/SSH clone, SSH keys in Settings → SSH Keys, themes, PWA. Discovery: explore, profiles, stars, sponsors.

Details and edge cases: [docs/](docs/) (especially [FILE_FETCHING_INSIGHTS.md](docs/FILE_FETCHING_INSIGHTS.md), [NIPS_AND_EVENT_KINDS.md](docs/NIPS_AND_EVENT_KINDS.md)).

## Stack

| Layer | Tech |
|-------|------|
| UI | Next.js 13 (App Router), React, TypeScript, Tailwind |
| Nostr | `nostr-relaypool`, `nostr-tools` |
| Git server | `git-nostr-bridge`, `git-nostr-ssh`, `git-nostr-cli` in [`ui/gitnostr/`](ui/gitnostr/) |
| Blobs | NIP-96 Blossom (packs / Pages uploads) |
| Payments | LNbits, NWC, LNURL |

## Files & storage (short)

- **Big files** sit on git servers (bridge, GitHub, GitLab, …); Nostr events hold `clone` / `source` URLs and small embedded bits (e.g. README).
- **Browser** keeps keys, settings, and repo metadata in `localStorage` (encrypted where applicable). The hosted API processes payments and git proxies; it does not store your Nostr/Lightning secrets.
- **Fetch order**: embedded → bridge (`/api/nostr/repo/files`, clone if empty) → upstream git APIs. Full flow: [docs/FILE_FETCHING_INSIGHTS.md](docs/FILE_FETCHING_INSIGHTS.md).

Deploy: hosted ([SETUP_INSTRUCTIONS.md](docs/SETUP_INSTRUCTIONS.md)) or local UI + `NEXT_PUBLIC_API_URL` ([LOCAL_SETUP.md](docs/LOCAL_SETUP.md), [DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md)).

**Import limit:** API responses cap ~4 MB; huge trees (binaries, release assets) may fail import—trim or import a smaller slice.

## Docs

Index: [docs/README.md](docs/README.md). Install: [SETUP_INSTRUCTIONS.md](docs/SETUP_INSTRUCTIONS.md) · dev: [LOCAL_SETUP.md](docs/LOCAL_SETUP.md) · ops: [DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md).

## Roadmap

- Branch/tag UI, PR conflicts, commit graph, search ranking
- Shortcuts overlay, line permalinks, CI surface, VS Code links
- MCP integration, security hardening

## Contributing

Fork → branch → PR. Active development; tests appreciated.

## License

- App: **AGPL-3.0** — full text in [`ui/LICENSE`](ui/LICENSE) (root copy may be added for GitHub detection).
- `ui/gitnostr/`: **MIT** — [`ui/gitnostr/LICENSE.md`](ui/gitnostr/LICENSE.md).

## Lineage

| Project | Role |
|--------|------|
| [NostrGit](https://github.com/NostrGit/NostrGit) | UI template ancestry |
| [gitnostr](https://github.com/spearson78/gitnostr) | Upstream bridge; gittr ships [`arbadacarbaYK/gitnostr`](https://github.com/arbadacarbaYK/gitnostr) / `ui/gitnostr/` (paywall, NIP-34 state, etc.) |
| **gittr** | This repo — product, not a thin fork of either |

Also: [nostr-relaypool](https://github.com/adamritter/nostr-relaypool), [GRASP](https://ngit.dev/grasp/). Stack diagram: [docs/gittr-platform-enhancements.png](docs/gittr-platform-enhancements.png) · bridge notes: [ui/gitnostr/README.md](ui/gitnostr/README.md).

NIPs/kinds: [docs/NIPS_AND_EVENT_KINDS.md](docs/NIPS_AND_EVENT_KINDS.md). Interop: NIP-34 `a` tags, NIP-51 repo lists (`10018`), NIP-32 labels (`1985`) for ngit and other Nostr git clients-style clients.

## Support

Telegram: https://t.me/gittrspace
