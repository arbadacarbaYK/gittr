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
- **GitHub upstream tabs**: Issues/PRs/Commits/Releases soft-refresh from GitHub when `sourceUrl` is known (not only at Push/import). Releases persist in `gittr_releases__*` (same pattern as issues) so the tab works without a prior Code visit / `gittr_repos` row. Repo **ToDo** tab also imports **GitHub Projects V2** (read-only) via GraphQL (`POST /api/github/graphql`); optional `GITHUB_PLATFORM_TOKEN` improves rate limits / visibility.
- **App announce (NIP-82 / Zapstore)**: owners publish from the repo Code sidebar (**Announce app**). Requires a linked GitHub/Codeberg/GitLab `sourceUrl` with a forge **Release** that includes an `.apk`. gittr does **not** store APKs; events point at forge download URLs. Optional `GITHUB_PLATFORM_TOKEN` improves GitHub Releases rate limits for `GET /api/repo/forge-releases`. See NIP-82 section in [NIPS_AND_EVENT_KINDS.md](NIPS_AND_EVENT_KINDS.md).

PWA: optional; needs HTTPS in production (`ui/public/site.webmanifest`, `sw.js`).

### Homepage “Most Active” leaderboard (server snapshot)

The homepage cards call **`GET /api/stats/platform-leaderboard`**. Heavy Nostr relay scans no longer block the first paint:

- Cached JSON: **`ui/data/platform-leaderboard-snapshot.json`** (created on the server after the first successful refresh).
- **Serve immediately** from disk when the file exists; response may include `refreshing: true` while a background relay scan runs.
- **Disk refresh** when the snapshot is older than **3 hours** (`DISK_REFRESH_AFTER_MS` in the API route).
- Stale disk older than **7 days** is ignored and a full refresh is forced.
- After deploy, warm the snapshot once: `curl -sS https://YOUR_DOMAIN/api/stats/platform-leaderboard | head` (first call may take minutes; later calls should be sub-second).

**Hourly refresh (recommended on production):** install the systemd timer so the snapshot updates even when nobody visits the homepage:

```bash
./scripts/install-gittr-leaderboard-timer.sh YOUR_SERVER_IP
```

This installs `gittr-leaderboard-refresh.timer` (runs every hour) and a oneshot service that calls `http://127.0.0.1:3000/api/stats/platform-leaderboard?refresh=1` on the app host. Unit files live in `infra/systemd/`. Override the URL in `/etc/default/gittr-leaderboard-refresh` if needed:

```bash
GITTR_LEADERBOARD_URL=http://127.0.0.1:3000/api/stats/platform-leaderboard?refresh=1
```

Check status: `systemctl list-timers gittr-leaderboard-refresh.timer` and `journalctl -u gittr-leaderboard-refresh.service --since today`.

### SEO sitemap repo index (daily, explore-class)

`/sitemap.xml` merges live Nostr discovery with a **disk snapshot** of public repos (same filters as explore/sitemap: deletions, private, blocklist, unusable clones). Install the daily timer so the snapshot stays warm even when crawlers do not hit the sitemap:

```bash
./scripts/install-gittr-seo-repo-index-timer.sh YOUR_SERVER_IP
```

- Calls `http://127.0.0.1:3000/api/seo/refresh-nostr-repo-index?refresh=1`
- Writes `ui/data/nostr-seo-repos-snapshot.json` on the app host
- Override URL in `/etc/default/gittr-seo-repo-index-refresh` if needed
- See [SEO.md](SEO.md) for details

Optional: tie refresh to your SEO/repo-discovery cron by hitting the same URL after indexing runs (timer replaces a manual cron line for this endpoint).

### Homepage “Recent repositories” (live relay query)

The **Recent repositories** strip is **not** taken from the 3h leaderboard snapshot. It uses a separate endpoint so pushes show up without waiting for the heavy platform stats job:

- **`GET /api/stats/recent-repos`** — queries Nostr relays for the latest kind **30617/30618** announcements, sorted by `created_at`, returns up to 12 repos.
- Soft-deleted repos (`content`/`tags` with `deleted:true`, see `repo-deleted.ts`) are excluded — a delete republish must not appear as a “new” recent repo.
- **Server cache ~45s** (`Cache-Control` + in-memory) so the homepage can poll without hammering relays.
- The UI shows this list for **both logged-in and logged-out** users (do not substitute the visitor’s localStorage sync — that caused mismatched homepage lists).
- Warm after deploy: `curl -sS https://YOUR_DOMAIN/api/stats/recent-repos | head` (first call can take several seconds while relays respond).

### Homepage “Recent Activity” / “Your recent activity”

- **Logged out:** shared platform feed from the leaderboard snapshot / live Nostr scan (commits, PRs, issues, repo creates across the network).
- **Logged in:** only activity on **repos you own or can write** (local `gittr_activities` merged with the platform feed filtered by owner/access). Title becomes **Your recent activity**.
- Cards deep-link to the matching tab (`/pulls`, `/issues`, `/commits`, `/releases`, or a specific PR/issue id when known) and use a hard navigation to avoid soft-router crashes into heavy repo pages.

### Profile repo list (logged-out visitors)

Profile pages show a **repo count** from Nostr stats, but the grid used to rely on **localStorage** only (empty for anonymous visitors). Public profiles now load repos from the server:

- **`GET /api/nostr/profile-repos?ownerPubkey=<64-char-hex>`** — fetches kind **30617/30618** for `authors: [pubkey]` on **`PROFILE_REPOS_RELAYS`** (stats relays + NIP-34 discovery: `relay.ngit.dev`, shakespeare, nostrhub, gitnostr, …). Slim `PLATFORM_STATS_RELAYS` alone misses NostrHub/ngit-only announcements. Rows include `name` / `description` from 30617 tags when present; **30618** updates activity timestamps without wiping announcement text.
- The profile page passes the decoded hex pubkey (npub URLs are decoded client-side; do not pass npub to this API).
- Response is **field-merged** with local repos (`mergeProfileRepoList`): sparse network rows must not erase About text, display names, or `userRole` (owner cards flipping to contributor green).
- Below Repositories, the same profile also lists that person’s **Pages** (from **`GET /api/gittr-pages/status-sites`**, filtered by author pubkey / `npub…` site hostname) and **Apps** (from **`GET /api/nostr/software-catalog`**, filtered by publisher pubkey or NIP-82 `p` attribution). UI: `ProfilePagesAppsSections`.
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

Use **absolute paths**. `gitRepoOwners: []` allows any pubkey to create repos. Relays = same set as `NEXT_PUBLIC_NOSTR_RELAYS`.

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

**Frontend** — `/etc/systemd/system/gittr-frontend.service` (adjust paths/user):

```ini
[Unit]
Description=gittr Frontend
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/gittr/ui
ExecStart=/usr/bin/yarn start
Environment=NODE_ENV=production
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

Optional rate-limit exemptions in `ui/.env.local`: `GITTR_RATE_LIMIT_EXEMPT_PUBKEYS`, `GITTR_RATE_LIMIT_EXEMPT_IPS` (restart frontend after change).

**Typical env (also in `.env.example`):**

```
NEXT_PUBLIC_DOMAIN=your.domain
NEXT_PUBLIC_GIT_SSH_BASE=your.domain
NEXT_PUBLIC_SITE_URL=https://your.domain
NEXT_PUBLIC_GIT_SERVER_URL=https://git.your.domain
NEXT_PUBLIC_GITTR_PAGES_URL=https://pages.your.domain
```

**Repo page UI:** Default is the next look (kind-0 banner + identity hero on every `[entity]/[repo]/*` tab, including Settings). Same Code/APIs/forms for all entities. Rollback: `NEXT_PUBLIC_REPO_UI=classic` and rebuild. Legacy `…/next` URLs redirect to the Code page. Repo tabs (Code, Issues, Settings, …) use client-side Next.js navigation so the shared layout chrome stays mounted and does not re-fetch header Nostr/GitHub data on every tab click.

`NEXT_PUBLIC_GIT_SERVER_URL` may be the **host only** (e.g. `https://git.gittr.space`). Announcements must still publish **full** clone URLs (`https://git…/<npub>/<repo>.git`). The UI expands host-only values in `buildUnsignedRepositoryEvent`; do not hand-publish bare hosts into kind 30617. On **My Repositories**, owners with only unusable clones (host-only / localhost) see a **Please republish** badge and can batch-republish (one Push + signatures per repo; nsec / NIP-07 / remote signer).

**Push clone mirrors:** hosts from `GRASP_SERVERS_FOR_PUSHING` (env relays) plus the owner’s kind **10317** preferred GRASP list, merged host-deduped via `mergeGraspHostsForPush`. Exclusions in `GRASP_DOMAINS_EXCLUDED_FROM_PUSHING` (e.g. `git-01.uid.ovh`, `git.jb55.com`, `ngit-relay.nostrver.se` while unreachable) never get auto `clone` tags or sync waits — they stay in `KNOWN_GRASP_DOMAINS` for reading other people’s events. The sidebar **Git Server** label prefers `NEXT_PUBLIC_GIT_SERVER_URL` / `git.gittr.space` when that host is on the announcement’s `clone` tags — extra mirrors (shakespeare, ngit, …) stay in the Clone URL list for discoverability, they are not meant to replace the primary git host in that label.

**Repo Links (docs section → 30617):** Simple rules — (1) Import/batch/refetch: GitHub `homepage` → docs link if present, else nothing. (2) Settings: user can add more docs links anytime; all show under Repository Links. (3) Nostr Pages: add a docs link only when the gateway lists the site (not invented). (4) Push publishes whatever is in `repo.links`. Never invent `owner.github.io` or `*.pages.gittr.space`. (5) NIP-34 `web` browse URLs from other forges (e.g. `gitworkshop.dev/…/relay…/repo`) are **not** shown as Documentation; Iris `git.iris.to` remains labeled **Iris Git**. Logo URLs are not published in `web`.

**Repo About (Settings → Description):** Owner text is authoritative. Saving Settings writes localStorage, publishes kind **30617** `description`, and notifies the Code page (`gittr:repos-updated`). GitHub mirror hydrate must not replace a non-placeholder About (stars/forks/activity still sync). See [FILE_FETCHING_INSIGHTS.md](FILE_FETCHING_INSIGHTS.md).

**Folder uploads respect .gitignore:** the repo Upload page filters staged files against every `.gitignore` in the uploaded tree (root + nested, incl. `!` negation, `**`, dir patterns) and always drops `.git/` internals — so drag & dropping a working copy cannot leak `node_modules`, build output, or `.env` secrets. `.gitignore` files themselves are kept. Logic + tests: `ui/src/lib/repos/gitignore-upload-filter.ts`.

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

**Security audit (Dependencies tab):** the user-facing audit UI (badge, homepage blurb, help topic, settings toggle) is gated behind `NEXT_PUBLIC_SECURITY_AUDIT_UI=1` at build time and ships dark by default — only enable it once `node scripts/self-audit.mjs` reports zero advisories for this instance's own tree AND the git server (bridge) serves the fixed lockfile (the badge scans the *pushed* repo state, not your working tree). The `/api/security/audit` endpoint itself is always on. each repo's Dependencies page runs a client-side scan of package manifests (`package.json`, `package-lock.json`, `yarn.lock`, `requirements.txt`, `go.mod`, `Cargo.lock`, `Gemfile.lock`, `composer.lock` — parsed by `ui/src/lib/security/dependency-manifest-parser.ts`) and checks the extracted packages against **OSV.dev** via `POST /api/security/audit` (no API key needed; the server batch-queries OSV and caches advisory details for 6h). Results render as a severity-sorted advisory list (`RepoSecurityAudit.tsx`) with CVE/GHSA links. Versions from lockfiles are `pinned`; versions inferred from `package.json` ranges are marked `approx. version` (lower bound) so false-positive risk is visible. The badge separates **confirmed** advisories (exact lockfile-pinned version inside the advisory's affected range) from **unconfirmed** range-derived hints (collapsed, never counted as alarms). Phase 2 — **planned, NOT enabled**: a Dependabot-style bot that opens a NIP-34 issue on the affected repo using the server's platform key (`NOSTR_NSEC`, never a user key), so owners are alerted through their normal issue notifications. Fires only on confirmed (pinned + direct) matches and is **strictly opt-in, default OFF** — the bot must never alert an owner who has not explicitly opted in. **Consent must be verifiable server-side:** the `security_cve` toggle in Settings → Notifications lives in browser localStorage, which a server bot cannot read — it gates in-app UI only. Before the bot ships, opt-in needs a bot-readable source of truth: either an owner-signed opt-in event on relays (e.g. kind 30078 app-data listing opted-in repos or "all"), or a signed registration stored by this instance. If the bot cannot verify a signed opt-in for that owner, it must not alert — regardless of severity. **Repo eligibility (bridge NOT required):** the bot's canonical source is the latest kind 30617 announcement — owner/maintainers from its author + `maintainers` tag, sources from its `clone` tags. A bridge copy is just one possible remote; repos never pushed to this bridge are still eligible if an announced clone URL is reachable. A repo is ineligible (silently skipped, never alerted) when any of these fail: no 30617 announcement found, no announced clone URL reachable, freshest tip not confirmable (see freshness guard below), no manifests with pinned versions at that tip, or no verifiable opt-in. **Dedup is per advisory+package+repo and permanent** — the bot must persist which advisory IDs it already opened an issue for (per repo) and never re-alert on subsequent runs finding the same advisory; only a genuinely new advisory (or the same one reappearing after the owner fixed and closed it) may open a new issue. Scan cadence today: the audit runs client-side on every Dependencies-tab visit (no scheduler); the OSV advisory cache is 6h. The future bot needs its own scheduled run (e.g. daily) — visits must never be what triggers owner alerts. No unsolicited DMs. "Direct" means listed in the repo's own manifest (`package.json` deps/devDeps, non-`// indirect` in `go.mod`, etc.) — hoisted transitives at top-level `node_modules/` do NOT count (parser reads the lockfile root entry; directness also propagates by name from `package.json` to `yarn.lock` pins in `mergeManifestPackages`). **Freshness guard (hard requirement before the bot may ever alert):** the bridge's bare clone can be stale — owners push via other GRASP servers (relay.ngit.dev, git.shakespeare.diy, gitnostr.com) or only to their forge; a dry-run on 2026-08-08 found 4 of 6 sampled repos behind their origin (up to 3 months). Before alerting, the bot must `git fetch` the repo's announced clone URLs (NIP-34 kind 30617 `clone` tags — the bridge bare repos already carry `origin`) and/or compare against the announced HEAD in the kind 30618 state event, scan the freshest tip only, and include the scanned commit hash in the issue for auditability. If freshness cannot be confirmed, do not alert. The badge shows what *this instance serves* (acceptable; it is what a cloner gets here), the bot must not. Dry-run the whole pipeline anytime with `npx tsx scripts/bot-dryrun.mts` (read-only; prints the would-be issues). Do not activate the bot until match quality has been observed in production; user-facing explanation lives at `/help#security-alerts`.

**Non-GitHub import (`/new` Option 1):** GitLab / Codeberg / Gitea / self-hosted HTTPS or `git@` URLs go to **`POST /api/import-git`** (server `git clone --depth 1`). GitHub uses **`POST /api/import`**. The Import button shows an “Importing…” state and status under the control; web UI paths like `…/-/tree/main` are stripped before clone. Bulk **`/import`** remains **GitHub-only** (list + multi-select); other forges must use Option 1 one repo at a time. After import, **Push** defers to the bridge cloning the `source` URL for any cloneable HTTPS/git@ remote (not only github.com / gitlab.com / codeberg.org), so metadata-only imports do not publish empty bare repos.

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| UI down | `journalctl -u gittr-frontend -n 100`, `WorkingDirectory`, `.env.local`, `yarn build` |
| Bridge no relays | `relays` in JSON vs `.env.local`; `journalctl -u git-nostr-bridge` |
| `git` asks for password | Key in Settings → SSH Keys; `authorized_keys` path for `git@`; [SSH_GIT_GUIDE.md](SSH_GIT_GUIDE.md) |
| Paywall on `git push` | Pay invoice in UI; owner LNbits/Blink in Settings → Account; [NIPS_AND_EVENT_KINDS.md](NIPS_AND_EVENT_KINDS.md) |
| Empty Code tab (GRASP) | [FILE_FETCHING_INSIGHTS.md](FILE_FETCHING_INSIGHTS.md), `POST /api/nostr/repo/clone` |
| Empty Code tab (home Freebox / NAS `clone[]`) | Same doc — `repo-files` runs on the **app host**; hostname must resolve/reach from Hetzner (LAN-only remotes stay empty until a public clone is published) |
| Pages 502 on upload | nginx `proxy_read_timeout` on `/api/`; Blossom URL in env |

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

Backups: `git-nostr-bridge.json`, `git-nostr-db.sqlite`, `git-nostr-repositories/`, `ui/.env.local`.
