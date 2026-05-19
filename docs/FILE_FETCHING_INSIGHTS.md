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
4. GRASP: empty tree or 404 → `POST /api/nostr/repo/clone`, then poll/retry
5. Nostr subscription for kind 30617 if still missing

**Single file**

1. Embedded in event / local cache  
2. Bridge `GET /api/nostr/repo/file-content`  
3. Upstream `GET /api/git/file-content?sourceUrl=…`  
4. Binary → base64 / data URL in the browser  

## SSH clone URLs

`git@host:path` is normalized to HTTPS for HTTP APIs where needed. Generic `user@host:path` (no `://`) is treated as self-hosted git for `/api/git/*`.

## GRASP

Many GRASP hosts do not expose a browse API; gittr uses the **bridge bare repo** on your server. Next must reach the GRASP **HTTPS** clone URL for `clone.ts`.

Empty bare dir with no branches: files API may return `files: []` — client should trigger clone.

## GitHub mirror

Repos with a GitHub `source` / `clone` URL often treat GitHub as authoritative for the tree unless `hasUnpushedEdits`. README/About may still follow GitHub when a mirror exists.

## Ops

- Set `GIT_NOSTR_BRIDGE_REPOS_DIR` if Next and bridge run as different users.
- Import size: Next API ~4 MB response cap — huge monorepos may fail; trim assets.

Troubleshooting pushes: [BRIDGE_PUSH_DEBUGGING.md](BRIDGE_PUSH_DEBUGGING.md).
