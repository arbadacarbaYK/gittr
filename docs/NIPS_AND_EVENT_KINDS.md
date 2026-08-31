# NIPs and Event Kinds Used in gittr.space

This document lists all Nostr Improvement Proposals (NIPs) and event kinds used by gittr.space.

**Canonical NIP / kind reference (nostr schemata on gittr):** [schemata README](https://gittr.space/npub1zafcms4xya5ap9zr7xxr0jlrtrattwlesytn2s42030lzu0dwlzqpd26k5/schemata?file=README.md) — e.g. [NIP-34](https://gittr.space/npub1zafcms4xya5ap9zr7xxr0jlrtrattwlesytn2s42030lzu0dwlzqpd26k5/schemata?file=README.md&path=nips%2Fnip-34), [NIP-25](https://gittr.space/npub1zafcms4xya5ap9zr7xxr0jlrtrattwlesytn2s42030lzu0dwlzqpd26k5/schemata?file=README.md&path=nips%2Fnip-25), [NIP-51](https://gittr.space/npub1zafcms4xya5ap9zr7xxr0jlrtrattwlesytn2s42030lzu0dwlzqpd26k5/schemata?file=README.md&path=nips%2Fnip-51).

## Interop Baseline (ngit and other Nostr git clients)

To keep event behavior consistent with other major NIP-34 clients (including ngit and other Nostr git clients), gittr enforces these interoperability rules:

- For kind `1621` (issues), required NIP-34 tags are always present: `a`, `r`, `p`, `subject`.
- For kind `1617` (patches), required NIP-34 tags are always present: `a`, `r`, `p`.
- For kind `1618` (pull requests), required NIP-34 tags are always present: `a`, `r`, `p`, `subject`, `c`, and at least one `clone`.
- Repository references use canonical repo identifiers (`repositoryName` / `d` tag identity), so `a` tags stay consistent across clients.
- NIP-22 comment threading for discussion replies preserves real parent references (`E/K/P` root + `e/k/p` parent), so nested threads render correctly in external clients.
- NIP-51 git follow lists (`kind:10018`) are used for followed repositories (`a` tags to `30617` addresses).
- NIP-32 label overlays (`kind:1985`) are supported for post-creation metadata overlays (labels and subject-style updates).
- Experimental `kind:1624` cover notes are treated as optional/non-blocking (feature-flagged behavior).

## Standard NIPs

### NIP-01: Basic Protocol

- **Purpose**: Core Nostr protocol (events, relays, subscriptions)
- **Usage**: All Nostr communication
- **Event Kinds**: All kinds

### NIP-11: Relay Information Document

- **Purpose**: Relay metadata and capabilities
- **Usage**: `/api/nostr/info` endpoint returns NIP-11 document
- **Features**: Lists supported GRASP versions, event kinds, git server URL

### NIP-19: bech32-encoded entities

- **Purpose**: Human-readable encoding of pubkeys, event IDs, etc.
- **Usage**:
  - `npub1...` for user profiles
  - `note1...` for event IDs
  - `nprofile1...` for profiles with relays

### NIP-25: Reactions

- **Purpose**: Event reactions (likes, stars)
- **Usage**: Repository stars
- **Event Kind**: `7` (KIND_REACTION)

### NIP-33: Parameterized Replaceable Events

- **Purpose**: Replaceable events with parameters
- **Usage**: NIP-34 repository events (kind 30617)
- **Event Kind**: `30617` (KIND_REPOSITORY_NIP34)

### NIP-34: Replaceable Events

- **Purpose**: Replaceable events (can be updated)
- **Usage**: Repository announcements (primary method)
- **Event Kind**: `30617` (KIND_REPOSITORY_NIP34)
- **Tags**: `d` (identifier), `name`, `description`, `clone[]`, `relay[]`, etc.

### NIP-82 (draft): Software applications

- **Purpose**: Describe installable software on Nostr: application metadata (`32267`), releases (`30063`), and file assets (`3063`) with hashes and optional URLs (e.g. Blossom or HTTPS). Same event family used by **Zapstore**.
- **Usage in gittr**: The **`/apps`** directory and the repo **Releases** tab both read these kinds. The hub paints the first page of cards then Load more (same window as `/pages`) so chrome navigation stays responsive. Catalog relays include **`wss://relay.zapstore.dev`**, **`wss://nos.lol`**, **`wss://relay.ngit.dev`**, and `NEXT_PUBLIC_NOSTR_RELAYS` (plus user relays) so Blossom-backed assets resolve like Zapstore / gitworkshop. Download uses the **`url`** on kind `3063` when present (typical for APKs on Blossom or a forge CDN). Gittr does **not** host APKs for this view unless the publisher pointed `url` at your infrastructure. Cards show **kind 0** profile names (and **`p`** attribution tags when present), optional **`license`** (SPDX), and **GitHub stars/forks** when `repository` is a **github.com** URL (server **`POST /api/github/public-repo-stats`**, uses **`GITHUB_PLATFORM_TOKEN`** if set).
- **Repo Releases tab**: Lists **forge** Releases (when a GitHub/Codeberg/GitLab `sourceUrl` exists) **and/or** NIP-82 releases for that owner/repo (matched via `a`=`30617:…`, fuzzy `i` / app id, or stored `announcedAppId`). A forge `sourceUrl` is **not** required to *read* Blossom releases — only for gittr’s **Announce** publish path.
- **Owner announce (no gittr hosting)**: Repo owners can use **Announce app** on the Code sidebar. gittr reads the linked forge’s **Releases** API (GitHub / Codeberg / GitLab) — not a git branch — requires at least one **`.apk`** asset, hashes it server-side without storing the file, then the owner signs kind `32267` / `3063` / `30063` with asset `url` = the forge’s public download URL. **Zapstore listing is free** (no fee); if `relay.zapstore.dev` rejects a first publish, commit a `zapstore.yaml` with `repository` + owner `pubkey` for their auto-whitelist ([Zapstore publish docs](https://zapstore.dev/docs/publish)). Optional fuller Zapstore-client trust (APK cert / NIP-C1) still means running `zsp` yourself (may upload to Zapstore CDN — separate from gittr).
- **Delete app announce (not the repo)**: NIP-09 kind `5` referencing the app/release/asset event ids. Separate from deleting a NIP-34 repository. `/apps` honors these deletions; the git repo announcement stays. Zapstore’s relay/client may take its own time (or policy) to drop listings.
- **API**: `GET /api/repo/forge-releases?sourceUrl=…` (`hash=1` to compute sha256; optional `tag=` for a specific Release, else latest). Soft empty: `no_releases` / `no_apk` → **200** + `ok:false` (most repos). Hard errors: `missing_source`, `unsupported_forge`, forge upstream failures → 4xx/502. Full asset lists for the Releases tab use `GET /api/repo/forge-release-list` (no APK gate).
- **Implementation**: `ui/src/lib/nostr/nip82-software.ts`, `ui/src/lib/nostr/nip82-repo-releases.ts`, `ui/src/lib/nostr/publish-software-announce.ts`, `ui/src/lib/repo/forge-releases.ts`, `ui/src/lib/nostr/software-catalog-relays.ts`, `ui/src/components/ui/repo-app-announce-panel.tsx`, `ui/src/app/apps/`, `ui/src/app/[entity]/[repo]/releases/`.

### NIP-46: Remote signer (NIP-07 compatibility)

- **Purpose**: Let a **remote** device or app (Amber, Nowser, LNbits remote signer, self-hosted bunker, etc.) sign on behalf of the user. Traffic is **JSON-RPC over encrypted kind `24133`** events (NIP-04 / NIP-44). The web app can expose a **NIP-07-shaped** `window.nostr` adapter so existing `signEvent` / `nip04` / `nip44` call sites work unchanged.
- **Usage in gittr**: Login → **Pair Remote Signer** supports **`bunker://`** and **`nostrconnect://`**, QR scan, paste, and session persistence. All repo/issue/PR publishes that go through the normal signing path can use the remote signer once paired.
- **URI modes (do not confuse them)**:
  - **`bunker://`**: URI host = **remote signer’s** hex pubkey. The client may generate a fresh ephemeral keypair per session.
  - **`nostrconnect://`**: URI host = **client** pubkey for this pairing; the **signer’s** pubkey is learned only after an inbound `24133` whose decrypted `result` equals the URI `secret` challenge. Gittr stores the ephemeral client key **locally** (keyed by client pubkey), rather than placing private key material in the URI.
- **Relays**: At least one relay in the URI (and in the app relay set) must deliver `24133` between client and signer; flaky relay sets cause “paired but nothing happens” symptoms.
- **Implementation**: `ui/src/lib/nostr/remoteSigner.ts`, bootstrap in `ui/src/lib/nostr/NostrContext.tsx`, UI in `ui/src/app/login/page.tsx`. Full guide: [`docs/NIP46_REMOTE_SIGNER_INTEGRATION.md`](./NIP46_REMOTE_SIGNER_INTEGRATION.md). Snippets + pitfall summary for other implementers: [gittr-helper-tools `nip46-remote-signer`](https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr-helper-tools?file=snippets/nip46-remote-signer/README.md&branch=main).
- **`get_public_key` prompts**: After pairing, gittr already stores the user’s hex pubkey in the remote-signer session (and in the logged-in session). Reconnect / health probes use **`connect` only** when that cached identity exists — they do **not** re-ask Amber for `get_public_key` on every Push / announce / sign. A `get_public_key` RPC is still used during **first pairing** (or if the cached pubkey is missing). Signing still asks for **`sign_event`** as usual.
- **Event kind**: **`24133`** — NIP-46 request/response envelope (not to be confused with pure in-browser NIP-07 extensions, which skip `24133` and sign locally).
- **Also supported**: Classic **NIP-07** browser extensions (Alby, nos2x, Flamingo, etc.) remain a separate code path from NIP-46 but fulfill the same “user signs events” role from the app’s perspective.

### NIP-47: Nostr Wallet Connect (NWC)

- **Purpose**: Control a **Lightning wallet** over Nostr (pay invoices, optionally read balance) without putting wallet credentials on the app server. Encrypted JSON-RPC on kinds **`23194`** (request) / **`23195`** (response).
- **Not NIP-46**: Remote signer (`bunker://` / `nostrconnect://`, kind `24133`) is for **signing identity events**. NWC (`nostr+walletconnect://`) uses a separate **`secret`** (client key for the wallet connection only). Same “RPC over relays” shape; different URI, keys, and kinds. Products like LNbits may offer both — configure them separately in gittr.
- **Relay policy (gittr vs common clients)**: Many apps only talk NWC on a **fixed relay pool** and/or **ignore `?relay=`** in the connection string, which locks out wallets that only listen on the URI’s relay. **gittr always opens a direct WebSocket to the `relay=` value(s) from the NWC URI** for `23194`/`23195` (supports **multiple** `relay=` like Alby). Those relays do **not** need to be in Settings → Relays, and we do **not** fall back to the user’s social/GRASP pool for payments. Details: `ui/NWC_IMPLEMENTATION_NOTES.md`.
- **Usage in gittr**: Settings → Account → **NWC Send** / **NWC Recv** (`gittr_nwc_send` / `gittr_nwc_recv`). Payment QR / zap flows may call `pay_invoice` client-side; balance probe uses `get_balance` when the wallet supports it. **Secret never leaves the browser** — WebSocket goes straight to the wallet’s relay. **Do not** paste NWC into Pair Remote Signer / Amber Nostr Connect (that is NIP-46 login; gittr shows a clear error).
- **URI**: `nostr+walletconnect://<wallet-pubkey>?relay=wss://…&secret=<hex>` (optional `lud16=`). Host = wallet service pubkey; sign requests with `secret`.
- **Critical**: Match response `e` tag to the request event id (NIP-47). Ignore other `23195` events.
- **Zap overlap**: NIP-57 zap **request** may be signed via NIP-07/NIP-46; **paying** the resulting BOLT11 can use NWC Send. Auth signs; wallet pays.
- **Implementation**: `ui/src/lib/payments/nwc-balance.ts`, `nwc-connection-test.ts`, `ui/src/components/ui/payment-qr.tsx`, notes in `ui/NWC_IMPLEMENTATION_NOTES.md`. Snippet for other implementers: [gittr-helper-tools `nip47-nwc`](https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr-helper-tools?file=snippets/nip47-nwc/README.md&branch=main).
- **Event kinds**: **`23194`** / **`23195`**.

### NIP-57: Lightning Zaps

- **Purpose**: Lightning Network payments with zap requests (`9734`) and receipts (`9735`) on relays
- **Usage**: Owner-only **repository** zaps use a real NIP-57 flow when the recipient’s LNURL-pay endpoint sets `allowsNostr` and `nostrPubkey`. **Bounties**, **pay-to-merge**, and other flows that need fast server-side confirmation keep using **LNbits** (or similar) instead of waiting on gossip for receipts.
- **Client notes**: Repo zap receive addresses come from the owner’s kind-0 `lud16`/`lnurl` (plus optional repo payment config). A stale `gittr_metadata_cache` that has a display name but no Lightning fields used to skip refetch and look like “no Lightning address.” Full localStorage can also surface misleading zap errors — gittr now refetches missing payment fields, lets `/api/zap/create-invoice` resolve lud16 server-side when the client cache is empty, surfaces real API errors, and prunes the metadata cache on quota errors instead of blaming the recipient.
- **Event Kind**: `9735` (KIND_ZAP) — the **Your Zaps** page merges live `9735` events from the user’s relay set (filters `#p` / `#P` per NIP-57) with the local `gittr_zaps` ledger and drops duplicate **pending** rows when a matching receipt arrives.
- **Repo header “Zaps” badge**: subscribes to `9735` with `#p` = repo owner, sums receipts whose embedded zap request matches this repo’s `Zap for entity/repo` text, merges with the local `gittr_zaps` ledger for the same repo (dedupes when a receipt matches a local paid row), so the number reflects the **network** where your relay set delivers receipts, not this browser alone.

### NIP-51: Lists

- **Purpose**: Standard user list events (NIP-51 “standard lists”)
- **Usage**: **Watch** on a repo (with NIP-07): publishes your followed-Git-repositories list so other clients can read it from relays.
- **Event Kind**: `10018` (KIND_GIT_REPOSITORIES_LIST) — _Git repositories list_ (not kind `3000` bookmark lists).
- **Tags**:
  - `a[]` only: each value is a **repository address** `30617:<64-hex-owner-pubkey>:<repositoryName>` (same shape as elsewhere in NIP-34 interop). There is no per-repo “patch” event: **each publish carries the full current set** of `a` tags; relays treat the latest `10018` from your pubkey as the replaceable list. That is spec behavior, not data loss — you are **replacing the list document** with old entries **plus** adds/removes computed in the client.
- **gittr UI behavior** (`ui/src/app/[entity]/[repo]/layout-client.tsx`): reads `gittr_watched_repos` from `localStorage`, computes `nextWatched` (either `[...watched, repoId]` or `watched` minus this repo), maps each watched `entity/repo` to a `30617:…` address using `gittr_repos` cache where possible, then publishes **one** signed `10018` whose `a` tags are that full set (current repo is always included on follow via `repoAddress` when hex owner is known). **Caveat:** if a watched repo’s owner cannot be resolved to hex from the local repo cache, that row may be omitted from the **published** list while still remaining in `gittr_watched_repos` until cache improves.
- **Star vs Watch**: **Star** publishes **NIP-25 kind 7** on the repo’s **30617** event (`ui/src/lib/nostr/repo-stars.ts`, repo header). The id is resolved with **`resolveLiveRepoAnnouncement`** (profile-repos + live overlay) — the same announcement identity as file fetch, Public/Private, Refetch, and new Issue/PR. Do not treat “files loaded from GRASP” as unpublished. Header lookup must not restart on every file-fetch persist (Star stays labeled **Star**, not “Looking up…”). **Watch** publishes **NIP-51 kind 10018** (`a` tag `30617:owner:d`, not the event id). `gittr_starred_repos` is a local cache for the Stars page before relays echo.
- **Interop snippet**: [gittr-helper-tools `nip25-stars-nip51-following`](https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr-helper-tools?file=snippets/nip25-stars-nip51-following/README.md&branch=main)
- **Parsing helpers**: `createGitRepositoriesListEvent` / `parseGitRepositoriesListEvent` in `ui/src/lib/nostr/events.ts`.

### NIP-32: Labeling

- **Purpose**: Post-hoc labeling and metadata overlays
- **Usage**: Overlay labels and subject-like metadata updates for issue/PR workflows
- **Event Kind**: `1985` (KIND_LABEL_OVERLAY)
- **Tags**:
  - `a`/`e`: Target event reference
  - `L`: Label namespace
  - `l[]`: Label values within namespace

### NIP-96: Blossom (File Storage)

- **Purpose**: Large file storage for Nostr events
- **Usage**: Git pack files, large binaries
- **Endpoint**: `/nip96/` API

### NIP-C0: Code Snippets

- **Purpose**: Share code snippets on Nostr
- **Usage**: Code snippet sharing from repositories
- **Event Kind**: `1337` (KIND_CODE_SNIPPET)
- **Tags**:
  - `l`: Language (lowercase, e.g., "javascript")
  - `extension`: File extension (without dot, e.g., "js")
  - `name`: Filename
  - `description`: Description
  - `runtime`: Runtime environment (e.g., "node v18.15.0")
  - `license[]`: License(s) (SPDX identifiers, can be multiple)
  - `dep[]`: Dependencies (can be multiple)
  - `repo`: Repository reference (URL or NIP-34 format: "30617:<pubkey>:<d tag>")
- **Content**: The actual code (string)

## Custom Event Kinds

### Kind 50: Repository Permissions

- **Purpose**: Git repository access control
- **Usage**: Managing read/write permissions for repositories
- **Tags**: `repo` (owner pubkey, repo name), `p` (target pubkey), permission level

### Kind 51: Repository Announcements (Legacy)

- **Purpose**: Repository metadata and announcements
- **Usage**: Legacy format, read-only support for backwards compatibility
- **Replaced by**: Kind 30617 (NIP-34)

### Kind 52: SSH Keys

- **Purpose**: Git authentication via SSH (gittr / git-nostr-bridge)
- **Usage**: Storing SSH public keys for Git operations on `git.gittr.space`
- **Content**: SSH public key in format: `<key-type> <base64-key> [comment…]`
- **Not related to**: GitHub OAuth on the SSH Keys settings page (that is for GitHub API/import only)

### Kind 10011: External Identities (NIP-39)

- **Purpose**: Link a Nostr profile to GitHub, X/Twitter, Mastodon, Telegram, etc.
- **Tags**: `i` — `["i", "platform:identity", "<proof>"]` (proof optional but recommended)
- **Replaceable**: one latest kind **10011** per pubkey
- **Dual-layer with kind 0 (important)**:
  - Kind **0** = profile card (`name`, `display_name`, and camelCase `displayName` some clients write; gittr reads all three before falling back to npub)
  - Kind **10011** = external identity claims only
  - gittr **always reads and merges both**. A 10011 event must never wipe or block kind-0 name/avatar.
  - Legacy clients that put `i` on kind **0** are still read; claims are **unioned** with 10011 (same `platform:identity` prefers 10011 / proof).
- **Writes (Settings → Profile)**: save publishes **kind 0** (metadata) **and** **kind 10011** (identities) together — not one instead of the other.
- **UI**: Settings → Profile → Verified Identities; GitHub OAuth on Settings → SSH Keys can prefill a github claim before you save Profile

### Projects / Kanban (no finalized NIP yet)

- **gittr ToDo tab** (`/{entity}/{repo}/projects`): local boards in `localStorage`, plus **read-only import of GitHub Projects V2** when a GitHub `sourceUrl` exists (GraphQL via `/api/github/graphql`).
- **Policy**: mirror source like Issues — refresh on tab open; do **not** write column moves back to GitHub; keep local-only boards editable beside GH mirrors.
- **Nostr**: drafts exist ([nips#1665](https://github.com/nostr-protocol/nips/pull/1665), [nips#1804](https://github.com/nostr-protocol/nips/pull/1804), Headway provisional 30619/30620) but nothing is merged. Do not invent a permanent gittr kind until one draft settles; cards remain NIP-34 issues/PRs (1621/1618).
- **Future GitHub write-back**: optional **user GitHub OAuth** (not a new kind) when NIP-39 / upstream identity matches — see helper-tools `snippets/github-oauth-writeback/`. Keep Nostr as collaboration truth; OAuth is a forge bridge.
- **Helper write-up for a future NIP**: `gittr-helper-tools/snippets/todos-discussions-kanban/` (surfaces, rules, suggested event shape).

### Kind 30617 clone URLs (`git.gittr.space`)

- **Announce / other clients (NIP-34):** HTTPS `clone` tags use **`/<npub>/<repo>.git`** — same shape as ngit GRASP.
- **On disk (gitnostr):** bare repos live under **`/<hex-pubkey>/`**. The bridge creates **`npub → hex` symlinks** so npub HTTPS works. Missing symlink → 404 (not “spec wants hex”).
- **SSH:** `git@git.gittr.space:<hex|/npub>/repo.git` (ssh helper resolves npub → hex).
- UI “Copy clone URL” prefers GitHub/GitLab/Codeberg when present, else the announced HTTPS clone.

### Kind 1337: Code Snippets (NIP-C0)

- **Purpose**: Share code snippets
- **Usage**: Standalone code sharing, discoverable across Nostr network
- **See**: NIP-C0 section above

### Kind 30617: Repository Metadata (NIP-34)

- **Purpose**: Repository announcements (primary method)
- **Usage**: Repository metadata, discovery, announcements
- **Tags**:
  - `d`: Repository identifier (required)
  - `name`: Human-readable project name
  - `description`: Repository description
  - `clone[]`: Git server URLs for **this** Nostr-git host (HTTPS GRASP/`git.gittr.space`, other HTTPS git remotes, `nostr://…`, or Iris **`htree://npub…/repo`**). Native gittr repos omit `source` and list gittr/GRASP here. After a gittr Push that already lists a GRASP clone, the foreign forge (GitHub/…) is **not** duplicated in `clone` (avoids “commit not found” on other clients) — it goes in `source` instead. gittr **reads** any HTTPS `clone` tag for trees/blobs (including self-hosted hosts); it does **not** copy `git.gittr.space` onto `source`.
  - `source` (gittr / common clients): Upstream foreign forge URL (e.g. `https://github.com/org/repo`, GitLab, Codeberg, Gitea, …). Drives **Git Server** in the sidebar and **Refetch from GitHub/GitLab/…**. After Push, the forge URL stays on `source` (not duplicated in `clone` when a GRASP clone exists). **`forkedFrom` is not a copy of `source`.** It is only a real fork parent: GitHub `parent.html_url` when GitHub marks the repo as a fork, or a gittr pointer (`/npub1…/repo`) from the Fork button. Importing your own GitHub original must emit `source` only. **Every Push and Settings Save must re-emit `source`** when known locally or recoverable from a prior 30617 — otherwise a GRASP-only re-push permanently forgets the import. Pure Nostr-native repos omit this; Refresh then reloads from gittr/GRASP clones. Code-tab hydrate scans `source`, `forkedFrom`, `clone`, `web`, and `link` (see `extractGithubUrlFromEventTags`). **Reverse lookup** (forge URL → npub for DMs when the forge is unreachable): exact normalized `host/path` via MCP `findReposBySource` / `GET /api/nostr/repos-by-github?source=` — not fuzzy `d`/name match.
  - `relay[]` / `relays[]`: Nostr relay URLs
  - `t[]`: Topics/tags
  - `p[]`: Contributors (with weights)
  - `maintainers[]`: Maintainer pubkeys (used for access control)
  - `r` + `euc`: Earliest unique commit (NIP-34) — **not** the GitHub URL
  - `image`: Logo URL
  - `web[]`: Project website / docs browse links (e.g. homepage, Iris `https://git.iris.to/#/npub…/repo` — shown as **Iris Git**). Forge client mirrors such as `https://gitworkshop.dev/npub…/<grasp-host>/repo` are **not** treated as Documentation in the gittr sidebar. Not a clone URL; logos belong on `image`, not `web`.
  - `default_branch`: Default branch name
  - `branch[]`: Branch names and commits
  - `release[]`: Release tags and metadata
  - `link[]`: Repository links (docs, social media, etc.) — preferred over bare `web` when typed metadata / labels matter
  - `push_cost_sats` (optional, **gittr / git-nostr-bridge extension**): Integer sats charged per push when the bridge enforces a paywall. **Not** part of the core NIP-34 text; we reuse kind **30617** so the amount is owner-attested on the same replaceable repo announcement other clients already follow. The bridge copies this tag into `RepositoryPushPolicy` for `/api/nostr/repo/push` and SSH enforcement; purely local UI state alone cannot secure server-side push.
  - `public-read` / `public-write` (optional, **gittr extension**): `["public-read","false"]` marks a repo private (code/clone/API/SSH reads restricted to owner + `maintainers` / `RepositoryPermission`). Default when omitted: public read, owner-only write. The kind **30617** announcement itself remains a public relay event — name and description stay discoverable; only file access is gated.
- **Privacy**: Core NIP-34 has no visibility field. gittr adds `public-read` / `public-write` tags on kind **30617** and enforces them in **git-nostr-bridge** (SQLite `Repository.PublicRead` / `PublicWrite`), **git-nostr-ssh** (`git-upload-pack` / `git-receive-pack`), and **HTTPS git** on `git.gittr.space` (nginx `auth_request` → `/api/git/http-auth`). The web UI/API uses the same ACL via `assertRepoReadAccess`. Listings (Explore, My Repositories, profile `/api/nostr/profile-repos`) **must parse** those tags — treating privacy as localStorage-only was a bug (private flipped back to public after “clear local data”). Repo **Settings** hydrates Public/Private from the latest kind **30617** (same as the Private badge) and blocks Save until visibility is confirmed, so editing Description alone cannot republish a default Public over a private repo. Every Push path (nsec and NIP-07/Amber) must re-emit the tags so a later push does not wipe Settings → Private. **Settings Save publishes 30617 only** — it must not mark the repo as needing a file Push (`hasUnpushedEdits`); a follow-up Push with a thinned local file index used to force-wipe bridge folders (see `docs/BRIDGE_PUSH_DEBUGGING.md`). Private repos are hidden from Explore/profile for strangers; direct URL shows a **Private** badge and lock screen. SSH keys and Nostr-signed HTTP headers use the same pubkey-based ACL — add a maintainer's **npub** in Repository Settings → Contributors for access.
- **Soft-delete (gittr)**: Settings → Delete does **not** rely on localStorage alone. If the repo was published, gittr republishes the same replaceable kind **30617** (`d` = repo name) with `["deleted","true"]` / `["status","deleted"]` and content JSON `{"deleted":true,...}`, plus a NIP-09 kind **5** with an `a` tag `30617:<owner-hex>:<repo>`. Explore, My Repositories, home recent repos, profile-repos, entity pages, and sitemaps **must** honor those markers — otherwise a tombstone looks like a “new” push (newer `created_at`) and resurfaces after clearing `gittr_deleted_repos`. **profile-repos liveness is the latest 30617 only** (parser: `ui/src/lib/nostr/profile-repos-merge.ts`): leftover kind **30618** must not list a repo (and must not resurrect a delete). My Repos heal only prompts when a **live 30617 is newer than** the local hide `deletedAt` — not because the name is still in a stale live list. Direct repo URLs use the **same** latest-30617 hydrate already used for Public/Private: when markers win, the Code page shows **“This repository was deleted”** (not a private wall / empty tree). There is **no** extra “checking status” preflight on every load. Kind **5** is best-effort for other clients; gittr UI does not require a kind-5 subscription on the repo page. Parser: `ui/src/lib/nostr/repo-deleted.ts`.
- **Related announces on delete**: the same Settings delete also best-effort NIP-09-deletes **Nostr Pages** (kind **35128** for the repo’s pages `d` tag) and **app announces** (kinds **32267** / **30063** / **3063** linked via `a`=`30617:…` or suggested app id). Helper: `ui/src/lib/nostr/delete-repo-related-nostr.ts`.

### Kind 3: Contact list / follows (NIP-02)

- **Replaceable**: publishing a new kind **3** replaces the previous list for that pubkey.
- **gittr Follow safety**: never publish when the current list could not be loaded (`uncertainEmpty`). Always **union all kind-3 events** seen during the fetch (not newest-only) + localStorage backup + sessionStorage + in-memory before signing — a tiny newer wipe on one relay must not discard a larger older list. Follows are **serialized** (one publish at a time) and wait for relay confirmation. Refuse publishes that would shrink a large known list (`wouldWipeFollowList`). Backup/`rememberContactList` never shrinks from a smaller fetch. Helpers: `ui/src/lib/nostr/contact-list.ts`. Standalone restore (outside gittr UI): `/home/…/restore-nostr-follows/`.
- **WoT badge**: TrustBadge / `useWoTDistance` must use the **same** backup + multi-event kind-3 fetch (not `limit: 1` overwrite). `rememberContactList` fires `gittr:contact-list-changed` so a successful Follow immediately flips the badge to **In your network** without waiting on the WoT oracle.
- **Public profile counts**: `/{npub}` shows **Following** (this pubkey’s kind 3) and **Followers** (authors of kind 3 with `#p` = this pubkey, newest list per author). Visible logged out for legitimacy / WoT context. Hook: `useProfileFollowCounts`.
- **Profile Pages & Apps**: After Repositories, `/{npub}` also shows that person’s **gittr Pages** (gateway status sites) and **NIP-82 Apps** (software catalog), filtered to their pubkey. Component: `ui/src/components/profile/ProfilePagesAppsSections.tsx`.

### Kind 30618: Repository State (NIP-34)

- **Purpose**: Repository state announcements (required for ngit clients)
- **Usage**: Tracks branches, tags, and commit SHAs for repository state
- **Tags**:
  - `d`: Repository identifier (matches kind 30617)
  - `refs/heads/<branch>`: Branch name and latest commit SHA
  - `refs/tags/<tag>`: Tag name and commit SHA
  - `HEAD`: Default branch reference (e.g., "ref: refs/heads/main")
- **Content**: Empty (state is in tags)
- **Required for**: Full NIP-34 compliance and recognition by ngit clients (e.g., other Nostr git clients)

### Kind 1621: Issues (NIP-34)

- **Purpose**: Issue tracking
- **Usage**: Repository issues with bounties
- **Tags**:
  - `a`: Repository reference (`30617:<owner-pubkey>:<repo-id>`) - REQUIRED
  - `r`: Earliest unique commit ID - REQUIRED
  - `p`: Repository owner - REQUIRED
  - `subject`: Issue title - REQUIRED
  - `t[]`: Labels (optional)
  - `p[]`: Assignees (optional, custom extension)
- **Content**: Markdown description text (not JSON)
- **Interop requirement**: If local cache is missing `r`, derive it from git root commit history (earliest unique commit) before publishing.

### Kind 1618: Pull Requests (NIP-34)

- **Purpose**: Code review and merging
- **Usage**: Pull request workflow
- **Tags**:
  - `a`: Repository reference (`30617:<owner-pubkey>:<repo-id>`) - REQUIRED
  - `r`: Earliest unique commit ID - REQUIRED
  - `p`: Repository owner - REQUIRED
  - `subject`: PR title - REQUIRED
  - `c`: Current commit ID (tip of PR branch) - REQUIRED
  - `clone[]`: Git clone URLs - REQUIRED (at least one)
  - `branch-name`: Branch name (optional)
  - `merge-base`: Most recent common ancestor (optional)
  - `t[]`: Labels (optional)
- **Content**: Markdown description text (not JSON)
- **Interop requirement**: If local cache is missing `r`, derive it from git root commit history (earliest unique commit) before publishing.

### Kind 1619: Pull Request Updates (NIP-34)

- **Purpose**: Update PR when new commits are pushed
- **Usage**: Published when PR branch is updated with new commits
- **Tags**:
  - `a`: Repository reference (`30617:<owner-pubkey>:<repo-id>`) - REQUIRED
  - `r`: Earliest unique commit ID - REQUIRED
  - `p`: Repository owner - REQUIRED
  - `E`: PR event ID (NIP-22) - REQUIRED
  - `P`: PR author (NIP-22) - REQUIRED
  - `c`: Updated commit ID (tip of PR branch) - REQUIRED
  - `clone[]`: Git clone URLs - REQUIRED
  - `merge-base`: Most recent common ancestor (optional)
- **Content**: Empty (all data in tags)

### Kind 1624: Cover Notes (Experimental)

- **Purpose**: Optional "cover note"/summary primitive used by some ngit ecosystem workflows
- **Usage**: Feature-flagged only; never required for core PR/issue interoperability
- **Status**: Experimental/non-canonical

### Kinds 1630-1633: Status Events (NIP-34)

- **Purpose**: Track status of issues, PRs, and patches
- **Usage**: Separate events for status changes (not tags in main event)
- **Tags**:
  - `e`: Root event ID (issue/PR/patch) with marker "root" - REQUIRED
  - `p`: Repository owner - REQUIRED
  - `p`: Root event author - REQUIRED
  - `a`: Repository reference (optional, for filter efficiency)
  - `r`: Earliest unique commit (optional, for filter efficiency)
  - `k`: Optional **gittr extension** with the root event kind (`1618` PR / `1621` issue / `1617` patch). Core NIP-34 does **not** require this tag. gittr **publishes** it on new status events for filter efficiency, but **must not require** `#k` when reading — older merges omit `k`, and requiring it made merged PRs look **OPEN** again after localStorage clear / another browser.
  - For kind 1631 (Applied/Merged): `e` (accepted revision), `q[]` (applied patch IDs), `merge-commit`, `applied-as-commits[]`
- **Content**: Optional markdown text
- **Kinds**:
  - **1630**: Open
  - **1631**: Applied/Merged (for PRs/patches) or Resolved (for issues)
  - **1632**: Closed
  - **1633**: Draft
- **Client rehydrate**: Status subscriptions for a known PR/issue list filter by `#e` (root ids) only. On kind **1631**, set `status: merged` and `mergedBy` from the status event pubkey.

### Kind 10317: User GRASP List (NIP-34)

- **Purpose**: List of GRASP servers the user generally wishes to use for NIP-34 related activity
- **Usage**: Similar in function to NIP-65 relay list and NIP-B7 blossom list
- **Tags**:
  - `g[]`: GRASP service websocket URLs (wss://) in order of preference - zero or more
- **Content**: Empty per NIP-34 spec

### Kind 10018: Git Repositories List (NIP-51)

- **Purpose**: User follow list of NIP-34 repositories
- **Usage**: Repo layout **Watch** / **Unwatch** (with NIP-07) publishes this list so follows are visible on the network; also synced when reading the user’s list from relays. (Related: NIP-51 **kind 10017** is _Git authors_ follow lists — different from repos.)
- **Replaceable semantics (not “spam every click”)**: Under [NIP-51](https://github.com/nostr-protocol/nips/blob/master/51.md), standard lists like `10018` are **normal replaceable events** — you publish **one event whose tags are the whole current list** each time it changes. There is no Nostr message that means “add only this `a` tag”; relays/clients keep **one** logical list per user (newer `created_at` wins). That is intentional, not a missing incremental API.
- **Tags**:
  - `a[]`: Repository addresses (`30617:<owner-pubkey>:<repo-id>`)
- **Content**: Empty

### Kind 30078: Notification prefs (NIP-78 app data)

- **Purpose**: Bot- and server-readable notification preferences (multi-browser sync). Telegram User ID is **not** stored here — only on the instance via `/api/notifications/consent`.
- **Usage**: Settings → Notifications → Save publishes this replaceable event. `sendNotification` delivers via `/api/notifications/deliver` using the **recipient’s** consent, not the actor’s localStorage. CVE bot treats `events.security_cve === true` as opt-in (confirmed OSV CVE issues+DMs **and** Spoiler Alert RSS early-warning DMs; Dependencies tab stays OSV-only).
- **Tags**:
  - `d`: `gittr/notifications` (canonical). Legacy: `gittr/security-cve` (still hydrated).
- **Content** (JSON): `{ "v": 1, "channels": { "nostr": bool, "telegram": bool }, "events": { "pr_opened": bool, "security_cve": bool, ... } }`
- **Code**: `ui/src/lib/notifications/notification-prefs-event.ts`
- **Relay**: include `30078` in Pyramid `open_kinds_spec` (see pyramid `FORGE.md`) so anyone can publish prefs to `wss://relay.gittr.space`.

### Kind 1985: Label Overlay (NIP-32)

- **Purpose**: Attach labels and mutable metadata overlays to existing events
- **Usage**: Post-creation labels and subject-style overlays for issues/PRs
- **Tags**:
  - `a` and/or `e`: Target references
  - `L`: Namespace
  - `l[]`: Label values
- **Content**: Empty

### Kind 30023: Long-form Content (NIP-23) — Repository discussion topics

- **Purpose**: Long-form text (articles, blog posts). Used by gittr for **repo discussion board topics** so any NIP-23 client can read them.
- **Usage**: One event per discussion topic; replies use NIP-22 kind 1111 (per NIP-23).
- **Tags**:
  - `d`: Replaceable identifier (required)
  - `title`: Topic title
  - `summary`: Short summary (optional)
  - `published_at`: Unix timestamp (string)
  - `t`: Topic/category (NIP-23 hashtag)
  - `repo`: Repository scope — `entity/repo` (e.g. `npub.../my-repo`) for filtering
  - `status`: `open` or `closed` (gittr extension)
  - `category`: Category label (gittr extension)
- **Content**: Markdown body (discussion description)

### Kind 9806: Bounties

- **Purpose**: Lightning bounties for issues (NIP-34 companion profile; see [nips#2414](https://github.com/nostr-protocol/nips/issues/2414))
- **Usage**: Issue bounties with host LNURL-withdraw (LNbits today)
- **Tags**: `e` (issue event id + marker `issue`), `repo` (entity, name), `status`, `p` (`creator`, optional `claimed_by`)
- **Content (JSON)**: `amount`, `withdrawId`, `lnurl`, `withdrawUrl`, optional legacy `invoice` / `paymentHash`, timestamps — **not** tag values
- **Production happy path**: offer publishes `paid` → merge publishes `released` (+ `claimed_by`); claimer redeems withdraw URL. `pending` used mainly on cancel. `claimed` optional / not required. Bounty-hunt UI is still localStorage-only.

### Kind 1111: Comments (NIP-22)

- **Purpose**: Comments on issues, PRs, patches, and **discussion topics** (NIP-23 kind 30023)
- **Usage**: Issue/PR comments; discussion replies (root event = 30023, K=30023)
- **Tags**:
  - `E`: Root event ID - REQUIRED (uppercase E per NIP-22)
  - `K`: Root event kind - REQUIRED (e.g. 1621 issue, 1618 PR, 30023 discussion)
  - `P`: Root event author pubkey - REQUIRED when available
  - `e`: Parent event ID - REQUIRED (lowercase for parent scope)
  - `k`: Parent event kind - REQUIRED
  - `p`: Parent event author pubkey - REQUIRED when available
  - `repo`: Repository context (custom extension, not in NIP-22)

## Relay Configuration

For relays to support gittr.space, they must allow these event kinds:

```toml
# nostr-rs-relay config.toml
[relay]
allowed_kinds = [0, 1, 7, 50, 51, 52, 1337, 1111, 1617, 1618, 1619, 1621, 1624, 1630, 1631, 1632, 1633, 1985, 10018, 10317, 30023, 30078, 30617, 30618, 9735, 9806]
```

```yaml
# strfry config
relay:
  eventKinds:
    allow:
      [
        0,
        1,
        7,
        50,
        51,
        52,
        1337,
        1111,
        1617,
        1618,
        1619,
        1621,
        1624,
        1630,
        1631,
        1632,
        1633,
        1985,
        10018,
        10317,
        30617,
        30618,
        9735,
        9806,
      ]
```

## Summary Table

| Kind  | NIP          | Name                   | Purpose                                       |
| ----- | ------------ | ---------------------- | --------------------------------------------- |
| 0     | NIP-01       | Metadata               | User profiles                                 |
| 1     | NIP-01       | Notes                  | Legacy comments (backward compatibility only) |
| 7     | NIP-25       | Reactions              | Stars, likes                                  |
| 50    | Custom       | Repository Permissions | Git access control                            |
| 51    | Custom       | Repository (Legacy)    | Repository announcements (read-only)          |
| 52    | Custom       | SSH Keys               | Git authentication (gittr bridge)             |
| 10011 | NIP-39       | External identities    | `i` tags (GitHub, etc.); prefer over kind 0   |
| 1111  | NIP-22       | Comments               | Issue/PR/patch/discussion comments            |
| 30023 | NIP-23       | Long-form              | Repo discussion topics (replies = 1111)       |
| 1337  | NIP-C0       | Code Snippets          | Code snippet sharing                          |
| 1617  | NIP-34       | Patches                | Patch-based code contributions                |
| 1618  | NIP-34       | Pull Requests          | Pull request announcements                    |
| 1619  | NIP-34       | PR Updates             | PR branch updates (new commits)               |
| 1621  | NIP-34       | Issues                 | Issue tracking                                |
| 1624  | Experimental | Cover Notes            | Optional cover notes for PR/issue summaries   |
| 1630  | NIP-34       | Status: Open           | Issue/PR opened                               |
| 1631  | NIP-34       | Status: Applied/Merged | PR merged or issue resolved                   |
| 1632  | NIP-34       | Status: Closed         | Issue/PR closed                               |
| 1633  | NIP-34       | Status: Draft          | Issue/PR/patch set to draft                   |
| 1985  | NIP-32       | Label Overlay          | Post-hoc labels and metadata overlays         |
| 10018 | NIP-51       | Git Repositories List  | Followed repositories list                    |
| 10317 | NIP-34       | User GRASP List        | Preferred GRASP servers for NIP-34 activity   |
| 30078 | NIP-78       | Notification prefs     | `d=gittr/notifications` channels+events       |
| 30617 | NIP-34       | Repository Metadata    | Repository announcements (primary)            |
| 30618 | NIP-34       | Repository State       | Repository state (required for ngit clients)  |
| 9735  | NIP-57       | Zaps                   | Lightning payments                            |
| 9806  | Custom       | Bounties               | Issue bounties                                |

## References

- [Nostr NIPs Repository](https://github.com/nostr-protocol/nips)
- [NIP-C0 Specification](https://github.com/nostr-protocol/nips/blob/master/C0.md)
- [NIP-34 Specification](https://github.com/nostr-protocol/nips/blob/master/34.md)
- [GRASP Protocol](https://github.com/gitnostr/grasp)
