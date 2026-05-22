# File Fetch Flow (Bridge + gittr UI)

How **git-nostr-bridge** exposes repos on disk and how **[gittr](https://github.com/arbadacarbaYK/gittr)** loads trees, file content, and commits. For the full UI fallback order (localStorage → embedded → bridge → GRASP shallow → upstream), see gittr **[`docs/FILE_FETCHING_INSIGHTS.md`](https://github.com/arbadacarbaYK/gittr/blob/main/docs/FILE_FETCHING_INSIGHTS.md)** — that doc is updated when gittr behavior changes; this page focuses on the **bridge contract** and **gittr-specific wiring**.

## 1. What the bridge exposes (unchanged contract)

- **Repository mirror**: NIP-34 events on relays (or `POST /api/event` when `BRIDGE_HTTP_PORT` is set) → bare repo under `repositoryDir/{pubkey}/{repo}.git`.
- **File tree (on disk)**: gittr calls **`GET /api/nostr/repo/files`** (Next.js proxy to the same `repositoryDir` the bridge uses). Production UI host is **`gittr.space`**; git over SSH/HTTPS is **`git.gittr.space`**.
- **File content**: `GET /api/nostr/repo/file-content?ownerPubkey=…&repo=…&path=…&branch=…` — paths must be **`encodeURIComponent`**’d for non-ASCII names.
- **Commits on disk**: `GET /api/nostr/repo/commits?ownerPubkey=…&repo=…&branch=…` — `git log` on the bare mirror (not the file-tree listing logic).
- **Clone trigger**: `POST /api/nostr/repo/clone` when the bare dir is missing; gittr may also use **`GET /api/git/repo-files?sourceUrl=…`** for a **temporary shallow clone** of a GRASP/upstream HTTPS URL while the mirror catches up.
- **Internal bridge URLs** (direct to bridge process): e.g. `/api/nostr/repo/tree` — gittr normally uses the Next routes above instead.

## 2. gittr UI — what still matches this doc

**File tree & single-file content (Code tab)** — order is documented in [`FILE_FETCHING_INSIGHTS.md`](https://github.com/arbadacarbaYK/gittr/blob/main/docs/FILE_FETCHING_INSIGHTS.md):

1. `localStorage` / embedded NIP-34 files  
2. Parallel over `clone[]` / `source`: bridge **`/api/nostr/repo/files`**, upstream via **`/api/git/repo-files`** or GitHub-first heuristics  
3. GRASP: empty bridge → shallow **`/api/git/repo-files?sourceUrl=`** per HTTPS clone URL (parallel race; **first non-empty tree wins**) → optional **`POST …/clone`** + poll / `grasp-repo-cloned`  
4. Nostr resubscribe if still empty  

**Not compared today:** newest `HEAD` across every GRASP mirror — first successful source wins (see gittr doc table “Newest copy”).

Implementation: `ui/src/lib/utils/git-source-fetcher.ts`, `ui/src/app/[entity]/[repo]/page.tsx`.

## 3. gittr changes (branch, Commits, Issues, PRs)

These are **gittr-only** behaviors on top of the bridge; they are easy to miss if you only read the old “open any repo tab” summary.

### Shared branch across tabs

- **One `?branch=`** for **Code, Commits, Issues, and PRs** (`resolveSharedRepoBranch` in `ui/src/lib/repos/repo-file-tree-branch.ts`, wired in `layout-client.tsx` nav links).
- **Default branch** is sanitized (e.g. **dependabot/** branches are not stored as repo default).
- After a **multifetch**, gittr only **updates the branch dropdown** when `shouldSyncBranchFromFetch` allows it (avoids jumping to a random remote tip like `dependabot/...` unless the user already picked that branch).
- **File tree cache** uses `filesBranch` in repo state; **opening a file** uses `resolveContentBranch` / `branchesToTryForContent` so content matches the selected or resolved branch.

### Commits tab (different API than file tree)

- Loads via **`GET /api/nostr/repo/commits?ownerPubkey=…&repo=…&branch=…`** (bare repo `git log` on the bridge disk).
- **GitHub import fallback** still uses GitHub REST for commit list when configured.
- Uses the **same `?branch=`** as Code; branch normalization fixes `main` vs `master` mismatches after GitHub refetch.

Does **not** run the full `git-source-fetcher` tree race; it only needs the mirror to exist for that branch (or GitHub).

### Issues & PRs tabs

- **Lists and detail** come from **Nostr events** (issues, PRs, statuses) on relays — not from `repo/files`.
- Tab navigation **keeps the shared branch** in the URL for consistency when jumping back to Code or Commits.
- **File diffs / PR file views** that need bytes still go through Code-style paths (`file-content`, bridge, or upstream) on the active branch.

### Push to Nostr (metadata vs git on disk)

- **`git push`** updates the **bare repo on the bridge**.
- **“Push to Nostr”** in the UI publishes **30617 / 30618** (and related) to relays.
- Push payload files: **localStorage first**, then bridge **`file-content`**; see gittr doc — push does not re-import from GitHub during publish.
- Empty-tree push preserves existing files on disk when only updating metadata (date refresh).

## 4. Production bridge features (this repo)

- **HTTP fast lane** (`BRIDGE_HTTP_PORT`): POST signed NIP-34 to `/api/event` for immediate mirror.
- **Deduplication** of HTTP + relay events.
- **Watch-all** (`gitRepoOwners: []`): mirror every repo on configured relays.

Details: [gittr-enhancements.md](gittr-enhancements.md).

## 5. Other clients

- Publish **30617** (and legacy 51 where needed); bridge mirrors like gittr.
- Use **`/api/nostr/repo/files`** + **`file-content`** (+ **`commits`** if you show history from disk).
- Optional: HTTP fast lane + `grasp-repo-cloned` / polling after `clone` — same as gittr GRASP flow in `FILE_FETCHING_INSIGHTS.md`.
- If you build a multi-tab UI, consider the same **shared branch** and **don’t treat first multifetch branch as canonical** unless it matches your default-branch rules.

When in doubt, treat **[`FILE_FETCHING_INSIGHTS.md`](https://github.com/arbadacarbaYK/gittr/blob/main/docs/FILE_FETCHING_INSIGHTS.md)** as the living UI spec and this file as **bridge + integration** notes.
