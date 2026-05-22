# File Fetch Flow (Bridge + gittr UI)

How **git-nostr-bridge** mirrors repos on disk and how **[gittr](https://github.com/arbadacarbaYK/gittr)** reads them. UI fetch order (localStorage → embedded → bridge disk → GRASP shallow → GitHub/GitLab): **[`docs/FILE_FETCHING_INSIGHTS.md`](https://github.com/arbadacarbaYK/gittr/blob/main/docs/FILE_FETCHING_INSIGHTS.md)**.

## 1. Bridge + shared disk

| API / path | What it does |
| --- | --- |
| Relays + optional **`POST /api/event`** (`BRIDGE_HTTP_PORT`) | Mirror bare repos under `repositoryDir/{pubkey}/{repo}.git` |
| **`GET /api/nostr/repo/files`** (gittr Next.js) | File tree from that directory (`GIT_NOSTR_BRIDGE_REPOS_DIR`) |
| **`GET /api/nostr/repo/file-content`** (gittr Next.js) | Blob content; `path=` must be URL-encoded (UTF-8 filenames) |
| **`GET /api/nostr/repo/commits`** (gittr Next.js) | `git log` on the bare mirror for the Commits tab |
| **`POST /api/nostr/repo/clone`** (gittr Next.js) | Trigger bare clone from a `clone[]` HTTPS URL |
| **`GET /api/git/repo-files?sourceUrl=`** (gittr Next.js) | Shallow clone of a remote URL into a temp dir (GRASP/upstream) |

Production: web UI **`gittr.space`**, git SSH/HTTPS **`git.gittr.space`**.

## 2. Code tab (file tree)

See [`FILE_FETCHING_INSIGHTS.md`](https://github.com/arbadacarbaYK/gittr/blob/main/docs/FILE_FETCHING_INSIGHTS.md). Implementation: `ui/src/lib/utils/git-source-fetcher.ts`, `ui/src/app/[entity]/[repo]/page.tsx`.

## 3. Shared branch, Commits, Issues, PRs

- **One `?branch=`** across Code, Commits, Issues, PRs (`resolveSharedRepoBranch` in `ui/src/lib/repos/repo-file-tree-branch.ts`).
- **Commits tab:** **`/api/nostr/repo/commits`** on the bare repo (+ GitHub REST fallback when imported).
- **Issues / PRs:** Nostr events on relays; file bytes use the Code-tab paths when needed.
- **Push to Nostr:** `git push` updates the bare repo; the UI publishes **30617 / 30618** to relays.

## 4. Bridge production features

HTTP **`/api/event`**, deduplication, watch-all (`gitRepoOwners: []`): [gittr-enhancements.md](gittr-enhancements.md).

## 5. Other Nostr git clients

Publish **30617** (and **51** where needed), point readers at the same `repositoryDir`, or call gittr’s Next.js routes if co-hosted.
