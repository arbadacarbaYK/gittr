# [gittr.space](http://gittr.space)

Git hosting and forge UI on [Nostr](https://github.com/nostr-protocol/nips): NIP-34 repos on GRASP relays, issues/PRs as signed events, optional Lightning bounties, static **Pages**, and an **apps** directory.

Live: [gittr.space](https://gittr.space) · [Apps](https://gittr.space/apps) · [Pages](https://pages.gittr.space)

Import from GitHub, GitLab, Codeberg, or your own git remote when you want a Nostr mirror or a path off a centralized host—not a skin on top of another forge’s login.

## Use it for

- **Mirror / backup** — Push or import a repo. Files live on git-nostr-bridge (and/or upstream); metadata on relays.
- **Issues & PRs on Nostr** — Same workflow as a normal forge. Events are NIP-34 and related kinds
- **Pages** — Publish static sites from a repo 
- **Apps** — List/install NIP-82 apps
- **Bounties** — Fund or solve issues; zaps via LNbits / NWC / LNURL.

Sitemap/SEO: dynamic from relays — [docs/SEO.md](docs/SEO.md).

## Nostr git clients

Listed under **Clients** in [aljazceru/awesome-nostr](https://github.com/aljazceru/awesome-nostr) (NIP-34 / git collaboration), plus [NostrGit](https://github.com/NostrGit/NostrGit) as a related web stack (gittr’s template ancestry; not in that awesome list).

**Legend:** **Yes** / **No** = we believe this is true from the project’s own docs or, for gittr, from this repo and [gittr.space](https://gittr.space). **?** = not verified by us—check the project. **—** = not applicable (e.g. web-only row for a CLI).

| | [gittr](https://gittr.space) | [gitworkshop](https://gitworkshop.dev) | [ngit](https://ngit.dev) | [gitplaza](https://gitplaza.netlify.app) | [gitstr](https://github.com/fiatjaf/gitstr) |
| --- | --- | --- | --- | --- | --- |
| **Form** | Web forge + self-host bridge | Web forge | CLI + `git-remote-nostr` | Desktop app (Linux primary) | CLI (deprecated → [nak](https://github.com/fiatjaf/nak)) |
| **Public live site** | Yes | Yes | — | Demo / app only | — |
| **NIP-34** repos & state (30617 / 30618) | Yes | Yes | Yes | Yes | Patches only |
| **GRASP** multi-mirror discovery | Yes | Yes (core) | Yes | ? | ? |
| **Browse code in UI** | Yes | Yes (sparse explorer, no full clone) | — | Yes | — |
| **Issues** | Yes | Yes | — (use a web client) | Yes | — |
| **Pull requests** | Yes | Yes | Via `pr/` branches + CLI | ? (patch-focused UI) | — |
| **Merge PRs in UI** | Yes | ? | — | ? | — |
| **Import GitHub / GitLab / Codeberg** | Yes | ? | No | ? | No |
| **`git clone` / `git push` on host domain** | Yes (SSH + HTTPS) | Uses announced git URLs | `nostr://` remotes | ? | — |
| **SSH keys on Nostr (kind 52)** | Yes | ? | ? | ? | — |
| **Lightning issue bounties** | Yes | ? | — | ? | — |
| **Repo zaps (NIP-57)** | Yes | ? | — | ? | — |
| **Push paywall (`push_cost_sats`)** | Yes | ? | — | — | — |
| **Static sites (gittr Pages)** | Yes | ? | — | — | — |
| **NIP-82 apps directory** | Yes ([/apps](https://gittr.space/apps)) | ? | — | — | — |
| **Telegram / Nostr notifications** | Yes | ? | — | — | — |
| **Projects (Kanban)** | Yes | ? | — | — | — |
| **PWA install** | Yes | ? | ? | — | — |
| **NIP-46 remote signer** | Yes | ? | — | ? | — |

**Notes**

- **gitworkshop** — [README](https://github.com/DanConwayDev/gitworkshop): GRASP-focused web client; pairs with **ngit**. Contributions via Nostr only (no GitHub PRs).
- **ngit** — [README](https://github.com/DanConwayDev/ngit-cli): `ngit init`, `nostr://` clone, `pr/` branches, `ngit send`; discovery/browsing via gitworkshop or similar.
- **gitplaza** — [README](https://codeberg.org/dluvian/gitplaza): desktop NIP-34 client; recommends gitworkshop/ngit for fuller forge workflows.
- **gitstr** — [README](https://github.com/fiatjaf/gitstr): deprecated; send/receive patches over Nostr only.
- **NostrGit** — Open-source web + `git-nostr-bridge`; public deployments and feature completeness vary ([roadmap in repo](https://github.com/NostrGit/NostrGit) may be stale). Use **?** unless you verify on their instance.

Corrections welcome via issue or PR.

## Features include

Repos: create, import (incl. bulk), fork, browse/edit files, blame, diffs, releases, tags. Collaboration: issues (bounties), PRs, projects, discussions, notifications (Nostr/Telegram). Payments: repo zaps, issue bounties, optional `push_cost_sats` paywall on GUI + SSH push. Dev UX: fuzzy finder, code search, permalinks, HTTPS/SSH clone, SSH keys in Settings → SSH Keys, themes, PWA. Discovery: explore, profiles, stars, sponsors.

Details and edge cases: [docs/](docs/) (especially [FILE_FETCHING_INSIGHTS.md](docs/FILE_FETCHING_INSIGHTS.md), [NIPS_AND_EVENT_KINDS.md](docs/NIPS_AND_EVENT_KINDS.md)).

## Stack


| Layer      | Tech                                                                                   |
| ---------- | -------------------------------------------------------------------------------------- |
| UI         | Next.js 13 (App Router), React, TypeScript, Tailwind                                   |
| Nostr      | `nostr-relaypool`, `nostr-tools`                                                       |
| Git server | `git-nostr-bridge`, `git-nostr-ssh`, `git-nostr-cli` in `[ui/gitnostr/](ui/gitnostr/)` |
| Blobs      | NIP-96 Blossom (packs / Pages uploads)                                                 |
| Payments   | LNbits, NWC, LNURL                                                                     |


## Files & storage 

- **Big files** sit on git servers (bridge, GitHub, GitLab, …); Nostr events hold `clone` / `source` URLs and small embedded bits (e.g. README).
- **Browser** keeps keys, settings, and repo metadata in `localStorage` (encrypted where applicable). The hosted API processes payments and git proxies; it does not store your Nostr/Lightning secrets.
- **Fetch order**: embedded → bridge (`/api/nostr/repo/files`, clone if empty) → upstream git APIs. Full flow: [docs/FILE_FETCHING_INSIGHTS.md](docs/FILE_FETCHING_INSIGHTS.md).

Deploy: hosted ([SETUP_INSTRUCTIONS.md](docs/SETUP_INSTRUCTIONS.md)) or local UI + `NEXT_PUBLIC_API_URL` ([LOCAL_SETUP.md](docs/LOCAL_SETUP.md), [DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md)).

**Import limit:** API responses cap ~4 MB; huge trees (binaries, release assets) may fail import—trim or import a smaller slice.

## Docs

- [SETUP_INSTRUCTIONS.md](docs/SETUP_INSTRUCTIONS.md) — production
- [LOCAL_SETUP.md](docs/LOCAL_SETUP.md) — dev
- [DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md) — ops reference (checklist, relays, maintenance)
- [SSH_GIT_GUIDE.md](docs/SSH_GIT_GUIDE.md) — `git clone` / `git push` over SSH
- [GRASP_RELAY_SETUP.md](docs/GRASP_RELAY_SETUP.md) — own relay

## Roadmap

- better Branch/tag UI, PR conflicts, commit graph, search ranking
- Shortcuts overlay, line permalinks, CI surface, VS Code links
- MCP integration, security hardening

## License

- App: **AGPL-3.0** — full text in `[ui/LICENSE](ui/LICENSE)` (root copy may be added for GitHub detection).
- `ui/gitnostr/`: **MIT** — `[ui/gitnostr/LICENSE.md](ui/gitnostr/LICENSE.md)`.

## Lineage


| Project                                            | Role                                                                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [NostrGit](https://github.com/NostrGit/NostrGit)   | UI template ancestry                                                                                                                              |
| [gitnostr](https://github.com/spearson78/gitnostr) | Upstream bridge; gittr ships `[arbadacarbaYK/gitnostr](https://github.com/arbadacarbaYK/gitnostr)` / `ui/gitnostr/` (paywall, NIP-34 state, etc.) |
| **gittr**                                          | This repo — product, not a thin fork of either                                                                                                    |


Also: [nostr-relaypool](https://github.com/adamritter/nostr-relaypool), [GRASP](https://ngit.dev/grasp/). Stack diagram: [docs/gittr-platform-enhancements.png](docs/gittr-platform-enhancements.png) · bridge notes: [ui/gitnostr/README.md](ui/gitnostr/README.md).

NIPs/kinds: [docs/NIPS_AND_EVENT_KINDS.md](docs/NIPS_AND_EVENT_KINDS.md). Interop: NIP-34 `a` tags, NIP-51 repo lists (`10018`), NIP-32 labels (`1985`) for ngit and other Nostr git clients-style clients.

## Support

Telegram: [https://t.me/gittrspace](https://t.me/gittrspace)

Nostr: npub1nur7st367ys7cqtjyv74alu84y209zsw8wagpxvrl3g9q2veqzuqjqh65s