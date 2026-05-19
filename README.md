# [gittr.space](http://gittr.space)

Git hosting and forge UI on [Nostr](https://github.com/nostr-protocol/nips): NIP-34 repos on GRASP relays, issues/PRs as signed events, optional Lightning bounties, static **Pages**, and an **apps** directory.

Live: [gittr.space](https://gittr.space) · [Apps](https://gittr.space/apps) · [Pages](https://pages.gittr.space)

Import from GitHub, GitLab, Codeberg, or your own git remote when you want a Nostr mirror or a path off a centralized host—not a skin on top of another forge’s login.

## Use it for

- **Mirror / backup** — Push or import a repo. Files live on the **gitnostr** bridge (`git-nostr-bridge`, and/or upstream); metadata on relays.
- **Issues & PRs on Nostr** — Same workflow as a normal forge. Events are NIP-34 and related kinds
- **Pages** — Publish static sites from a repo
- **Apps** — List/install NIP-82 apps
- **Bounties** — Fund or solve issues; zaps via LNbits / NWC / LNURL.

Sitemap/SEO: dynamic from relays — [docs/SEO.md](docs/SEO.md).

## Nostr git ecosystem (how gittr fits)

**gittr** is a web forge built on **[gitnostr](https://github.com/arbadacarbaYK/gitnostr)** (`ui/gitnostr/`): the UI talks to relays; **git push/pull** goes through the **git-nostr-bridge** (hosted at `git.gittr.space` or self-hosted). That is separate from **[ngit](https://ngit.dev)** (CLI + `nostr://`), which pairs with **[gitworkshop](https://gitworkshop.dev)** instead.

The [awesome-nostr](https://github.com/aljazceru/awesome-nostr#git) list names several **independent** NIP-34 tools. They share **NIP-34** on relays (often **GRASP** for multi-host `clone` URLs), but not the same codebase—think **protocol → git server → UI/CLI**, not one app per bullet.


| Layer                   | Project                                                                                               | Role                                                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Protocol                | [NIP-34](https://github.com/nostr-protocol/nips/blob/master/34.md) + [GRASP](https://ngit.dev/grasp/) | Signed repo/issue/PR events; optional multi-mirror git hosts                                                                                                 |
| **Git server (bridge)** | **[gitnostr](https://github.com/arbadacarbaYK/gitnostr)** (`ui/gitnostr/`)                            | `git-nostr-bridge`, SSH/HTTPS bare repos, kind **52** SSH keys, optional **`push_cost_sats`** paywall, **`git-nostr-cli`** (`gn`). **Not the same as ngit.** |
| Web client              | **[gittr](https://gittr.space)**                                                                      | This repo: UI **on gitnostr**; hosted bridge on `git.gittr.space`; [self-host the bridge](docs/GIT_NOSTR_BRIDGE_SETUP.md)                                    |
| Web client              | **[gitworkshop](https://gitworkshop.dev)**                                                            | GRASP web client; sparse git explorer; pairs with ngit; fetches from **ngit GRASP** git mirrors (same class of hosts gittr uses)                             |
| CLI (ngit stack)        | **[ngit](https://ngit.dev)**                                                                          | `ngit init`, `pr/` branches, **`nostr://` remotes** via [git-remote-nostr](https://github.com/DanConwayDev/ngit-cli) — different codebase from gitnostr      |
| Desktop                 | **[gitplaza](https://gitplaza.netlify.app)**                                                          | Linux-focused NIP-34 UI; often used with gitworkshop/ngit for full workflows                                                                                 |


**gittr ≠ ngit:** gittr ships and runs **gitnostr**. **ngit** is Dan Conway’s CLI + `git-remote-nostr`. They interoperate on the **same Nostr events** (kinds 30617/30618, issues, PRs); day-to-day **git push/pull** on gittr.space uses **SSH/HTTPS to the bridge**, not the ngit binary.

### More on [awesome-nostr § git](https://github.com/aljazceru/awesome-nostr#git)

Also listed there but not in the stack table above (different layer or adjacent tooling):


| Project                                                                                | Role                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[nak](https://github.com/fiatjaf/nak)** ([nostr army knife](https://nak.nostr.com/)) | fiatjaf’s general **Nostr CLI** (events, relays, Blossom, negentropy, …). For git: **`nak git`** — `clone`, `init`, `sync`, `fetch`, `pull`, `push` on **NIP-34 / GRASP** repos. On awesome-nostr under **Tools**, not Clients. Not a web forge; not gitnostr/ngit. |
| **[gitstr](https://github.com/fiatjaf/gitstr)**                                        | **Deprecated** — old NIP-34 **patch** CLI (`git str send` / `download`). Successor: **`nak git`** (and broader **`nak`**).                                                                                                                                          |
| **[git-nostr-tools](http://git.jb55.com/git-nostr-tools)**                             | jb55 CLI for sending **code patches** over Nostr (related research line to gitstr).                                                                                                                                                                                 |
| **[git-nostr](https://github.com/colealbon/git-nostr)**                                | Cole Albon’s **pre-prototype** `git-nostr` CLI (publish patches, issues, PRs to relays; [nostrin.gs](https://nostrin.gs) / [git.nostrin.gs](https://git.nostrin.gs)). Separate stack from gitnostr/ngit—custom event tags                                           |
| **[gittr-helper-tools](https://github.com/arbadacarbaYK/gittr-helper-tools)**          | **Integrator snippets** from gittr production (GRASP detection, NIP-46, file fetch, etc.)—not a hosted forge; helper snippets for all clients and companion to this repo.                                                                                           |
| **[Zapounty](https://github.com/ZigBalthazar/zapounty)**                               | **GitHub** app: Lightning **bounties on GitHub issues** (zaps). No Nostr git client.                                                                                                                                                                                |


### Git access on gittr


| Method                        | On gittr.space                                         | Notes                                                                                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SSH / HTTPS to bridge         | **Yes**                                                | `git@git.gittr.space:<npub>/repo.git` — no local bridge install; see [SSH_GIT_GUIDE.md](docs/SSH_GIT_GUIDE.md)                                                                                                            |
| Self-host **gitnostr** bridge | **Yes**                                                | Same code as `ui/gitnostr/`; [GIT_NOSTR_BRIDGE_SETUP.md](docs/GIT_NOSTR_BRIDGE_SETUP.md)                                                                                                                                  |
| `**git-nostr-cli`** (`gn`)    | **Yes** (in tree)                                      | Publish/manage repos from shell; bridge reacts on relays                                                                                                                                                                  |
| **`nostr://` clone**          | **Yes** (interop)                                      | Needs **`git-remote-nostr`** on your machine (ngit ecosystem). gittr publishes standard `clone` tags and shows `nostr://…` in the UI; see [help → clone options](https://gittr.space/help). gittr does **not** ship ngit. |
| **`nak git`**                 | **No** (install [nak](https://github.com/fiatjaf/nak)) | Same NIP-34/GRASP interop; different CLI from git-nostr-cli (`gn`)                                                                                                                                                        |


### Web client features (comparison)

Only rows we can stand behind from **this repo** or the other project’s README. **?** = we have not verified on their live site.


|                                   | **gittr**                               | **gitworkshop**                                                                                       | **gitplaza**         |
| --------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------- |
| Live hosted forge                 | [gittr.space](https://gittr.space)      | [gitworkshop.dev](https://gitworkshop.dev)                                                            | App / demo           |
| Issues & PRs in browser           | Yes                                     | Yes                                                                                                   | Yes (patches/issues) |
| Import GitHub / GitLab / Codeberg | Yes                                     | No                                                                                                    | ?                    |
| Product runs its own git bridge   | Yes (**gitnostr** on `git.gittr.space`) | No — git via **ngit GRASP** hosts (`relay.ngit.dev`, `ngit-relay.nostrver.se`, …) + `clone` on events | ?                    |
| Repo zaps (NIP-57)                | Yes                                     | Yes                                                                                                   | ?                    |
| Issue bounties                    | Yes                                     | No                                                                                                    | No                   |
| Static Pages, `/apps` directory   | Yes                                     | No                                                                                                    |                      |
| Push paywall on git push          | Yes (`push_cost_sats`)                  | No                                                                                                    | —                    |


**Notes**

- **gittr** — built on **[gitnostr](https://github.com/arbadacarbaYK/gitnostr)** (`ui/gitnostr/`, MIT): `git-nostr-bridge`, `git-nostr-ssh`, `git-nostr-cli` (`gn`). Production bridge is the gittr fork, not [spearson78/gitnostr](https://github.com/spearson78/gitnostr) upstream alone. Web-only features (bounties, Pages, `/apps`, import UI) live in this repo.
- **gitworkshop** — pairs with **ngit** (CLI + `git-remote-nostr`), not with gitnostr. Loads repo data from public **ngit GRASP** git servers (e.g. `relay.ngit.dev`, `ngit-relay.nostrver.se`)—the same mirrors gittr queries (`ui/src/lib/utils/grasp-servers.ts`), plus `clone` URLs on events. **Repo zaps** yes; no issue bounties or gittr-style Pages/`/apps`.
- **gitplaza** — desktop NIP-34 client; often used alongside gitworkshop/ngit; no issue bounties.
- **Other awesome-nostr entries** — [nak](https://github.com/fiatjaf/nak) (`nak git`), [gitstr](https://github.com/fiatjaf/gitstr) (deprecated), [git-nostr-tools](http://git.jb55.com/git-nostr-tools), [git-nostr](https://github.com/colealbon/git-nostr), [gittr-helper-tools](https://github.com/arbadacarbaYK/gittr-helper-tools), [Zapounty](https://github.com/ZigBalthazar/zapounty): see table above.
- **NostrGit** — historical **UI** template only (see Lineage—not the **gitnostr** bridge gittr runs).

Corrections welcome.

## Features include

Repos: create, import (incl. bulk), fork, browse/edit files, blame, diffs, releases, tags. Collaboration: issues (bounties), PRs, projects, discussions, notifications (Nostr/Telegram). Payments: repo zaps, issue bounties, optional `push_cost_sats` paywall on GUI + SSH push. Dev UX: fuzzy finder, code search, permalinks, HTTPS/SSH clone, SSH keys in Settings → SSH Keys, themes, PWA. Discovery: explore, profiles, stars, sponsors.

Details and edge cases: [docs/](docs/) (especially [FILE_FETCHING_INSIGHTS.md](docs/FILE_FETCHING_INSIGHTS.md), [NIPS_AND_EVENT_KINDS.md](docs/NIPS_AND_EVENT_KINDS.md)).

## Stack


| Layer      | Tech                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------- |
| UI         | Next.js 13 (App Router), React, TypeScript, Tailwind                                      |
| Nostr      | `nostr-relaypool`, `nostr-tools`                                                          |
| Git server | `git-nostr-bridge`, `git-nostr-ssh`, `git-nostr-cli` in `[ui/gitnostr/](ui/gitnostr/)`    |
| App blobs  | NIP-96 Blossom (NIP-82 `/apps`, Pages uploads; large packs—not git objects on the bridge) |
| Payments   | NIP-57 zaps (`lud16` / LNURL-pay), LNbits, NWC, LNURL                                     |


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


| Project                                            | Role                                                                                                                                                                             |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [gitnostr](https://github.com/spearson78/gitnostr) | Upstream **git server** (bridge/SSH); gittr ships the fork in `ui/gitnostr/` → [arbadacarbaYK/gitnostr](https://github.com/arbadacarbaYK/gitnostr) (paywall, NIP-34 state, etc.) |
| **gittr**                                          | This repo — **web forge on gitnostr**; not a thin fork of upstream gitnostr alone                                                                                                |
| [NostrGit](https://github.com/NostrGit/NostrGit)   | Historical **UI** template only (not the bridge codebase)                                                                                                                        |


Also: [nostr-relaypool](https://github.com/adamritter/nostr-relaypool), [GRASP](https://ngit.dev/grasp/). Stack diagram: [docs/gittr-platform-enhancements.png](docs/gittr-platform-enhancements.png) · bridge notes: [ui/gitnostr/README.md](ui/gitnostr/README.md).

NIPs/kinds: [docs/NIPS_AND_EVENT_KINDS.md](docs/NIPS_AND_EVENT_KINDS.md). Interop: NIP-34 `a` tags, NIP-51 repo lists (`10018`), NIP-32 labels (`1985`) for **ngit**, **gitworkshop**, and other NIP-34 clients.

## Support

Telegram: [https://t.me/gittrspace](https://t.me/gittrspace)

Nostr: [https://njump.me/npub1nur7st367ys7cqtjyv74alu84y209zsw8wagpxvrl3g9q2veqzuqjqh65s](https://njump.me/npub1nur7st367ys7cqtjyv74alu84y209zsw8wagpxvrl3g9q2veqzuqjqh65s)