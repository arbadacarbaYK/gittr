# File Fetch Flow (Bridge + gittr UI)

How **git-nostr-bridge** mirrors repos on disk and how **[gittr](https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr?branch=main)** reads them.

Canonical UI order (localStorage → embedded → **published `clone[]`/`source`** → bridge / `repo-files` → forge APIs; non-GRASP before GRASP; EOSE before inferred GRASP): **[`docs/FILE_FETCHING_INSIGHTS.md`](https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr?file=docs/FILE_FETCHING_INSIGHTS.md&branch=main)**.

## 1. Bridge + shared disk

| API / path | What it does |
| --- | --- |
| Relays + optional **`POST /api/event`** (`BRIDGE_HTTP_PORT`) | Mirror bare repos under `repositoryDir/{pubkey}/{repo}.git` |
| **`GET /api/nostr/repo/files`** (gittr Next.js) | File tree from that directory (`GIT_NOSTR_BRIDGE_REPOS_DIR`) |
| **`GET /api/nostr/repo/file-content`** (gittr Next.js) | Blob content; `path=` must be URL-encoded (UTF-8 filenames) |
| **`GET /api/nostr/repo/commits`** (gittr Next.js) | `git log` on the bare mirror for the Commits tab |
| **`GET /api/nostr/repo/tree-last-commits`** (gittr Next.js) | Batched last-commit message/time per folder child for the Code file list (same tip/branch as the tree) |
| **`POST /api/nostr/repo/sync-from-source`** (gittr Next.js) | Force bare mirror to exact forge tip before announcing 30618 (clean Push) |
| **`POST /api/nostr/repo/clone`** (gittr Next.js) | Trigger bare clone from a `clone[]` HTTPS URL (GRASP / public remotes) |
| **`GET /api/git/repo-files?sourceUrl=`** (gittr Next.js) | Shallow clone of a remote URL into a temp dir — **GRASP, forge upstream, and self-hosted HTTPS** (including `/npub1…/repo` on non-GRASP hosts such as a home Freebox) |

Production: web UI **`gittr.space`**, git SSH/HTTPS **`git.gittr.space`**.  
`repo-files` runs **on the app host** — the `sourceUrl` must be reachable from that server (not only from the user’s laptop).

## 2. Code tab (file tree)

See [`FILE_FETCHING_INSIGHTS.md`](https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr?file=docs/FILE_FETCHING_INSIGHTS.md&branch=main).

Implementation: `ui/src/lib/utils/git-source-fetcher.ts`, `ui/src/components/repo/RepoCodePage.tsx`.

## 3. Shared branch, Commits, Issues, PRs

- **One `?branch=`** across Code, Commits, Issues, PRs (`resolveSharedRepoBranch` in `ui/src/lib/repos/repo-file-tree-branch.ts`).
- **Commits tab:** resolve npub/hex owner → soft-refresh every visit (localStorage is optimistic only, not authoritative) → **`/api/nostr/repo/commits`** / mirror from `clone[]` / GRASP → GitHub via `resolveGithubUpstreamForTabs`; keep the richest list so a 1-commit GRASP tip cannot wipe fuller history.
- **Issues / PRs:** Nostr events on relays; file bytes use the Code-tab paths when needed.
- **Push to Nostr:** with a forge `source` and no local edits, sync the bare tip from upstream then publish **30617 / 30618** (do not invent empty “Push from gittr” commits). SSH/`git push` already writes real tips into the bare repo.
- **Clone URL sidebar:** shows forge `source` plus all pushable GRASP hosts from the event (not primary-only).
- **File list dates:** `tree-last-commits` for the selected `?branch=` tip.

## 4. Bridge production features

HTTP **`/api/event`**, deduplication, watch-all (`gitRepoOwners: []`): [gittr-enhancements.md](gittr-enhancements.md).

## 5. Other Nostr git clients

Publish **30617** (and **51** where needed), point readers at the same `repositoryDir`, or call gittr’s Next.js routes if co-hosted. Match gittr’s clone-URL classification: **known GRASP + `/npub/` → nostr-git**; **other hosts + `/npub/` → self-hosted `repo-files`**.
