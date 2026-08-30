# File fetching

How the **Code tab** gets a file tree and file bytes.

![Where Code-tab files come from](file-fetch.gif)

The picture is the **map**: who can hold the bytes, and which tools talk to which host. The **timeline** of one Code-tab open is the flowchart below.

Interactive map (optional): [file-fetch.netdraw.json](file-fetch.netdraw.json) · still frame [file-fetch.png](file-fetch.png).

This page is Code-tab loading. The **Insights** tab is a different screen: it uses the same tree (`fileCount` / `gittr_files`) plus issue/PR stores, commit cache, live star count, and (when a GitHub upstream is known) languages and commit totals.

Implementation:

- `ui/src/lib/utils/git-source-fetcher.ts` — classify clones, list trees, GRASP / self-hosted shallow clone
- `ui/src/components/repo/RepoCodePage.tsx` — Code tab orchestration
- `ui/src/pages/api/nostr/repo/files.ts`, `file-content.ts`, `clone.ts`, `tree-last-commits.ts`, `sync-from-source.ts`
- `ui/src/pages/api/git/repo-files.ts`, `file-content.ts` — server-side `git clone` / `git show`
- `ui/src/lib/git/bare-repo-tree-last-commits.ts` — last-commit dates on the Code file list
- `ui/src/lib/utils/filter-display-clone-urls.ts` — sidebar clone list (forge `source` plus every pushable GRASP host)

## Timeline (Code tab)

What happens in order when a human opens a repo in the browser:

```mermaid
flowchart TD
  open[Open Code tab] --> local{This browser already has a tree}
  local -->|yes| showLocal[Show it immediately]
  local -->|no| waitNostr[Ask relays for kind 30617]
  showLocal --> waitNostr
  waitNostr --> tags[Read clone and source tags]
  tags --> empty{Announcement has clone URLs}
  empty -->|yes| sort[Sort: forge and self-hosted first, then GRASP]
  empty -->|no after query| infer[Fill well-known GRASP HTTPS URLs]
  infer --> sort
  sort --> race[Ask those URLs in parallel]
  race --> win[First non-empty tree wins]
  win --> persist[Show tree and remember it]
  persist --> readme[Folder README and open-file use that same winner]
  readme --> bytes[Overrides, then winner tip, then bridge or forge]
```

**Other ways to get files** (not this race):

| Who | What happens |
| --- | --- |
| **`git clone` / SSH** | Talks only to the clone host (on this deployment: **`git.gittr.space`**). Bare repo on disk. |
| **gittr-mcp `getFile`** | Bridge, then a short GRASP list. Not the full Code-tab race. Prefer `bridgeListFiles` after a mirror, or resolve **30617 `clone[]`** and call the same HTTP APIs the UI uses. |

## Hosts on this deployment

| Host | What it is |
| --- | --- |
| **`git.gittr.space`** | Git over HTTPS and SSH. Clone URLs, bare repos, Push. |
| **`relay.gittr.space`** | Nostr relay (`wss://`). Kind **30617** announcements, stars, issues. Not a git clone host. |

Clone tags use the **git** host. The relay is how the announcement is found.

## Security (outbound remotes)

Clone / import / file-fetch APIs reject private, loopback, link-local, and metadata hosts (and DNS that resolves to them). Public HTTPS remotes work: GitHub, GitLab, Codeberg, GRASP (`relay.ngit.dev`, `git.gittr.space`, …), and self-hosted forges the **gittr server** can reach. Laptop-only NAS URLs (`*.local`, `192.168.*`) are not fetched from the server.

## Loading the file tree

1. **Browser `localStorage`** — owned or previously loaded trees show immediately. Network refresh still runs when there is a GitHub mirror (or an npub/hex route that needs a live announcement).
2. **Embedded files** in a Nostr repo event (legacy / small repos).
3. **Kind 30617** on relays — published **`clone[]` and `source` tags are the map**. Query includes the viewer’s relays plus NIP-34 discovery (`relay.gittr.space`, `relay.ngit.dev`, shakespeare, nostrhub, gitnostr, `nos.lol`).
4. **Timers:** after ~3s, multifetch and bridge fallback start even if tags are still arriving (the subscription stays open). After **20s**, the metadata sub closes. Well-known GRASP URLs are filled in only when a matching 30617 has **empty** `clone[]`, or as last resort if **no** 30617 arrived by EOSE.
5. **Parallel race** (`fetchFilesFromMultipleSources`) over those URLs, **45s** for the first success:
   - Forge and self-hosted HTTPS before GRASP (so a dead ngit host does not burn the whole wait).
   - Bare `http://IP:port` home clones after HTTPS GRASP (a dead LAN host does not win).
   - GitHub / `source` can be pulled further ahead (`prioritizeUpstreamCloneUrls`); a successful GitHub preflight (up to 20s) can return immediately.
   - **Winner = first non-empty tree.** A 502 from one mirror does not block another.
   - With Amber / NIP-46 paired, HTTP concurrency is **2** so bunker WebSockets stay healthy.
6. **Per URL** (`parseGitSource`):
   - **GRASP** (`nostr-git`): bridge `GET /api/nostr/repo/files` → if empty, `GET /api/git/repo-files?sourceUrl=` → optional `POST /api/nostr/repo/clone` (~12s) + bridge retry.
   - **Self-hosted** (including a non-GRASP host with `/npub1…/repo`): **`repo-files` only**.
   - **Forge** (GitHub / GitLab / Codeberg): `repo-files` (server shallow clone); GitHub REST is fallback.
   - **`htree://`**: skipped here — see [Iris Hashtree](#iris-hashtree-htree) below.
7. Once a tree is on screen (`gittr_files` / live ref), that fetch is done. Extra clone successes update the sidebar; they do not restart the race or the README.

**Huge trees** (thousands of files): the bridge may return `listing: "shallow"` (one directory level). Opening a folder GETs that path’s children.

**File list dates:** `GET /api/nostr/repo/tree-last-commits` on the same tip/branch (text marker `>>>COMMIT<<<`, not `%x00`).

## Loading one file or folder README

Same winner as the tree. Branch comes from `?branch=`, then `filesBranch` / `resolvedBranch` from multifetch.

1. Local overrides / IndexedDB (`resolveLocalOverrideBody`) — unpushed Upload drafts win until Push.
2. Multifetch **`successfulSources`** via `/api/git/file-content`.
3. If there is **no** forge upstream and **no** winner yet: bridge `GET /api/nostr/repo/file-content` (skip after a full 404).
4. Indexed / embedded listing body.
5. Forge `/api/git/file-content` when `shouldPreferUpstreamContent` (GitHub / GitLab.com / Codeberg only).
6. Remaining `clone[]` only if multifetch has no winners yet.
7. Binary → base64 / data URL in the browser.

Relative README images (`![…](file-fetch.gif)`) resolve against **that markdown file’s folder**.

Normal READMEs (up to ~200 KB) format automatically; only enormous bodies need **Show formatted README**.

### Content states

| State | Meaning | README / openFile |
| --- | --- | --- |
| **Local only** | Drafts / `hasUnpushedEdits` / overrides / IDB | Overrides / IDB first, else indexed body |
| **Nostr / GRASP only** | 30617 `clone[]` to `git.gittr.space` or other GRASP; no forge `source` | Bridge `file-content`, then GRASP HTTPS / indexed |
| **External git source** | Forge `sourceUrl` | Forge `/api/git/file-content`; bridge is fallback |
| **On gittr bridge** | Bare under `reposDir/{pubkey}/{repo}.git` | Bridge when there is no forge; if also forge-imported, use the **forge** tip |

**Overrides:** small text lives in `gittr_overrides__*`. Large / binary drafts (GIFs, folder packs) live in IndexedDB (`gittr-overrides-v1`); storage only keeps a `__gittr_idb__:mime` pointer. Anything that **reads file contents** (Push, Pages, README, openFile, blame, merge) uses `loadRepoOverridesResolved` / `resolveLocalOverrideBody`.

## Classification (`parseGitSource`)

| Pattern | Type | Fetch path |
| --- | --- | --- |
| Known GRASP host + `/npub1…/repo`, or `/grasp/npub1…/repo` | `nostr-git` | Bridge → `repo-files` → optional bare mirror |
| Other host + `/npub1…/repo` (home NAS, …) | `self-hosted-git` | **`repo-files` only** |
| github.com / gitlab.com / codeberg.org | forge | `repo-files` / forge APIs |
| Other `https://host/owner/repo` | `self-hosted-git` | `repo-files` |

`git@host:path` is normalized to HTTPS for HTTP APIs. Generic `user@host:path` (no `://`) is self-hosted git for `/api/git/*`.

## Iris Hashtree (`htree://`)

Some NIP-34 announces (e.g. [Iris Git](https://git.iris.to/)) use `clone` → `htree://npub1…/repo` (needs `git-remote-htree` on the machine) and `web` → `https://git.iris.to/#/…`. gittr labels these and, when every clone is Hashtree-only, shows an Iris CTA plus copyable `git clone htree://…`. The bridge cannot clone `htree://`.

## GRASP remotes

Many GRASP hosts have no file-browse REST API — only `git clone` over HTTPS. For each clone URL, in parallel:

1. On-disk bridge — `GET /api/nostr/repo/files`
2. Remote shallow clone — `GET /api/git/repo-files?sourceUrl=` (returns files to the UI when the remote has commits)
3. Bare mirror — `POST /api/nostr/repo/clone`, then bridge reads (~12s)

Wrong default branch is common (`main` vs `develop`). Files, file-content, and tree-last-commits fall back `main`↔`master`, then the bare HEAD, then other heads. Success includes the resolved `branch`.

The gittr bridge **404s** `GET /api/nostr/repo/files` when this host is not in `clone[]`. That is expected: the UI then reads the owner’s announced clone host. Foreign GRASP is not permanently copied onto `git.gittr.space`.

## What “newest” means

| Question | Behaviour |
|----------|-----------|
| Newest **Nostr announcement** (30617)? | Yes — latest `created_at`; `clone[]` / `relays` come from that event. |
| Newest **tree across every GRASP mirror**? | No — first successful fetch in the race (after forge / GitHub-first when applicable). Kind **30618** is not compared across hosts. |
| GitHub / `source` upstream? | Yes when present — tried first via `/api/git/repo-files`. |

Star, Watch, Public/Private, Refetch, Commits, and new Issue/PR use the **same** 30617 as file fetch (`resolveLiveRepoAnnouncement`).

## GitHub / forge mirror

When a GitHub (or GitLab / Codeberg) `source` / `clone` URL exists, that forge is authoritative for the **tree** unless the user has unpushed edits. **About / description** stays owner-set; GitHub only fills empty or placeholder About text.

**Refetch** after import: small trees may hydrate a few text files via `/api/git/file-content`. Large trees (≥ 50 files) skip that flood; Push announces the forge tip with one `POST /api/nostr/repo/sync-from-source`. Refetch is tip sync, not a local rewrite (`hasUnpushedEdits` stays false).

The browser does not `fetch(raw.githubusercontent.com)` for file bodies (no CORS). README images may **hotlink** GitHub raw; on failure they fall back to same-origin file APIs.

A richer local tree is kept for **Nostr-only** repos (so a thin GRASP listing cannot wipe folders). A declared forge `source` / `forkedFrom` **may shrink** the tree to match upstream (deletes included), and **Refetch** always may.

## Sidebar: Git Server and Clone URL

- **Git Server** is the forge URL from the announcement when one exists. For Nostr-only repos it is a GRASP clone from the same event (on this deployment, `git.gittr.space` when that host is listed).
- **Clone URL (event)** shows forge `source` plus **every** host on the push GRASP set (`git.gittr.space`, ngit, shakespeare, gitnostr, …).
- After Clear local / flush, the live 30617 still fills description, clone tags, and event id.

## Push tip

SSH and HTTPS `git push` write real objects into the bridge bare repo. **UI Push** with a forge `source` and no local edits syncs that bare tip from the forge (`sync-from-source`) and announces those SHAs in kind **30618**. MCP `createRepo` / `mirrorRepo` advertise the full GRASP push clone set; forge URLs stay in `source`.

## Ops

- Set `GIT_NOSTR_BRIDGE_REPOS_DIR` if Next and the bridge run as different users.
- `GET /api/git/repo-files` runs **on the gittr server**. Home NAS URLs in `clone[]` must be reachable from that host, not only from the visitor’s laptop.
- Push troubleshooting: [BRIDGE_PUSH_DEBUGGING.md](BRIDGE_PUSH_DEBUGGING.md).

## Tests

| Suite | Command |
| --- | --- |
| UI tip / clone / timestamps | `cd ui && npm run test:regressions` |
| MCP clone set + forge match | `cd ../gittr-mcp && npm run test:regressions` |

## Integrators

- Snippets: [gittr-helper-tools `snippets/file-fetching`](https://github.com/arbadacarbaYK/gittr-helper-tools) — keep `parseGitSource` in sync with this file.
- Sidebar policy: `snippets/filter-display-clone-urls`.
- MCP: gittr-mcp `docs/MCP-GITTR-PARITY.md`.
