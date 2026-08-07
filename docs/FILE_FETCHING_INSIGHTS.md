# File fetching (reference)

How the UI loads repo trees and file content. Implementation lives in:

- `ui/src/lib/utils/git-source-fetcher.ts` — classify clones, list trees, GRASP / self-hosted shallow clone
- `ui/src/components/repo/RepoCodePage.tsx` — Code tab orchestration (route `page.tsx` is a thin wrapper)
- `ui/src/pages/api/nostr/repo/files.ts`, `file-content.ts`, `clone.ts`, `tree-last-commits.ts`, `sync-from-source.ts`
- `ui/src/pages/api/git/repo-files.ts`, `file-content.ts` — server-side `git clone` for any reachable HTTP(S) remote
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
7. Well-known GRASP mirrors are **inferred after Nostr EOSE *or* the 3s timeout** if `clone[]` is still empty (`appendInferredGraspCloneUrls` / `buildGraspHttpsCloneCandidates`) — never guessed before the announcement query starts
8. **Bridge-only success still fills the sidebar** — if files come from `GET /api/nostr/repo/files` while the 30617 event was slow/missing, merge event clones (when known) or inferred GRASP HTTPS URLs into `repoData.clone` / localStorage so Clone URL is not blank
9. Repo event queries always include NIP-34 discovery relays (`relay.ngit.dev`, shakespeare, nostrhub, gittr) even when they are not in the viewer’s social relay list — many batch-imported / ngit-published repos announce only there

**Single file**

1. Embedded in event / local cache  
2. Bridge `GET /api/nostr/repo/file-content`  
3. Upstream `GET /api/git/file-content?sourceUrl=…`  
4. Binary → base64 / data URL in the browser  

**Folder README** (browsing a directory without opening a file)

Same branch as the loaded tree: honor `?branch=` in the URL, then `repoData.filesBranch` (from multifetch `resolvedBranch`). Do **not** strip a non-default `?branch=` back to `main` — that forced README onto missing branches while the tree loaded `feat/*` via bridge HEAD.

`shouldPreferUpstreamContent` is **forge-only** (GitHub / GitLab.com / Codeberg). GRASP-only / home `http://IP:port` clones are **not** treated as upstream, so README goes to bridge first instead of a 400/404 storm.

Fallback order: local overrides → (forge upstream if any) → bridge `file-content` → `successfulSources` (HTTPS, with `resolvedBranch`) → remaining `clone[]` (skips bare `http://IP` hosts; skipped entirely once multifetch already recorded successful sources) → cached `gittr_files` row content.

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

**Wrong default branch (common on foreign mirrors):** UI often asks for `main`, but the bare repo’s HEAD may be `develop` / a feature branch with **no** `main`. `/api/nostr/repo/files` falls back to `main`↔`master`, then the bare repo’s symbolic-ref HEAD (or first head). Success responses include the resolved `branch`. True “branch missing” 404s include `defaultBranch` + `availableBranches`; the client retries that once and **does not** start clone/poll storms. `includeSizes` defaults off (pass `includeSizes=1` when needed) so huge trees do not run per-file `cat-file`.

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
- **UI Push to Nostr** with a forge `source` and **no** local edits (`hasUnpushedEdits` false) must **sync the bare tip from the forge** (`POST /api/nostr/repo/sync-from-source`) and announce those SHAs in kind **30618** — not invent a `Push from gittr` empty commit. Refetch filling local overrides is a **cache**, not dirty.
- **MCP** `createRepo` / `mirrorRepo` must advertise the full GRASP push clone set (`buildFullGraspCloneUrls`) — never derive `clone[]` from a capped relay publish list. Forge URLs stay in `source` / `forkedFrom` only.

## Sidebar “Clone URL (event)”

Keep forge `source` + primary (`git.gittr.space`) + every host on `GRASP_SERVERS_FOR_PUSHING`. Do **not** hide shakespeare / gitnostr / ngit just because primary is present. Helper-tools snippet must stay in sync (`snippets/filter-display-clone-urls`, synced 2026-08-07).

## Richer local tree vs SOURCE (64 vs 62)

Console `Keeping richer local tree` / `Skipping persist` is **intentional for GRASP partial listings** (avoids wiping folders). It is **wrong** when a declared NIP-34 **`source` / `forkedFrom`** is authoritative and returned fewer paths (deletes upstream).

Shrink is allowed when:
- `source` or `forkedFrom` is an **external git** (GitHub, GitLab.com, Codeberg, Gitea / other self-hosted HTTPS), **or**
- the user clicked **Refetch** (`[Refetch]` persist)

Not limited to github.com. **Nostr-only** repos (no `source`/`forkedFrom`) keep the no-shrink safety so a thin GRASP listing cannot erase a richer tree. See `allowShrinkToSourceUpstreamTree` + `npm run test:regressions`.

**Code-tab display (`safeFiles`)** must match that policy via `selectDisplayRepoFileTree`: after a folder upload, **never** pick the *shortest* candidate (that hid root `README.md` when a thinner bridge listing arrived). With `hasUnpushedEdits`, union network + local index (local last). Upload must not delete a flat basename that is also in the **same** upload batch (`README.md` + `docs/README.md`).

`no files field in event` and `forge-releases` 404 are **normal** (NIP-34 metadata only; no Zapstore APK).

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
