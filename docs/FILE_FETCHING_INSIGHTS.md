# File fetching (reference)

This file is about **how Code-tab files load**. The repo **Insights** tab (`/{entity}/{repo}/insights`) is a different screen: it reads the same file tree (`fileCount` / `gittr_files`), issue/PR stores, commit cache, and the header’s live Nostr star count. Live refresh also hits `/api/nostr/repo/files` + `/api/nostr/repo/commits` (including `totalCount` from `git rev-list --count`) and, when the header already knows a GitHub upstream, `/api/github/proxy` for languages, blob count, and commit totals. Language bars are hidden when empty — no “coming soon”.

How the UI loads repo trees and file content. Implementation lives in:

- `ui/src/lib/utils/git-source-fetcher.ts` — classify clones, list trees, GRASP / self-hosted shallow clone
- `ui/src/components/repo/RepoCodePage.tsx` — Code tab orchestration (route `page.tsx` is a thin wrapper)
- `ui/src/pages/api/nostr/repo/files.ts`, `file-content.ts`, `clone.ts`, `tree-last-commits.ts`, `sync-from-source.ts`
- `ui/src/pages/api/git/repo-files.ts`, `file-content.ts` — server-side `git clone` for listing; `file-content` also `git show` when forge raw URLs are missing (`ui/src/lib/git/shallow-clone-remote.ts`)
- `ui/src/lib/git/bare-repo-tree-last-commits.ts` — batched last-commit dates for the Code file list
- `ui/src/lib/utils/filter-display-clone-urls.ts` — sidebar “Clone URL (event)” filter (keeps pushable GRASP mirrors)

## Security (outbound remotes)

Clone / import / file-fetch APIs reject private, loopback, link-local, and metadata hosts (and DNS that resolves to them). Public HTTPS remotes still work: GitHub, GitLab, Codeberg, GRASP (`relay.ngit.dev`, `git.gittr.space`, …), and self-hosted forges reachable from the server. Local-only NAS URLs (`*.local`, `192.168.*`) will not be fetched by the gittr server.

## Order (simplified)

**File tree**

1. Browser `localStorage` (owned / edited repos)
2. Embedded files in Nostr repo event (legacy/small)
3. Wait for latest kind **30617** (and related) on relays — **published `clone[]` / `source` tags are authoritative**
4. Parallel over those URLs via `fetchFilesFromMultipleSources`:
   - **Prefer non-GRASP remotes first** (GitHub, GitLab, Codeberg, Freebox/NAS, other self-hosted) when mixed with GRASP mirrors — avoids burning ~45s on dead ngit hosts
   - GitHub / `source` may be pulled further ahead via `prioritizeUpstreamCloneUrls`
   - Per URL: bridge `GET /api/nostr/repo/files`, or forge / **`GET /api/git/repo-files?sourceUrl=…`**
5. **GRASP** (`nostr-git`, known GRASP host + `/npub1…/repo`): empty tree or 404 → shallow clone via `repo-files`, then optional `POST /api/nostr/repo/clone` + bridge retry
6. **Self-hosted** (including **non-GRASP** hosts that reuse a `/npub1…/repo` path, e.g. home Freebox): **`repo-files` only** — do **not** skip as “not GRASP”
7. Well-known GRASP mirrors are **inferred only after a matching kind 30617 arrived with empty `clone[]`** (metadata-only repos). The 3s timeout does **not** invent `git.gittr.space` / ngit while the announcement is still in flight. Last-resort inference is only when the 20s subscription ends and no 30617 was seen (`shouldInferGraspCloneUrls`). Never guessed before the announcement query starts. Published `clone` tags (including self-hosted HTTPS such as `https://host/git/repo.git`) are used as-is — they are **not** copied onto `source`. Missing GitHub `sourceUrl` on a GRASP-only repo is normal — do not treat that as a failed tree. After files are in `gittr_files` / the live ref, do **not** clear `fileFetchAttemptedRef` and start another multifetch. `mustRefresh` is GitHub-upstream only — **not** every npub route (that loop starved Amber bunker sockets on NightBloom-style clones). Late clone tags must **not** re-run the whole file-fetch effect while a fetch is in flight (that froze Push / tab clicks until README finished). README markdown is idle-gated + deferred (`RepoFolderReadmeMarkdown`) so tree dates/sizes do not re-parse the whole README on the main thread. When Amber/NIP-46 is paired, bunker warm runs **in parallel** with multifetch (no browse-blocking await); `fetchFilesFromMultipleSources` uses `maxConcurrent: 2` so HTTP does not starve bunker WebSockets. `ensureRpcHealthy` waits for in-flight git-source HTTP to drain (`waitForGitSourceHttpIdle`) before dialing bunker relays. Soft tab nav has an 8s hard fallback if `router.push` stalls during hydrate (`appNavigate`); that fallback must **not** assign `/` when the address bar already shows a repo Code path.

### Homepage → Code bounce (README then home)

Opening a **never-visited** repo from the homepage used to load the tree, show the README, then jump back to `/`. Cause: homepage used Next `<Link>` (soft), then Code called `history.replaceState(null, "", …?branch=)` when the tree resolved. Next 15 patches `replaceState`: `null` state dispatches `ACTION_RESTORE` with whatever tree is still in `history.state` — still the homepage during that hydrate window. Fix: `replaceAppUrl` / `pushAppUrl` keep `__NA` (skip restore) and refuse to rewrite while the browser is still on `/`. Homepage **Most Active** / **Recent repositories** use a full document load, same as Recent Activity.
8. **Bridge-only success still fills the sidebar** — if files come from `GET /api/nostr/repo/files` while the 30617 event was slow/missing, merge event clones (when known) into `repoData.clone`. Do not invent GRASP URLs for the sidebar until the announcement is confirmed empty.
9. Repo event queries always include NIP-34 discovery relays (`relay.ngit.dev`, shakespeare, nostrhub, gittr) even when they are not in the viewer’s social relay list — many batch-imported / ngit-published repos announce only there

**Single file** (`openFile` → `fetchGithubRaw`) — must match folder README winners:

1. Local overrides / IDB (`resolveLocalOverrideBody`, including storage alias)
2. Multifetch **`successfulSources`** tip (`/api/git/file-content`) when present
3. If **no** forge upstream and **no** successfulSources yet: bridge `GET /api/nostr/repo/file-content` (npub/hex routes; sticky-skip after full 404)
4. Embedded / indexed listing body when present
5. Forge `GET /api/git/file-content?sourceUrl=…` when `shouldPreferUpstreamContent` (GitHub / GitLab.com / Codeberg)
6. Bridge again / remaining `clone[]` / shallow clone recovery
7. Binary → base64 / data URL in the browser  

Do **not** bridge-first on forge-import npub routes — that made folder README (forge tip) disagree with click-to-open (stale bare). Do **not** bridge-first once GRASP multifetch already won a foreign clone (pyramid etc.) — that was the README 404 storm on `main`/`master`.

**Refetch content hydrate** (after `/api/import` returns metadata-only files)

Import deliberately omits bodies (response size). For **small** trees (&lt; 50 files), Refetch may hydrate a few small text files into `gittr_overrides__*` via same-origin **`GET /api/git/file-content`** (batched ~15). For **large** forge trees (≥ 50 files), Refetch **skips** that flood (it was causing GitHub/proxy HTTP 429) and leaves Push to announce the forge tip via **`POST /api/nostr/repo/sync-from-source`** (one server `git fetch`). Do **not** `fetch(raw.githubusercontent.com/…)` from the browser — GitHub raw has no CORS for gittr (OPTIONS 403 / NetworkError).

Forge Refetch must **not** set `hasUnpushedEdits` — catching up to GitHub is tip sync, not a local rewrite. Owner **Push to Nostr** still works; the post-refetch banner reminds you to announce.

**Folder README** (browsing a directory without opening a file)

Same branch as the loaded tree: honor `?branch=` in the URL, then `repoData.filesBranch` (from multifetch `resolvedBranch`). Do **not** strip a non-default `?branch=` back to `main` — that forced README onto missing branches while the tree loaded `feat/*` via bridge HEAD.

`shouldPreferUpstreamContent` is **forge-only** (GitHub / GitLab.com / Codeberg). GRASP-only / home `http://IP:port` clones are **not** treated as upstream, so README goes to bridge first instead of a 400/404 storm.

Fallback order: local overrides → (forge upstream if any) → **`successfulSources` / winning clones first** (honor `resolvedBranch`) → bridge `file-content` only when no multifetch winner yet (sticky-skip after a full 404) → remaining `clone[]` (skips bare `http://IP` hosts; skipped entirely once multifetch already recorded successful sources) → cached `gittr_files` row content. Tip README **size** is part of the reload key so bridge→GitHub listing upgrades re-fetch the body. Do **not** restart that README load when extra clones succeed later (`successfulSources.length` must not be an effect dep) — the first winner is enough. If the tree listing is still empty or shallow, still GET `README.md` from that winner instead of waiting for the full multifetch race.

### Code-tab README matrix (all four content states)

Folder preview and click-to-open **must** show the same body. Winners after overrides:

| State | What it means | README / openFile winner |
| --- | --- | --- |
| **Local only** | Browser drafts / `hasUnpushedEdits` / overrides / IDB; may have no live bare | **Overrides / IDB** first; else indexed `gittr_files` body; network usually empty |
| **Nostr / GRASP only** | 30617 `clone[]` → `git.gittr.space` or other GRASP; **no** forge `source` | **Bridge** `file-content` (then GRASP HTTPS / indexed) |
| **External git source** | Forge `sourceUrl` / `shouldPreferUpstreamContent` | **Forge** `/api/git/file-content` tip (bridge is fallback only) |
| **On gittr bridge** | Bare under `reposDir/{pubkey}/{repo}.git` | Bridge when no forge authority; if also forge-imported, treat as **External** (forge tip) so bare lag does not look like a “wrong README” |

Presentation: normal READMEs (~≤200 KB) idle-auto-format; only enormous bodies need **Show formatted README** (e.g. fiatjaf/nak ~87 KB must auto-format — the old 48 KB gate left it as a raw stub).

**README / in-repo media:** relative images (gif/png/…) must prefer `gittr_overrides` via `localOverrideDisplayUrl` before forge raw or bridge tip — otherwise an Upload overwrite looks “stuck” on the old asset until Push (and forge mirrors never show the draft). Same for Code-tab `openFile` (binary by extension; do not require `repo.files.isBinary` after upload strips that array).

**Large / binary Upload drafts:** bodies that would blow the ~5 MB `localStorage` quota (GIFs, folder packs) are stored in IndexedDB (`gittr-overrides-v1`); `gittr_overrides__*` only keeps a small `__gittr_idb__:mime` pointer. Flush own/others also drops matching IDB blobs. Push / Pages publish expand pointers via `loadRepoOverridesResolved`. “Flush emptied the catalog but upload still QuotaExceeded” was this path — not a failed flush.

**Mental model:** `gittr_overrides__*` may hold either inline UTF-8 or a tiny `__gittr_idb__:mime` pointer. Real large/binary bodies live in IndexedDB (`gittr-overrides-v1`). Any code that **reads file contents** for display/merge/publish must use `loadRepoOverridesResolved` / `resolveLocalOverrideBody` (Push, Pages/nsite publish, README, openFile, blame, dependencies, PR merge base). Presence-only checks and key deletion can keep using raw `loadRepoOverrides`.

Multifetch prefers reachable remotes before GRASP, but sorts bare `http://IP:port` home clones **after** HTTPS GRASP mirrors so a dead LAN host does not race ahead of working mirrors.

## Classification (`parseGitSource`)

| Pattern | Type | Fetch path |
| --- | --- | --- |
| Known GRASP host + `/npub1…/repo` | `nostr-git` | Bridge → `repo-files` → optional bare mirror |
| Other host + `/npub1…/repo` (home Freebox, NAS, …) | `self-hosted-git` | **`repo-files` only** |
| github.com / gitlab.com / codeberg.org | forge types | `repo-files` / forge APIs |
| Other `https://host/owner/repo` | `self-hosted-git` | `repo-files` |

## SSH clone URLs

`git@host:path` is normalized to HTTPS for HTTP APIs where needed. Generic `user@host:path` (no `://`) is treated as self-hosted git for `/api/git/*`.

## Iris Hashtree (`htree://`)

Some NIP-34 announces (e.g. from [Iris Git](https://git.iris.to/)) use:

- `clone` → `htree://npub1…/repo` (requires `git-remote-htree` on the machine; not HTTPS `git-upload-pack`)
- `web` → `https://git.iris.to/#/npub1…/repo` (browser SPA only)

gittr **recognizes** Hashtree clones (`parseGitSource` type `hashtree`) and labels Iris `web` links as **Iris Git**. When every clone URL is Hashtree-only, the Code page shows an Iris CTA + copyable `git clone htree://…` and **skips** bridge / multi-source retries (the bridge cannot clone `htree://`). In-browser Hashtree tree listing is not implemented yet.

## GRASP (foreign / nostr-git)

Many GRASP hosts have no file-browse REST API — only `git clone` over HTTPS. Per **clone URL** (in parallel with others), `fetchFromNostrGit` tries:

1. **On-disk bridge** — `GET /api/nostr/repo/files` (`reposDir/{pubkey}/{repo}.git`)
2. **Remote shallow clone** — `GET /api/git/repo-files?sourceUrl=<that clone HTTPS URL>` (temp dir, same as import); **returns files to the UI immediately** when the remote has commits
3. **Bare mirror** — `POST /api/nostr/repo/clone`, then **await** bridge reads (poll ~12s); background poll + `grasp-repo-cloned` if still slow
4. After a successful shallow clone, bare mirror runs **in the background** so the next visit hits the bridge

**URL classification (Aug 2026):** `https://host/grasp/npub…/repo.git` (path-prefixed home GRASP, e.g. laantungir.net) is treated as GRASP/`nostr-git` via `hasGraspPathPrefix` / `parseGraspPathClone` — not as “unknown non-GRASP”. Empty remotes (info/refs with no heads) still clone-fail with **no valid HEAD**; a forge `source` tag or a non-empty GRASP mirror is required for content.

Parallel `clone[]` sources use `Promise.race`: **first mirror that returns a non-empty tree wins**. A dead mirror (502) does not block a working one (e.g. `relay.ngit.dev`).

Empty bare dir with no branches: nostr files API may return `files: []` — step 2–3 still run.

**Wrong default branch (common on foreign mirrors):** UI often asks for `main`, but the bare repo’s HEAD may be `develop` / a feature branch with **no** `main`. `/api/nostr/repo/files`, `/api/nostr/repo/file-content`, **and** `/api/nostr/repo/tree-last-commits` fall back to `main`↔`master`, then the bare repo’s symbolic-ref HEAD (or first heads), and try other heads if the path is missing on the first match. Success responses include the resolved `branch`. True “branch missing” 404s include `defaultBranch` + `availableBranches`; the client retries that once and **does not** start clone/poll storms. File sizes come from `git ls-tree -l` / `-r -l` (one pass — default on). Pass `includeSizes=0` only to omit size fields.

**Sidebar Git Server / Clone URL:** Do not wait for `effectiveSourceUrl` (forge `source` tag) — many native Nostr repos never have one (`Nostr query timeout - no source URL found` is normal). Show clone hosts from `repoData.clone`, `successfulSources`, or inferred GRASP HTTPS paths as soon as the bridge/multi-source tree lands. Persist `clone[]` beside `fileCount` so soft nav does not require a hard refresh.

**Huge trees (e.g. Trezor Suite, 10k+ files):** A naive soft-cap after dirs-first sort kept only directories → every subfolder looked empty. Now root listings above the threshold return `listing: "shallow"` (one level) plus `truncated: true` / `totalFileCount`. Folder navigation calls `GET /api/nostr/repo/files?...&path=packages/suite` for that directory’s children.

### Newest copy: what we do and do not compare

| Question | Behaviour |
|----------|-----------|
| Newest **Nostr repo announcement** (30617)? | **Yes** — subscriptions keep the latest `created_at` event; `clone[]` / `relays` tags come from that snapshot. |
| Newest **tree across GRASP mirrors**? | **Not yet** — we do not compare `HEAD` / kind **30618** state across every clone URL and pick the newest commit. We use **first successful fetch** in the parallel race (after non-GRASP / GitHub-first when applicable). |
| GitHub / `source` upstream? | **Yes** when present — `prioritizeUpstreamCloneUrls` tries GitHub first via **`/api/git/repo-files`** (server `git clone`, no REST quota). GitHub REST proxy is fallback only. A red GitHub row in “Git servers” after a **403** usually means **API rate limit**, not “repo is private”. |

Improvement backlog: optional pass to compare commit SHAs from each successful shallow clone (or latest 30618) and show the newest branch tip.

## GitHub mirror

Repos with a GitHub `source` / `clone` URL often treat GitHub as authoritative for the tree unless `hasUnpushedEdits`. **About / description does not** — an owner-set About (Settings → Description, or a non-placeholder NIP-34 `description` tag) must not be overwritten by GitHub hub hydrate (`hydrateRepoFromGithub`) or the Code-page GitHub About fill. GitHub may only fill empty / placeholder About text (`Repository: <slug>`, blank, or `Imported from …`).

## Ops

- Set `GIT_NOSTR_BRIDGE_REPOS_DIR` if Next and bridge run as different users.
- Import size: Next API ~4 MB response cap — huge monorepos may fail; trim assets.
- **`GET /api/git/repo-files` runs on the gittr server** (e.g. Hetzner for gittr.space). Home Freebox / NAS / LAN URLs in `clone[]` must be **DNS-resolvable and reachable from that host**, not only from the visitor’s browser. Private LAN-only remotes will show empty Code until a public clone (gittr / ngit / forge) is also published.

Troubleshooting pushes: [BRIDGE_PUSH_DEBUGGING.md](BRIDGE_PUSH_DEBUGGING.md).

## Code file list timestamps

`GET /api/nostr/repo/tree-last-commits?ownerPubkey&repo&branch&path=` returns last-commit message/author/time for each **direct child** of the current folder on the selected tip/branch (one capped `git log --name-only` on the bare mirror). The Code tab shows message + relative time next to size.

**Parser regression:** never use `%x00` as a record separator with `--name-only` — NUL ends the pretty line and leaves path names as orphan “records” (empty dates). Use a text marker (`>>>COMMIT<<<`) — see `parseTreeLastCommitLog` + `ui` `npm run test:regressions`.

## Push tip fidelity (SSH / UI / MCP)

- **SSH `git push`** and **HTTPS smart-HTTP** write objects into the bridge bare repo; tips are real git SHAs.
- **UI Push to Nostr** with a forge `source` and **no** local edits (`hasUnpushedEdits` false) must **sync the bare tip from the forge** (`POST /api/nostr/repo/sync-from-source`) and announce those SHAs in kind **30618** — not invent a `Push from gittr` empty commit. Refetch filling local overrides is a **cache**, not dirty. After forge Refetch (especially large trees), Push prefers the same bridge sync even if a stale dirty flag / post-refetch hint is present — never N× `/api/git/file-content` for hundreds of paths. **Refetch → delete file(s) → Push** on a metadata-only tree (no override bodies) uses the same one-shot sync, then applies `deletedPaths` on the bridge — do not re-fetch every remaining path from GitHub (HTTP 429).
- **MCP** `createRepo` / `mirrorRepo` must advertise the full GRASP push clone set (`buildFullGraspCloneUrls`) — never derive `clone[]` from a capped relay publish list. Forge URLs stay in `source` only (`forkedFrom` is a real parent, not a copy of the mirror URL).

## Sidebar “Clone URL (event)”

Keep forge `source` + primary (`git.gittr.space`) + every host on `GRASP_SERVERS_FOR_PUSHING`. Do **not** hide shakespeare / gitnostr / ngit just because primary is present. Helper-tools snippet must stay in sync (`snippets/filter-display-clone-urls`, synced 2026-08-07).

**Git Server** sidebar: if the announcement has a real forge `source` / `forkedFrom` (GitHub, GitLab, Codeberg, Gitea, …), that URL is the Git Server — **do not** bump `git.gittr.space` just because it also appears on `clone[]`. The gittr-host preference is only for **Nostr-only** repos that listed several GRASP clones including `git.gittr.space` (so a gittr Push is not labeled as ngit). Never invent gittr if it is not on the event. Only timeout-inferred GRASP URLs that are *not* on the event are ignored (so a slow announcement that only lists shakespeare is not overridden by a guessed gittr host). On this deployment, **`git.gittr.space` is the bridge git host**; **`relay.gittr.space` is the Nostr relay** (Pyramid). It stays in `KNOWN_GRASP_DOMAINS` for *reading* other people’s clone tags, but is **not** on `GRASP_SERVERS_FOR_PUSHING`.

After **Clear local / flush**, File Fetch must still hydrate the sidebar from the live 30617: description, `source`/`forkedFrom` (or GitHub later on `clone`), clone tags, and the announcement event id. Do **not** gate that hydrate on a `source` tag being present — that made imported GitHub repos look ngit-only (no Refetch, no Event ID, About empty). Persist those fields onto `gittr_repos` (`persistRepoAnnouncementMeta`) so My Repositories does not keep a `status: "local"` stub. Preferring gittr as Git Server must keep `hasExternalForgeSource` true when GitHub is on the event. Persist **`sourceUrl` only from `source` / `forkedFrom` / forge `clone` tags** — never from a docs `web`/`link` to github.com (that would flip a Nostr-only Push onto sync-from-source). File upload still follows `hasUnpushedEdits`: dirty Nostr-only repos rewrite locally; clean GitHub imports still `sync-from-source`.

**My Repositories LOCAL after flush:** `/api/nostr/profile-repos` already has `lastNostrEventId` + description. Merge local stubs by decoded owner hex (npub `entity` vs hex `ownerPubkey`), keep `syncedFromNostr` / event id, and refill even when several owned rows exist but lack announcement ids. Event ID on the Code page comes from the live 30617 (not a later 30618 state event). Soft-delete liveness is latest-30617-only: a 30618-only leftover must not keep a deleted repo in the live list or the My Repos heal popup.

**Extensionless files** (`LICENSE`, `Makefile`, `elmcanyon`): the download name is the git path — do **not** invent `.txt`. Git hosts often send `Content-Type: application/octet-stream`; `/api/git/file-content` and `/api/nostr/repo/file-content` sniff UTF-8 so those files preview as text instead of “Binary file preview not available”.

**Public profiles** (`GET /api/nostr/profile-repos`) query `PROFILE_REPOS_RELAYS` (stats pool + NIP-34 discovery: ngit, shakespeare, nostrhub, gitnostr, …) and wait for **per-relay EOSE**, not a raw callback count. The slim `PLATFORM_STATS_RELAYS` set alone under-counts NostrHub publishers whose 30617s never land on `relay.gittr.space`. The repo grid is that catalog for **every** visitor (logged-in or not) — `enrichNetworkProfileRepos` must not add `gittr_repos` cache-only rows, and `unionProfileRepoCatalog` must not shrink a larger live list when the API returns 0–1. The profile page also subscribes live on `profileRepoRelaysForClient` (app relays + the same NIP-34 discovery list Code-tab file fetch uses). 30617 `limit` is 2000, scan timeout 15s, timed-out scans are `no-store`. Private announcements stay on My Repos.

**One announcement lookup for chrome + files:** File fetch order (localStorage → published `clone[]`/`source` → bridge → forge) is unchanged. Star, Public/Private, Settings visibility, Refetch/forge Issues/PRs/Releases, Fork, Commits, and new Issue/PR publish must reuse that same 30617 (`resolveLiveRepoAnnouncement` / `fetchRepoCloneHintsFromProfile`). Do not rediscover the repo on the browser’s default relay list only — that is why a foreign GRASP repo can show files while Star says “not on relays yet”. The gittr bridge `GET /api/nostr/repo/files` **404s on purpose** when `clone[]` does not include `git.gittr.space`; the UI then reads the owner’s announced clone host. Do **not** add every foreign GRASP host to `KNOWN_GRASP_DOMAINS` just to make Commits work (known GRASP hosts that are not on the push allowlist are **dropped** from the sidebar).

**Repo header Watch / Star / GitHub buttons:** those effects must depend on stable ids (`ownerPubkey`, repo slug, first GitHub spec), not the whole `repo` object. File fetch / README persist used to fire `gittr:repos-updated` on every identical `sourceUrl` write, which remounted Star as “Looking up…” every few seconds and unmounted the GitHub count. `persistGithubSourceOnRepo` no-ops when unchanged; Star keeps the “Star” label while an id is resolved in the background.

## Richer local tree vs SOURCE (64 vs 62)

Console `Keeping richer local tree` / `Skipping persist` is **intentional for GRASP partial listings** (avoids wiping folders). It is **wrong** when a declared NIP-34 **`source` / `forkedFrom`** is authoritative and returned fewer paths (deletes upstream).

Shrink is allowed when:
- `source` or `forkedFrom` is an **external git** (GitHub, GitLab.com, Codeberg, Gitea / other self-hosted HTTPS), **or**
- the user clicked **Refetch** (`[Refetch]` persist)

Not limited to github.com. **Nostr-only** repos (no `source`/`forkedFrom`) keep the no-shrink safety so a thin GRASP listing cannot erase a richer tree. See `allowShrinkToSourceUpstreamTree` + `npm run test:regressions`.

**Code-tab display (`safeFiles`)** must match that policy via `selectDisplayRepoFileTree`: after a folder upload, **never** pick the *shortest* candidate (that hid root `README.md` when a thinner bridge listing arrived). With `hasUnpushedEdits`, union network + local index (local last). Upload must not delete a flat basename that is also in the **same** upload batch (`README.md` + `docs/README.md`).

**Size overlay on shrink-skip (Aug 2026):** When bridge returns fewer paths than localStorage (`Skipping persist: got 1329 … already has 1349`), we still **merge sizes/shas** from the thinner listing onto the kept tree and persist that overlay. `mergeRepoFileIndexes` also attaches `size` onto contentful rows that previously had body but no size. Dates still come only from `tree-last-commits` on the bare tip (needs a live bridge API — mass nginx **502** during frontend restarts blanks dates until the next successful fetch).

**Crawler path nests:** Empty folders must not render the **root** README with a nested `basePath` (that rewrote relative `src/…` links into deeper `?path=` URLs). `isAbsurdRepoPath` / `sanitizeRepoNavPath` reject deep/`src/…/src/…` loops in markdown hrefs, Code navigation, and file-content APIs.

`no files field in event` is **normal** (NIP-34 metadata only). `forge-releases` with `no_releases`/`no_apk` returns **200** + `ok:false` (not a red Network 404) when the repo has no Zapstore APK release. The repo **Releases** tab also lists **NIP-82** (kinds `30063`/`3063`, including Blossom URLs) for GRASP-only repos — that path is separate from Code-tab file fetch and does not change clone/`repo-files` order.

## Regression tests (run these — smoke alone is not enough)

| Suite | Command |
| --- | --- |
| UI tip / clone / timestamps | `cd ui && npm run test:regressions` |
| MCP clone set + forge match | `cd ../gittr-mcp && npm run test:regressions` |
| Full MCP package | `cd ../gittr-mcp && npm test` |
| Live MCP stdio (optional) | `cd ../gittr-mcp && npm run test:mcp-stdio` |

## Integrators (helper-tools / MCP)

- Snippets: [gittr-helper-tools `snippets/file-fetching`](https://github.com/arbadacarbaYK/gittr-helper-tools) — keep `parseGitSource` in sync with this file.
- Also sync `snippets/filter-display-clone-urls` when changing sidebar policy.
- MCP `getFile` / bridge reads are **not** full Code-tab parity (bridge + hardcoded GRASP raw URLs). Prefer `bridgeListFiles` after `importRemoteToBridge` / `mirrorRepo`, or resolve **30617 `clone[]`** and call the same HTTP APIs the UI uses. See gittr-mcp `docs/MCP-GITTR-PARITY.md`.
