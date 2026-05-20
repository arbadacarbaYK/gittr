# File fetching (reference)

How the UI loads repo trees and file content. Implementation lives in:

- `ui/src/lib/utils/git-source-fetcher.ts` — list + GRASP clone trigger
- `ui/src/app/[entity]/[repo]/page.tsx` — open file, fallbacks
- `ui/src/pages/api/nostr/repo/files.ts`, `file-content.ts`, `clone.ts`
- `ui/src/pages/api/git/file-content.ts` — GitHub/GitLab/Codeberg/self-hosted

## Order (simplified)

**File tree**

1. Browser `localStorage` (owned / edited repos)
2. Embedded files in Nostr repo event (legacy/small)
3. Parallel over `clone[]` / `source`: bridge `GET /api/nostr/repo/files`, or upstream git APIs
4. GRASP: empty tree or 404 → shallow-clone each working `clone[]` URL via `GET /api/git/repo-files?sourceUrl=…` (shows files from the remote match immediately); then `POST /api/nostr/repo/clone` to mirror on disk and retry bridge; background poll if mirror is slow
5. Nostr subscription for kind 30617 if still missing

**Single file**

1. Embedded in event / local cache  
2. Bridge `GET /api/nostr/repo/file-content`  
3. Upstream `GET /api/git/file-content?sourceUrl=…`  
4. Binary → base64 / data URL in the browser  

**Folder README** (browsing a directory without opening a file)

Same branch as the loaded tree: use `repoData.filesBranch` (from multifetch `resolvedBranch`), not only `?branch=` in the URL. If the remote default is `master` but the URL says `main`, the UI syncs branch after the first successful tree fetch. Fallback order: local overrides → bridge `file-content` → `successfulSources` / `clone[]` via `GET /api/git/file-content?sourceUrl=…` (GRASP HTTPS) → cached `gittr_files` row content.

## SSH clone URLs

`git@host:path` is normalized to HTTPS for HTTP APIs where needed. Generic `user@host:path` (no `://`) is treated as self-hosted git for `/api/git/*`.

## GRASP (foreign / nostr-git)

Many GRASP hosts have no file-browse REST API — only `git clone` over HTTPS. Per **clone URL** (in parallel with others), `fetchFromNostrGit` tries:

1. **On-disk bridge** — `GET /api/nostr/repo/files` (`reposDir/{pubkey}/{repo}.git`)
2. **Remote shallow clone** — `GET /api/git/repo-files?sourceUrl=<that clone HTTPS URL>` (temp dir, same as import); **returns files to the UI immediately** when the remote has commits
3. **Bare mirror** — `POST /api/nostr/repo/clone`, then **await** bridge reads (poll ~12s); background poll + `grasp-repo-cloned` if still slow
4. After a successful shallow clone, bare mirror runs **in the background** so the next visit hits the bridge

Parallel `clone[]` sources use `Promise.race`: **first mirror that returns a non-empty tree wins**. A dead mirror (502) does not block a working one (e.g. `relay.ngit.dev`).

Empty bare dir with no branches: nostr files API may return `files: []` — step 2–3 still run.

### Newest copy: what we do and do not compare

| Question | Behaviour |
|----------|-----------|
| Newest **Nostr repo announcement** (30617)? | **Yes** — subscriptions keep the latest `created_at` event; `clone[]` / `relays` tags come from that snapshot. |
| Newest **tree across GRASP mirrors**? | **Not yet** — we do not compare `HEAD` / kind **30618** state across every clone URL and pick the newest commit. We use **first successful fetch** in the parallel race (after GitHub-first when applicable). |
| GitHub / `source` upstream? | **Yes** when present — `prioritizeUpstreamCloneUrls` tries GitHub (and refetchable upstream) before GRASP so the live forge wins over stale embedded kind-51 trees. |

Improvement backlog: optional pass to compare commit SHAs from each successful shallow clone (or latest 30618) and show the newest branch tip.

## GitHub mirror

Repos with a GitHub `source` / `clone` URL often treat GitHub as authoritative for the tree unless `hasUnpushedEdits`. README/About may still follow GitHub when a mirror exists.

## Ops

- Set `GIT_NOSTR_BRIDGE_REPOS_DIR` if Next and bridge run as different users.
- Import size: Next API ~4 MB response cap — huge monorepos may fail; trim assets.

Troubleshooting pushes: [BRIDGE_PUSH_DEBUGGING.md](BRIDGE_PUSH_DEBUGGING.md).
