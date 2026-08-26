# Production setup

Install gittr (Next.js UI + API) and **git-nostr-bridge** on a Linux server. Paths like `/opt/gittr` and hostnames like `gittr.space` are examples—use your own.

**Deploy path name:** Some servers still use `/opt/ngit` as the checkout directory from early layout. That tree is **this gittr repo** (Next.js under `ui/`, bridge under `ui/gitnostr/`)—not the separate **[ngit](https://ngit.dev)** project. Scripts or docs that say `cd /opt/ngit` mean your gittr install path.

**Do not commit** real IPs, SSH keys, OAuth secrets, or LNbits keys. Use `ui/.env.example` and private deploy scripts.

**Other docs (read when needed, not duplicated here):** full index [docs/README.md](README.md).

| Topic | Doc |
|--------|-----|
| Bridge only / security warnings | [GIT_NOSTR_BRIDGE_SETUP.md](GIT_NOSTR_BRIDGE_SETUP.md) |
| `git clone` / `git push` over SSH | [SSH_GIT_GUIDE.md](SSH_GIT_GUIDE.md) |
| Env reference, checklist, maintenance | [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) |
| File fetch / bridge 404 / empty tree | [FILE_FETCHING_INSIGHTS.md](FILE_FETCHING_INSIGHTS.md) |
| GitHub OAuth | [ui/GITHUB_OAUTH_SETUP.md](../ui/GITHUB_OAUTH_SETUP.md) |
| Pages gateway + wildcard DNS/TLS | [infra/nsite-gateway/README.md](../infra/nsite-gateway/README.md) |
| SEO / sitemap | [SEO.md](SEO.md) |
| Markdown XSS / rehype-sanitize | [MARKDOWN_XSS.md](MARKDOWN_XSS.md) |
| Event kinds / paywall product rules | [NIPS_AND_EVENT_KINDS.md](NIPS_AND_EVENT_KINDS.md) |
| Web of Trust badges | [WOT.md](WOT.md) |
| Local dev | [LOCAL_SETUP.md](LOCAL_SETUP.md) |
| Doc links to our repos on gittr (not GitHub) | [gittr-repo-links.md](gittr-repo-links.md) |

---

## Prerequisites

- Ubuntu 20.04+ (or similar), sudo
- **Node 18+**, **yarn** (preferred; `ui/yarn.lock` is canonical)
- **Go 1.21+** to build the bridge (or use Docker — [GIT_NOSTR_BRIDGE_SETUP.md](GIT_NOSTR_BRIDGE_SETUP.md))
- **git**, **openssh-server**, **nginx**, **certbot**
- DNS for your web host (and optionally `git.` + `pages.` subdomains)

```bash
node --version   # >= 18
go version       # >= 1.21
git --version
```

---

## 1. Clone and build UI

```bash
git clone git@git.gittr.space:arbadacarbaYK/gittr.git
cd gittr/ui
yarn install
cp .env.example .env.local
# edit .env.local — domain, relays, optional GitHub OAuth, LNbits, Blossom URLs
yarn build
```

**Env notes (production):**

- `NEXT_PUBLIC_NOSTR_RELAYS` should match bridge `relays` in `git-nostr-bridge.json`.
- If Next runs as a different user than the bridge, set **`GIT_NOSTR_BRIDGE_DB`** and **`GIT_NOSTR_BRIDGE_REPOS_DIR`** to the bridge’s absolute paths (see `.env.example`).
- Optional: `PUBLISHER_BLOCKLIST` / `NEXT_PUBLIC_PUBLISHER_BLOCKLIST` — hides listed pubkeys from explore/repos/sitemap (server `ui/.env.local` only). Pages directory: gateway **`CURATION_USER`** + deploy sync — see [GITTR_PAGES_CURATION.md](GITTR_PAGES_CURATION.md).
- Push paywall, NIP-34 tag shape, Pages/Blossom behavior: [NIPS_AND_EVENT_KINDS.md](NIPS_AND_EVENT_KINDS.md) and in-app Help — not repeated here.
- **GitHub / Forgejo upstream tabs**: Issues/PRs/Releases soft-refresh from GitHub when `sourceUrl` is github.com, and from Forgejo/Gitea `/api/v1` (including Codeberg and self-hosted) for those hosts. Commits and GitHub Projects V2 stay GitHub-only. Releases persist in `gittr_releases__*` so the tab works without a prior Code visit. Optional `GITHUB_PLATFORM_TOKEN` improves GitHub rate limits.
- **App announce (NIP-82 / Zapstore)**: owners publish from the repo Code sidebar (**Nostr Apps**) or Releases tab (**Announce on Nostr** on a forge tag). Requires a linked GitHub/Codeberg/GitLab/Forgejo `sourceUrl` with a forge **Release** that includes an `.apk` (Zapstore gate). Optional sibling binaries on the same tag (DMG, AppImage, MSI/EXE, IPA) with verified sha256 are published as extra NIP-82 assets on that version. gittr does **not** store binaries; events point at forge download URLs (or Blossom HTTPS when the publisher used Blossom). `GET /api/repo/forge-releases` is announce/APK-gated (optional `tag=` selects a Release; omit = latest). `GET /api/repo/forge-release-list` returns full release assets for the Releases tab forge sync (GitHub/Codeberg/GitLab/Forgejo). The Releases tab also **reads** NIP-82 kinds `30063`/`3063` for the repo owner even without a forge `sourceUrl`. Optional `GITHUB_PLATFORM_TOKEN` improves GitHub rate limits. Operator-facing help: `/help#releases` and `/help#publish-pages-apps`. See NIP-82 section in [NIPS_AND_EVENT_KINDS.md](NIPS_AND_EVENT_KINDS.md).

PWA: optional; needs HTTPS in production (`ui/public/site.webmanifest`, `sw.js`).

### Homepage “Most Active” leaderboard (server snapshot)

The homepage cards call **`GET /api/stats/platform-leaderboard`**. Heavy Nostr relay scans run **outside** live Next:

- Cached JSON: **`ui/data/platform-leaderboard-snapshot.json`** (written by standalone `scripts/refresh-platform-leaderboard.mts`).
- API serves disk/memory only (sub-second). Emergency `?refresh=1` still exists but avoid it on a sick box.
- After deploy, warm once: `systemctl start gittr-leaderboard-refresh.service` (or wait for the hourly timer).

```bash
./scripts/install-gittr-leaderboard-timer.sh YOUR_SERVER_IP
```

This installs `gittr-leaderboard-refresh.timer` (hourly) and a oneshot that runs `npx tsx /opt/ngit/scripts/refresh-platform-leaderboard.mts` with `WorkingDirectory=/opt/ngit/ui` (`MemoryMax=1200M`). Unit files live in `infra/systemd/`.

Check status: `systemctl list-timers gittr-leaderboard-refresh.timer` and `journalctl -u gittr-leaderboard-refresh.service --since today`.

### SEO sitemap repo index (daily, explore-class)

`/sitemap.xml` prefers a **disk snapshot** of public repos (same filters as explore/sitemap: deletions, private, blocklist, unusable clones); live relay fan-out only if that snap is missing or `SITEMAP_LIVE_NOSTR=1`. Install the daily timer so the snapshot stays warm:

```bash
./scripts/install-gittr-seo-repo-index-timer.sh YOUR_SERVER_IP
```

- Runs **standalone** `scripts/refresh-seo-repo-index.mts` (own Node/tsx process; does **not** curl live Next). Timer uses `Persistent=false` so mid-day install does not catch up a missed run
- Writes `/opt/ngit/ui/data/nostr-seo-repos-snapshot.json`; `ExecStartPost` mirrors to `/opt/ngit/data/lab-snapshot/` for lab agents (cheap `cp`)
- `/sitemap.xml` prefers that disk snapshot; live relay fan-out only if the snap is missing (or `SITEMAP_LIVE_NOSTR=1`)
- See [SEO.md](SEO.md); keep `gittr-frontend` `MemoryMax` on small VPS

Optional: kick the same oneshot after other indexing (`systemctl start gittr-seo-repo-index-refresh.service`) — do **not** curl `?refresh=1` into live Next for the daily job.

### Homepage “Recent repositories” (live relay query)

The **Recent repositories** strip is **not** taken from the 3h leaderboard snapshot. It uses a separate endpoint so pushes show up without waiting for the heavy platform stats job:

- **`GET /api/stats/recent-repos`** — queries **`PROFILE_REPOS_RELAYS`** for kind **30617** announcements, sorts by announcement `created_at`, returns up to 12 repos. Same “newest announced” idea as `/explore` (not kind **30618** push state — those used to bury new repos behind busy ones). Relays include ngit / Shakespeare / NostrHub, not only the slim stats set.
- Soft-deleted repos (`content`/`tags` with `deleted:true`, see `repo-deleted.ts`) are excluded — a delete republish must not appear as a “new” recent repo. Explore also hides those; leftover SEO rows without a live tombstone are not “deleted showing by accident,” they are a different catalog.
- **Server cache ~45s** (`Cache-Control` + in-memory) so the homepage can poll without hammering relays.
- The UI shows this list for **both logged-in and logged-out** users (do not substitute the visitor’s localStorage sync — that caused mismatched homepage lists).
- Warm after deploy: `curl -sS https://YOUR_DOMAIN/api/stats/recent-repos | head` (first call can take several seconds while relays respond).

### Homepage “Recent Activity” / “Your recent activity”

- **Logged out:** shared platform feed from the leaderboard snapshot / live Nostr scan (commits, PRs, issues, repo creates across the network).
- **Logged in:** only activity on **repos you own or can write** (local `gittr_activities` merged with the platform feed filtered by owner/access). Title becomes **Your recent activity**.
- Cards deep-link to the matching tab (`/pulls`, `/issues`, `/commits`, `/releases`, or a specific PR/issue id when known) and use a hard navigation to avoid soft-router crashes into heavy repo pages.

### Global `/issues` and `/pulls` list controls

The aggregate Issues and Pulls pages use real menus (not decorative GitHub placeholders):

- **Source** — All repos / Hide forks / Forks only (real `forkedFrom`: GitHub parent or gittr `/npub/repo`, not a self-import GitHub URL)
- **Group** — Group by repository (collapsible sections) or Flat list
- **Sort** — Recently updated / Newest / Oldest

Prefs and collapsed repo keys persist in `localStorage` (`gittr_issues_list_*` / `gittr_pulls_list_*`). Default group is **By repo**; on first visit every repo section starts **collapsed** (expand/collapse choices are remembered afterward).

### Profile repo list (same for everyone)

Profile pages show repositories to **everyone** (no login required) via the server. Logged-in vs logged-out must **not** change the repo grid — only **Follow** and **In your network**. Unpublished / private rows belong on **My Repositories**, not the public profile.

- **`GET /api/nostr/profile-repos?ownerPubkey=<64-char-hex>`** — fetches kind **30617/30618** for `authors: [pubkey]` on **`PROFILE_REPOS_RELAYS`** (stats relays + NIP-34 discovery: `relay.ngit.dev`, shakespeare, nostrhub, gitnostr, …). Slim `PLATFORM_STATS_RELAYS` alone misses NostrHub/ngit-only announcements. Rows include `name` / `description` from 30617 tags when present; **30618** updates activity timestamps on **live** repos without wiping announcement text. A repo is **live** only when the **latest kind 30617** for that `d` tag is not soft-deleted — a later 30618 (or an older live 30617) must not keep a deleted repo in the list (My Repos heal popup uses this list). Repo chrome (Star event id, Public/Private, Refetch `source`, Commits clone URLs, new Issue/PR `d`) must use this same list via `resolveLiveRepoAnnouncement` — not a defaultRelays-only subscribe.
- The profile page passes the decoded hex pubkey (npub URLs are decoded client-side; do not pass npub to this API).
- **Visitor `gittr_repos` is not the catalog.** Do not paint the browser cache as the profile list (logged-in people often have a handful of that author). The grid is `enrichNetworkProfileRepos`: Nostr rows only; localStorage may fill About/logo on matching cards. `public-read:false` stays off the public profile (use My Repos). Kind **30617** query `limit` is **2000**; scan timeout **12s**; a timeout response is **`Cache-Control: no-store`**.
- While that request is in flight the UI shows **“Loading repositories from Nostr…”** (and `…` in the count) instead of a fake **0** with no grid — the relay scan can take several seconds on a cold cache.
- Response is **field-merged** with local repos (`mergeProfileRepoList`): sparse network rows must not erase About text, display names, or `userRole` (owner cards flipping to contributor green).
- Below Repositories, the same profile also lists that person’s **Pages** (from **`GET /api/gittr-pages/status-sites`**, filtered by author pubkey / `npub…` site hostname) and **Apps** (from **`GET /api/nostr/software-catalog?author=<hex>`**, author-scoped NIP-82 scrape — not the full Zapstore catalog). Both sections start after browser idle so they do not fight `profile-repos` / metadata. UI: `ProfilePagesAppsSections`.
- Profile load priority: paint header + local/network **repos** first (eager grid — do **not** use `useDeferredValue` for cards while counts use live `userRepos`, or you get “Repositories (107) / Load more 59 remaining” with an empty grid for minutes); defer contribution-graph Nostr activity and Pages/Apps; cap per-repo `#a` PR/issue fan-out. Avoid render-path `console.log` of `userMeta` (that caused production console storms and made the page feel stuck). Profile cards skip scanning fat `repo.files` for logos.
- Folder README / openFile: try **multifetch `successfulSources`** (and their `resolvedBranch`, e.g. `master`) **before** gittr bridge. Use the **first winning clone immediately** — do not wait for the rest of the parallel file-fetch race, and do not re-run README when later sources are appended. Bridge-first on foreign GRASP repos caused a main/master 404 storm while pyramid already had the tip. Sticky-skip bridge after a full miss. Do **not** await Amber `ensureBootstrapped` on browse — fire-and-forget + `maxConcurrent: 2` on multifetch stays as-is.
- Smoke test: `curl -sS 'https://YOUR_DOMAIN/api/nostr/profile-repos?ownerPubkey=<hex>' | jq '.repos | length'`

---

## 2. Bridge user and build

**Warning:** run the bridge only as dedicated user **`git-nostr`**, not your personal account ([GIT_NOSTR_BRIDGE_SETUP.md](GIT_NOSTR_BRIDGE_SETUP.md)).

```bash
sudo useradd --create-home --shell /bin/bash git-nostr
sudo su - git-nostr
cd ~
git clone git@git.gittr.space:arbadacarbaYK/gittr.git
cd gittr/ui/gitnostr
make git-nostr-bridge
```

Create config (run `./bin/git-nostr-bridge` once, Ctrl+C after it starts), then edit `~/.config/git-nostr/git-nostr-bridge.json`:

```json
{
  "repositoryDir": "/home/git-nostr/git-nostr-repositories",
  "DbFile": "/home/git-nostr/.config/git-nostr/git-nostr-db.sqlite",
  "relays": ["wss://relay.damus.io", "wss://nos.lol"],
  "gitRepoOwners": []
}
```

Use **absolute paths**. `gitRepoOwners: []` watches all authors’ NIP-34 events; bare repos materialize only when `clone[]` includes `git.gittr.space`. Relays = same set as `NEXT_PUBLIC_NOSTR_RELAYS`.

---

## 3. SSH for Git

In `/etc/ssh/sshd_config`: `PubkeyAuthentication yes`; allow users `git-nostr` and/or `git`.

**Important:** the bridge updates **`/home/git-nostr/.ssh/authorized_keys` only**. If you use `Match User git` with a **copy** at `/etc/ssh/git-authorized_keys`, keys go stale and clients get password prompts. Point `git` at the live file:

```
Match User git
    AuthorizedKeysFile /home/git-nostr/.ssh/authorized_keys
```

Or after deploy: `SSH_DEPLOY_KEY=~/.ssh/your_key ./scripts/ensure-sshd-git-live-authorized-keys.sh <host>`

```bash
sudo sshd -t && sudo systemctl reload ssh
```

Users add keys in **Settings → SSH Keys**. Details: [SSH_GIT_GUIDE.md](SSH_GIT_GUIDE.md).

---

## 4. systemd services

**Bridge** — `/etc/systemd/system/git-nostr-bridge.service`:

```ini
[Unit]
Description=Git-Nostr-Bridge
After=network.target

[Service]
Type=simple
User=git-nostr
WorkingDirectory=/home/git-nostr/gittr/ui/gitnostr
ExecStart=/home/git-nostr/gittr/ui/gitnostr/bin/git-nostr-bridge
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**Frontend** — prefer the checked-in unit [`infra/systemd/gittr-frontend.service`](../infra/systemd/gittr-frontend.service) (`WorkingDirectory=/opt/ngit/ui`, `npm start`). It sets **`MemoryHigh` / `MemoryMax`** and `NODE_OPTIONS=--max-old-space-size=…` so a runaway Next process is restarted before it wedges the host. On ~4 Gi boxes use lower caps (~1.4/1.8 Gi); on ~15 Gi production the checked-in unit uses **3 Gi / 4 Gi**.

**If the site feels frozen and APIs return `503`:** that is usually the frontend hitting **MemoryHigh**, not Amber/remote signing. Check `systemctl show gittr-frontend.service -p MemoryCurrent -p MemoryHigh -p ActiveState`. A restart recovers immediately; durable mitigations in the app are (1) lighter header GitHub issue/PR warm (TTL + open-only, 1 page) and (2) SSR/metadata Nostr pools without Damus auto-reconnect storms (`dontAutoReconnect` on server pools, lean production relay fallback). Do not raise memory caps alone — fix the load first.

**If header / repo tabs feel dead until the file list + README finish:** that is **main-thread Code-tab hydrate** (tree dates + ReactMarkdown), not a CSS overlay. README pauses parse on chrome `pointerdown`; chrome uses **soft** `router.push` inside `startTransition` (hard `location.assign` was freezing the tab ~10s on every leave because it remounted the app and awaited bunker warm). Soft nav only hard-assigns after **8s** if the route truly stalled. The avatar account menu must close before that soft push — Header stays mounted, so `preventDefault` on the item link used to leave the dropdown open on the next page (mobile nav already dismissed first). **Repo `generateMetadata` skips Nostr/SQLite on Flight (`RSC`) requests** so tab clicks are not blocked by SEO work — full metadata still runs for crawlers and hard loads. Amber warm stays **click-only** on Push/Star/Watch (`ensureRpcHealthy`); `ensureBootstrapped` never joins the bunker warm promise for browse. **Star**, Public/Private, Settings visibility, Refetch/forge tabs, Commits, Fork, and new Issue/PR all share **`resolveLiveRepoAnnouncement`** (`/api/nostr/profile-repos` on `PROFILE_REPOS_RELAYS`) so they see the same kind **30617** as file fetch. A foreign GRASP clone URL is expected (not gittr’s git host). Bridge `/api/nostr/repo/files` 404 when that host is not `git.gittr.space` is intended. README content must work for **local-only**, **Nostr/GRASP-only**, **external forge source**, and **gittr bridge** hosts — matrix in [FILE_FETCHING_INSIGHTS.md](FILE_FETCHING_INSIGHTS.md). Header Watch/Star/GitHub must not re-subscribe on every file-fetch persist (that flickered Star to “Looking up…”); `persistGithubSourceOnRepo` no-ops when `sourceUrl`/`clone` are unchanged. Folder README starts from the **first successful clone**, not after every remaining source finishes.

**If gittr sits on a spinner ~30s and the console shows `/api/github/proxy` 404 for issues/pulls:** the Chrome `load_time_data_deprecated.js` / `crbug/1173575` line is noise. The stall was Code-tab GitHub hydrate retrying a **deleted or private** mirror (issues + pulls, 3×) while `/api/github/proxy` waited on GitHub with no timeout — that occupied browser connections to gittr.space. Hydrate now probes `/repos/owner/repo` first, treats 404/410/451 as gone (no issue/PR follow-ups, no retry), header badge warm skips the pulls call when issues already failed, and the GitHub proxy aborts at 8s. `githubHydrateShouldRetry` in `repo-page-chrome.ts` is the unit-tested gate.

**If profile/homepage throws React #418 while logged in:** `NostrContext` restores the pubkey from `localStorage` on the first client paint while SSR was logged out. Session-dependent UI (Follow / Edit Profile / “your” activity / owner badges) must use a **mounted-gated** pubkey (`hydratedPubkey = mounted ? pubkey : null`) so first paint matches SSR — same pattern on `home-page-client.tsx` and `[entity]/page.tsx`.

**Deploy tempo:** `upload_to_hetzner.sh` already **rsync-deltas `ui/src`**. Wall-clock is dominated by a full remote `yarn build` on the live box (deploy sets `SITEMAP_SKIP_GITTR_PAGES=1` / `SITEMAP_SKIP_NOSTR=1`). Redundant per-file `scp` of `ui/src` paths was removed — rsync is enough. Always `git push origin` when deploying so GitHub matches Hetzner.

**Disk / lab / other VPS:** Lab SEO snapshot under `/opt/ngit/data/lab-snapshot/` is tiny (~KB–MB) and is **not** what fills the disk. Production disk is mostly **`/home/git-nostr/git-nostr-repositories`** (bare git). clawgames.app is a **different** Hetzner host.

**Public GRASP retention (important):** `git.gittr.space` hosts repos that were **created/pushed on gittr** (NIP-34 `clone[]` includes `git.gittr.space`). The bridge still *watches* public relays for events when `gitRepoOwners: []`, but it **must not** `git clone` every foreign GitHub/ngit announce onto disk. Opening someone else’s ngit/shakespeare clone in the UI uses **temp shallow fetch**, not a permanent mirror.

**Delete → bridge (must stay in sync):** Settings → Delete **awaits** Amber / NIP-07 / nsec signing a soft-deleted kind **30617** (`deleted:true`), publishes to relays, **and** `POST`s to `/api/nostr/repo/event` → bridge wipe. Amber **must** show a `sign_event` for that 30617 (and often a kind 5). Do **not** navigate away before you approve. My Repos heal popup only appears when hide-list ∩ a **newer live 30617** than `deletedAt` — leftover kind **30618** state, or an older live 30617 still on another relay, must not nag “sign again”. Profile-repos queries 30617 and 30618 as **separate** filters so state events cannot crowd tombstones out of `limit`.

**Local draft vs bridge host (read this once):**
- **Create / Import** write **browser only** (`gittr_repos`, `gittr_files__…`, overrides/IDB). No bare tree yet. Code tab prefers local when `hasUnpushedEdits` is set.
- **Bridge bare appears** when a 30617 with `clone[]` → `git.gittr.space` hits the bridge (Settings announce / Push announce), or when web Push / sync-from-source / clone API writes the tree. SSH never creates an empty bare by itself.
- So: editing before Push does **not** need a bridge copy. The empty bridge shell is only for “already announced on this GRASP, waiting for first objects.”

**Retention rules (do not guess):**
| State | Action |
|--------|--------|
| Soft-deleted 30617 (`deleted:true`) | Wipe disk + SQLite (UI posts to `/api/event`; ops: `prune-bridge-deleted-orphans.mjs`) |
| Empty bare (0 commits) + **live** 30617 | **Keep** — owner announced; first push may still come |
| Empty bare + **no** 30617 on relays + SQLite/HostedAt age ≥ **7 days** | Safe junk — announced once or relay-gone; never got objects. Ops prune OK |
| Has commits, no 30617 found | **Keep** — relay miss ≠ unused; may still be a real import/push |
| Flush / local tombstone only | Never wipe bridge |

SQLite `Repository.HostedAt` = first insert on this GRASP (`UpdatedAt` alone is “last event” and cannot age never-pushed shells). Backfilled from `UpdatedAt` on migrate.

**Ops prune — verified non-gittr mirrors (strict):** only remove a bare tree when **all** of these are true: (1) disk remotes have no `git.gittr.space`, (2) latest 30617 exists, (3) **none** of `clone` / `source` / `web` tags (nor content `sourceUrl`) mention `git.gittr.space`. If no 30617 is found → **keep** (uncertain). Gittr-native repos (e.g. `local-agent` with only a gittr clone, no GitHub) are kept via disk remote and/or clone tags. Never delete an owner’s tree just because `origin` still points at GitHub — imports often keep forge as origin while `clone[]` lists gittr.

**Why duplicates existed (and future risk):** Old bridge watch-all did `git clone --bare` of foreign GitHub/ngit announces into each announcer’s hex folder (e.g. eight copies of `gnostr`). **Now:** `handleRepositoryEvent` only `git init --bare` when `clone[]` includes `git.gittr.space` (no foreign clone-on-announce). `POST /api/nostr/repo/clone` rejects other GRASP hosts. UI Create/Import stay browser-local until announce/Push. Push / sync-from-source write **one** path `{hex}/{repo}.git` for that owner — they do not spawn a second copy under another pubkey. Normalization that injects `git.gittr.space` into `clone[]` on gittr announce is intentional (marks “hosted here”), not a duplicate. Remaining residual risk: an empty shell left behind if someone later drops gittr from `clone[]` without a delete — ops prune above covers that when the live event no longer lists us.

Minimal example (adjust paths/user; keep memory caps on small VPS):

```ini
[Unit]
Description=gittr Frontend
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/ngit/ui
ExecStart=/usr/bin/npm start
Environment=NODE_ENV=production
Environment=NODE_OPTIONS=--max-old-space-size=3072
MemoryHigh=3G
MemoryMax=4G
OOMPolicy=stop
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now git-nostr-bridge gittr-frontend
sudo journalctl -u git-nostr-bridge -f   # expect "relay connected"
```

---

## 5. nginx and TLS

Start from repo examples (adjust hostnames):

- Main app + API: [`nginx.gittr.conf.example`](../nginx.gittr.conf.example) — rate limits, `proxy_pass` to `127.0.0.1:3000`, optional `location = /api/nostr/repo/file-content` for bulk fetches.
- HTTPS git smart HTTP: proxy `git.yourdomain` → bridge **:8080** (see example in that file).
- Pages: [`infra/nsite-gateway/nginx-pages.gittr.space.conf.example`](../infra/nsite-gateway/nginx-pages.gittr.space.conf.example) + [infra/nsite-gateway/README.md](../infra/nsite-gateway/README.md). Deploy gateway: `./scripts/deploy-nsite-gateway.sh <ssh-host>`.

```bash
sudo ln -s /etc/nginx/sites-available/gittr /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d your.domain -d git.your.domain
```

Optional rate-limit exemptions in `ui/.env.local`: `GITTR_RATE_LIMIT_EXEMPT_PUBKEYS`, `GITTR_RATE_LIMIT_EXEMPT_IPS` (restart frontend after change). These skip **Next.js** push limits only. Forge raw fetches on `/api/git/file-content` still have no IP bucket; the **shallow-clone fallback** (self-hosted HTTPS when Gitea-style `/raw/` fails) uses the same `gitFetch` bucket as `/api/git/repo-files`. Large forge **Refetch → Push** must use bridge `sync-from-source` instead of hundreds of file-content GETs (see [FILE_FETCHING_INSIGHTS.md](FILE_FETCHING_INSIGHTS.md)). Public `file-content` prefers GitHub **raw** unless the browser sent a user `githubToken` (platform token alone must not force REST and secondary 429s).

**Typical env (also in `.env.example`):**

```
NEXT_PUBLIC_DOMAIN=your.domain
NEXT_PUBLIC_GIT_SSH_BASE=your.domain
NEXT_PUBLIC_SITE_URL=https://your.domain
NEXT_PUBLIC_GIT_SERVER_URL=https://git.your.domain
NEXT_PUBLIC_GITTR_PAGES_URL=https://pages.your.domain
```

**Repo page UI:** Default is the next look (kind-0 banner + identity hero on every `[entity]/[repo]/*` tab, including Settings). Same Code/APIs/forms for all entities. Rollback: `NEXT_PUBLIC_REPO_UI=classic` and rebuild. Legacy `…/next` URLs redirect to the Code page. Repo tabs (Code, Issues, Settings, …) use client-side Next.js navigation so the shared layout chrome stays mounted and does not re-fetch header Nostr/GitHub data on every tab click.

`NEXT_PUBLIC_GIT_SERVER_URL` may be the **host only** (e.g. `https://git.gittr.space`). Announcements must still publish **full** clone URLs (`https://git…/<npub>/<repo>.git`). The UI expands host-only values in `buildUnsignedRepositoryEvent`; do not hand-publish bare hosts into kind 30617. On **My Repositories**, owners with only unusable clones (host-only / localhost) see a **Please republish** badge and can batch-republish (one Push + signatures per repo; nsec / NIP-07 / remote signer). Long My Repos / Refetch / Push messages use in-app `appAlert` / `appConfirm` (`ui/src/components/ui/app-dialog.ts`) so the panel grows with the text; the overlay may scroll if the viewport is shorter than the copy. Do not go back to native `window.alert`/`confirm` for those — browsers cap height and clip the message.

**Amber / NIP-46 Push:** a `Published via direct pool { acked: true, overlap: 7 }` log is **not** a successful sign. If Amber never pops, the phone did not decrypt the RPC. `sign_event` is sent NIP-04-first with a NIP-44 dual envelope. Do not change clone/source/upload paths to “fix” signer timeouts — see [NIP46_REMOTE_SIGNER_INTEGRATION.md](NIP46_REMOTE_SIGNER_INTEGRATION.md) note 13.

**Push clone mirrors:** hosts from `GRASP_SERVERS_FOR_PUSHING` (env relays) plus the owner’s kind **10317** preferred GRASP list, merged host-deduped via `mergeGraspHostsForPush`. Exclusions in `GRASP_DOMAINS_EXCLUDED_FROM_PUSHING` (e.g. `git-01.uid.ovh`, `git.jb55.com`, `ngit-relay.nostrver.se` while unreachable) never get auto `clone` tags or sync waits — they stay in `KNOWN_GRASP_DOMAINS` for reading other people’s events. The sidebar **Git Server** label prefers `NEXT_PUBLIC_GIT_SERVER_URL` / `git.gittr.space` only for **Nostr-only** repos when that host is on the announcement’s `clone` tags (so a gittr Push is not shown as ngit). Repos with a GitHub/GitLab/Codeberg `source` keep that forge as Git Server; extra mirrors stay in the Clone URL list. After a local cache flush, the Code page re-reads those tags from the live 30617 (including GitHub `source`) and writes event id / `syncedFromNostr` so **My Repositories** does not mark published repos as Local.

**Repo Links (docs section → 30617):** Simple rules — (1) Import/batch/refetch: GitHub `homepage` → docs link if present, else nothing. (2) Settings: user can add more docs links anytime; all show under Repository Links. (3) Nostr Pages: add a docs link only when the gateway lists the site (not invented). (4) Push publishes whatever is in `repo.links`. Never invent `owner.github.io` or `*.pages.gittr.space`. (5) NIP-34 `web` browse URLs from other forges (e.g. `gitworkshop.dev/…/relay…/repo`, plain `github.com/owner/repo`, GitLab/Codeberg repo pages) are **not** shown as Documentation; Iris `git.iris.to` remains labeled **Iris Git**. Real Pages hosts (`*.github.io`, `*.gitlab.io`) still qualify. Logo URLs are not published in `web`.

**Repo About (Settings → Description):** Owner text is authoritative. Saving Settings writes localStorage, publishes kind **30617** `description`, and notifies the Code page (`gittr:repos-updated`). GitHub mirror hydrate must not replace a non-placeholder About (stars/forks/activity still sync). See [FILE_FETCHING_INSIGHTS.md](FILE_FETCHING_INSIGHTS.md).

**Folder uploads respect .gitignore:** the repo Upload page filters staged files against (1) every existing `.gitignore` already in the browser for that repo (local overrides / IndexedDB drafts) and (2) every `.gitignore` in the uploaded tree (root + nested). Same path: the **uploaded** `.gitignore` wins. Supports `!` negation, `**`, dir patterns; always drops `.git/` internals. Filtering runs before FileReader / IndexedDB so ignored junk never lands in either storage. `.gitignore` files themselves are kept. Logic + tests: `ui/src/lib/repos/gitignore-upload-filter.ts`, `load-existing-gitignores.ts`.

**gittr-mcp:** filter/CORS/`uploadpack` fixes on the git vhost apply to MCP users automatically when they clone that host. MCP **code** updates need `git pull` or a new `.mcpb` — see [gittr-mcp README](https://github.com/arbadacarbaYK/gittr-mcp#do-mcp-users-get-gittrs-filter--cors-server-fixes).

---

## 6. Optional: Telegram

Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env.local`, then:

```bash
cd ui && node configure-webhook.js your.domain
curl https://your.domain/api/telegram/webhook-status
```

See [PRODUCTION_TELEGRAM_SETUP.md](PRODUCTION_TELEGRAM_SETUP.md).

---

## 7. Verify

```bash
sudo systemctl status gittr-frontend git-nostr-bridge
curl -sI https://your.domain | head -1
```

- Open the site, log in (NIP-07 or key), import or create a repo.
- Footer → **Legal** (`/legal`) — non-commercial Nostr client disclaimer; blacklist contact `info@gittr.space`. No personal operator details.
- Bulk `/import` is local-only by default; optional **Also Push selected to Nostr** publishes each newly imported repo (NIP-34). Single-repo URL auto-import never auto-pushes.
- `git ls-remote git@your.domain:<npub-or-hex>/<repo>.git` (with your key).
- Push from UI once; check bridge logs for repository events.

Import fails with “>4 MB”: Next API body limit — trim large binaries in the import. See README.

**Security audit (Dependencies tab):** the user-facing audit UI is gated behind `NEXT_PUBLIC_SECURITY_AUDIT_UI=1`. `/api/security/audit` is always on. Confirmed = lockfile-pinned version in range (not range-min); bot alerts use `eligibleCveAdvisories` (confirmed + direct + CRITICAL/HIGH). Issue markdown: `cve-issue-format.ts`.

**Notifications (kind 30078):** Settings → Notifications → Save publishes kind **30078** `d=gittr/notifications` with all channel + event toggles (multi-browser). Telegram User ID registers via `POST /api/notifications/consent` into **server-only** `data/notifications-consent.json` (not on relays). Recipient DMs go through `POST /api/notifications/deliver` (looks up the **recipient’s** consent — not the actor’s localStorage). Telegram sends require Bot API JSON `ok: true` and log/return `messageId`; clearing the `@gittrupdatebot` chat removes old DMs from Telegram history. Legacy `d=gittr/security-cve` is still hydrated. **CVE bot (live):** daily `gittr-cve-bot.timer` with **`CVE_BOT_ENABLED=1`** in `/etc/default/gittr-cve-bot` scans opted-in owners and opens one calm Issues tracking entry + DM for each new eligible finding. Opted-in = `events.security_cve` on 30078. Scans **owned** 30617 repos only (not watched/starred); fork/import if you want another project covered. **Same opt-in** also DMs HIGH/CRITICAL early warnings from the public [Vulnerability Spoiler Alert](https://vulnerabilityspoileralert.com/feed.xml) RSS when a direct dep looks related (DM-only, **not** on Dependencies / no auto-issue). Feed down → log + OSV path continues. **Public issue links** use `https://gittr.space/npub1…/reponame/issues/{id}` (`nip19.npubEncode` via `buildCvePublicIssueUrl`) — never hex pubkeys in the path; DM/issue copy uses the human repo name only. **Freshness:** bot only alerts when gittr bridge tip **equals** Nostr kind **30618** HEAD tip; no tip or tip mismatch → skip. Users should **sync from source (if GitHub/forge moved) + Push** so the announcement matches the mirror — browser-only refetch without Push does not fix mismatch. **Dedup:** one alert per `owner|repo|advisory|package` forever after successful send (Refetch/Push does not re-spam); spoiler keys are separate (`spoiler:guid`). Help: `/help#security-alerts`.

**Server-only runtime data (`/opt/ngit/data`):** these JSON files are written by the live server / CVE bot and must **never** be uploaded from a laptop (local is always older or empty). `./upload_to_hetzner.sh` may `mkdir -p` the directory only — never `rsync`/`scp`/`--delete` into it — and aborts if consent/dedup/pending fingerprints change mid-deploy. Also never overwrite `/etc/default/gittr-cve-bot` from a laptop (live `CVE_BOT_ENABLED` + absolute paths).

| File | Purpose |
|------|---------|
| `/opt/ngit/data/notifications-consent.json` | Who subscribed + Telegram IDs (`NOTIFICATIONS_CONSENT_PATH`) |
| `/opt/ngit/data/cve-bot-dedup.json` | Who already got which advisory (`CVE_BOT_DEDUP_PATH`) |
| `/opt/ngit/data/cve-bot-pending.json` | Leftover queue if ENABLED was off (`CVE_BOT_PENDING_PATH`) |
| `/opt/ngit/data/cve-spoiler-dedup.json` | Spoiler RSS early-warning dedup (`CVE_SPOILER_DEDUP_PATH`) |
| `/opt/ngit/data/cve-consent.json` | Legacy name — prefer notifications-consent |
| `/opt/ngit/data/lab-snapshot/index.html` | Scrubbed security-lab dashboard HTML for `/lab` — push with `./scripts/push-lab-snapshot.sh` (not via full deploy). Served via `/api/lab/snapshot` with sanitizer that keeps **inline** map scripts + JSON data, strips external `script src`, blocks `connect-src`, iframe `sandbox="allow-scripts"` (no same-origin). Injected height `postMessage` + ResizeObserver so the frame grows with content (no inner scrollbar; gittr page is the only scroller). Sanitizer strips snapshot `resize→fitCamera` and the parent only grows the iframe so auto-height cannot reset map zoom. |
| `/opt/ngit/data/lab-snapshot/nostr-seo-repos-snapshot.json` | Server-only copy of the daily SEO repo index (same bytes as `/opt/ngit/ui/data/nostr-seo-repos-snapshot.json`). Updated by `gittr-seo-repo-index-refresh.service` `ExecStartPost` for lab agents — not a public gittr API. |

Gitignore covers `data/` and those filenames. Back up this tree with bridge secrets; restore only intentionally.

**CVE bot — live production:** `/etc/default/gittr-cve-bot` must have **`CVE_BOT_ENABLED=1`** (see `infra/systemd/gittr-cve-bot.defaults.example` — copy once on the server, never overwrite from deploy). Daily timer runs `npx tsx scripts/cve-bot.mts` with that env. Opt-ins come from relay kind 30078 **and** `notifications-consent.json` (`events.security_cve`). Scans only succeed when the repo has **bridge files on gittr**; if kind **30618** HEAD ≠ bridge tip, that repo is skipped. New eligible findings → Issues tracking entry + DM immediately (npub-formatted links). If ENABLED is accidentally off, candidates queue to `cve-bot-pending.json` instead; optional one-shot drain:

```bash
# on Hetzner — temporary flag only, then clear it
echo 'CVE_BOT_SEND_PENDING=1' >> /etc/default/gittr-cve-bot
systemctl start gittr-cve-bot.service
# wait for finish; journalctl -u gittr-cve-bot -n 80
sed -i '/^CVE_BOT_SEND_PENDING=/d' /etc/default/gittr-cve-bot
```

**Re-alert / anti-spam:** each finding is keyed `owner|repo|advisoryId|packageName` in **`cve-bot-dedup.json`**. After a successful issue + DM, that key is **permanent** — Refetch/Push and the next daily run do **not** re-DM the same vulnerability. A **new** advisory or a **different** package gets one new alert. Spoiler early warnings use a separate key in **`cve-spoiler-dedup.json`**. Tip mismatch → skip (no nagging on unsynced mirrors). Keep **`CVE_BOT_ENABLED=1`** on production. Node needs `ws` WebSocket polyfill in the bot (already wired). Logs: `journalctl -u gittr-cve-bot -n 100`.

**Pyramid / relay.gittr.space:** add **`30078`** to production `open_kinds_spec` (see pyramid `FORGE.md` / Settings UI), then `systemctl restart pyramid` — otherwise non-members cannot publish prefs to the forge relay. Help: `/help#security-alerts`.

**Non-GitHub import (`/new` Option 1):** GitLab / Codeberg / Gitea / self-hosted HTTPS or `git@` URLs go to **`POST /api/import-git`** (server `git clone --depth 1`). GitHub uses **`POST /api/import`**. **Nostr-only** repos: paste `npub…/repo`, a `gittr.space/npub…/repo` page URL (rewritten to `git.gittr.space`), or a GRASP clone URL — also `/api/import-git`. The **Fork** button (`/new?fork=npub/repo`) uses the same import path (forge `source` first, else `clone[]` / inferred GRASP), not empty-create. Bulk **`/import`** remains **GitHub-only** (list + multi-select); other forges and nostr-only must use Option 1 (or Fork) one repo at a time. After import, **Push** defers to the bridge cloning the `source` URL for any cloneable HTTPS/git@ remote (not only github.com / gitlab.com / codeberg.org), so metadata-only imports do not publish empty bare repos.

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| UI down / slow then 504 | Check `next-server` RSS (`ps -o rss,etime -C next-server`). ~2 Gi+ on a 4 Gi box = restart with `systemctl restart gittr-frontend`. Prefer unit with `MemoryMax` from `infra/systemd/gittr-frontend.service`. Not caused by lab snapshot/`cp` of SEO JSON. |
| UI down | `journalctl -u gittr-frontend -n 100`, `WorkingDirectory`, `.env.local`, `yarn build` |
| Bridge no relays | `relays` in JSON vs `.env.local`; `journalctl -u git-nostr-bridge` |
| `git` asks for password | Key in Settings → SSH Keys; `authorized_keys` path for `git@`; [SSH_GIT_GUIDE.md](SSH_GIT_GUIDE.md) |
| Paywall on `git push` | Pay invoice in UI; owner LNbits/Blink in Settings → Account; [NIPS_AND_EVENT_KINDS.md](NIPS_AND_EVENT_KINDS.md) |
| Empty Code tab (GRASP) | [FILE_FETCHING_INSIGHTS.md](FILE_FETCHING_INSIGHTS.md), `POST /api/nostr/repo/clone` |
| Empty Code tab (home Freebox / NAS `clone[]`) | Same doc — `repo-files` runs on the **app host**; hostname must resolve/reach from Hetzner (LAN-only remotes stay empty until a public clone is published) |
| Pages 502 on upload | nginx `proxy_read_timeout` on `/api/`; Blossom URL in env |
| Mass `/api/*` 502 during deploy | Expected while `systemctl restart gittr-frontend` — nginx `Connection refused` to `:3000`. Avoid overlapping deploys; officecli-style “everything 502 then 429” often coincides with a restart + crawler storms on absurd nested `?path=` URLs (fixed by `isAbsurdRepoPath` + no root-README under nested folders — see [FILE_FETCHING_INSIGHTS.md](FILE_FETCHING_INSIGHTS.md)) |

---

## Docker (alternative)

Bridge-only in Docker: [GIT_NOSTR_BRIDGE_SETUP.md](GIT_NOSTR_BRIDGE_SETUP.md) — `ui/gitnostr/Dockerfile`, `docker compose`. Go install on the host not required for that path.

---

## Updates

```bash
cd /opt/gittr && git pull
cd ui && yarn install && yarn build
sudo systemctl restart gittr-frontend
# bridge: as git-nostr — pull, make, restart git-nostr-bridge
```

Backups: `git-nostr-bridge.json`, `git-nostr-db.sqlite`, `git-nostr-repositories/`, `ui/.env.local`, and **`/opt/ngit/data/`** (notification consent + CVE bot pending/dedup — server-owned, never overwrite from laptop deploy).
