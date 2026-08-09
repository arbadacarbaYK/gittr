# SEO & discoverability (gittr)

How search engines and social previews find gittr content. Marketing copy was updated to describe **use cases** (mirror, collaborate, Pages, apps, bounties) instead of positioning as a “GitHub alternative,” while keeping technical terms like NIP-34 and GRASP for people who search for them.

## What controls SEO in the codebase

| Surface | Location | Notes |
| --- | --- | --- |
| Default title, description, keywords, Open Graph | `ui/src/lib/seo/site-metadata.ts` | Root card via `buildRootSiteMetadata()`; per-route cards via `buildPageSiteMetadata({ path, title, description })` so X/Telegram do not reuse the homepage `og:url` |
| Hub routes (`/pages`, `/apps`, `/explore`, `/new`, `/legal`) | respective `page.tsx` / `layout.tsx` | Must set full `openGraph` + `twitter` + `canonical` (title alone is not enough for social crawlers) |
| Route OG images | `ui/src/app/opengraph-image.tsx`, `apps/`, `pages/`, `explore/`, `[entity]/[repo]/` (+ matching `twitter-image.tsx`) | Hub taglines via `create-og-image.tsx`; repo cards via `create-repo-og-image.tsx` |
| Per-repo title / description / OG image | `ui/src/app/[entity]/[repo]/layout.tsx` + `opengraph-image.tsx` | Composed **1200×630** dark card: name, owner, About, corner badge; stats as **GitHub icon + ★ count**, fork icon + count, **N + ★** for Nostr (no “source stars” prose). Brand bottom-right (X uses bottom-left). |
| `robots.txt` | `ui/src/app/robots.ts` | Allows `/` and explicitly `/new` (create/import social cards); disallows `/api/`, `/login`, `/signup`, `/settings/`, `/import`. `force-dynamic` so validators don’t keep a stale Disallow forever. |
| `sitemap.xml` | `ui/src/app/sitemap.ts` | **Dynamic** — built at request time on the server (not a static file in git) |
| PWA manifest | `ui/public/site.webmanifest` | Short description for install prompts |
| Canonical / `metadataBase` | `NEXT_PUBLIC_SITE_URL` | Must be `https://your.domain` in production |

After changing `site-metadata.ts` or env, rebuild and restart the Next app (`yarn build` + `gittr-frontend`).

## Sitemap: local vs production

The sitemap **exists in code everywhere** (`ui/src/app/sitemap.ts`). It is **not** a file you commit (except optional extras below).

When something requests `/sitemap.xml`, Next.js runs `sitemap()` which:

1. Adds static URLs: `/`, `/explore`, `/help`, `/pages`
2. Loads the **daily SEO snapshot** (`ui/data/nostr-seo-repos-snapshot.json`) when present — explore-class discovery (env relays + known GRASP `wss://` hosts), with deletions / private / blocklist applied
3. **Queries Nostr relays** live (same discovery set) for repository announcements (kinds **51** and **30617**) → merges with the snapshot
4. Fetches **gittr Pages** manifest from `NEXT_PUBLIC_GITTR_PAGES_URL` (default `https://pages.gittr.space`) → published site URLs
5. Optionally merges lines from **`nostr-pushed-repos.txt`** (gitignored; gittr-HTTP-push / manual supplement only)

### Daily SEO repo index (recommended on production)

Explore discovers public Nostr repos (not only repos people Push’d from gittr). The sitemap already queries Nostr, but a **daily background refresh** writes a durable disk snapshot so crawlers still get a full list when a live relay query times out.

The same snapshot **seeds `/explore`** when the browser cache is thin (`GET /api/explore/seed?limit=3000` reads `ui/data/nostr-seo-repos-snapshot.json` — no live relay round-trip). Client Nostr sync still runs afterward to enrich. Seed/sync writes go through `saveStoredRepos` (slim metadata only — no file trees). If localStorage is full, Explore keeps a **session catalog in memory** (and still shows those repos) while reclaiming space (evict `gittr_files__*` / other caches, progressive caps, ultra-slim rows). Soft merge cap is **3000**. Load-more is only UI page size (**48**), not the catalog ceiling. A prior bug reloaded Explore from localStorage after every failed persist, which froze the UI around ~180–190 repos even while relays kept sending events.

**My Repositories** (`/repositories`) had the same quota trap: raw `localStorage.setItem("gittr_repos")` threw `QuotaExceededError`, and the catch path set the list to `[]` — so your own repos vanished while the console still logged hundreds of NIP-34 events. It now persists via `saveStoredRepos` (preferring your `ownerPubkey` when capping), keeps a session catalog, and never blanks the UI on save failure. Flush controls are labeled by scope: **Flush my own repos cache** (`clearOwnReposFromStorage`) vs **Flush others' repos cache** (`clearForeignReposFromStorage`); mobile uses short labels (“Flush my repos” / “Flush others”). Both hard-assign `/repositories` so a reload does not restore a prior repo tab from bfcache/history.

**Reverse forge lookup:** the SEO seed only stores `npub/repo` paths — **no** upstream URLs. To find whether a GitHub/GitLab/Codeberg/Gitea/… repo already has a Nostr announce (and get the **npub** to DM), use exact match on kind **30617** `source` / `forkedFrom`: MCP `findReposBySource` or `GET /api/nostr/repos-by-github?source=https://…`.

**Client chrome on Explore:** leaving `/explore` (logo, personal menu, top nav) uses a hard `location.assign` via `appNavigate` when Explore is busy with relay streams. Soft App Router `push` after `preventDefault` can look like a dead click. Search already hard-assigns into Explore for the same reason.

```bash
./scripts/install-gittr-seo-repo-index-timer.sh YOUR_SERVER_IP
```

- Timer: `gittr-seo-repo-index-refresh.timer` (**daily**)
- Endpoint: `GET /api/seo/refresh-nostr-repo-index?refresh=1` (localhost via systemd)
- Snapshot path: `/opt/ngit/ui/data/nostr-seo-repos-snapshot.json`
- Status (no refresh): `curl -sS http://127.0.0.1:3000/api/seo/refresh-nostr-repo-index`
- Logs: `journalctl -u gittr-seo-repo-index-refresh.service --since today`

A refresh that returns **0** paths does **not** overwrite the previous snapshot. Soft-deletes and NIP-09 deletions are applied on each successful rewrite.

This is **independent** of `nostr-pushed-repos.txt` / `scan-gittr-http-pushed-repos.sh` (those only supplement gittr bridge pushes).

### Why it can look “server-only”

- **Production** has relays configured, outbound network, and often a local `nostr-pushed-repos.txt` at `/opt/ngit/nostr-pushed-repos.txt` (uploaded by `upload_to_hetzner.sh`).
- **Local dev** only lists many repos in the sitemap if `ui/.env.local` has the same relay list and the dev server can reach relays.

**Test locally:**

```bash
cd ui
# Ensure NEXT_PUBLIC_NOSTR_RELAYS and NEXT_PUBLIC_SITE_URL are set in .env.local
yarn dev
# In another terminal:
curl -s http://localhost:3000/sitemap.xml | head -40
```

**CI / offline build (no relay calls):**

```bash
SITEMAP_SKIP_NOSTR=1 SITEMAP_SKIP_GITTR_PAGES=1 yarn build
```

**Optional file (not in GitHub):**

```bash
cp nostr-pushed-repos.example.txt nostr-pushed-repos.txt
# Add lines: npub1…/my-repo  (public repos only — private repos must not be listed)
```

**Private repositories:** Omitted from `/sitemap.xml`, home “recent repos”, and platform leaderboard when the Nostr announcement has `public-read: false` (or the bridge DB marks `PublicRead = 0`). Repo pages emit `noindex` for private repos. The optional `nostr-pushed-repos.txt` file is manual — do not list private paths there. Server script `scripts/scan-gittr-http-pushed-repos.sh` skips private rows when the bridge SQLite DB is present.

Paths checked: repo root `nostr-pushed-repos.txt` or `ui/nostr-pushed-repos.txt`. Deploy script copies root file to the server when present.

## SEO strategy (practical)

- **Index what matters:** Home, explore, help, public repo pages, Pages directory — via sitemap + internal links.
- **Don’t index auth flows:** `robots.ts` blocks `/login`, `/signup`, `/settings/`, `/api/`, `/import`. `/new` (create/import hub) is **allowed** so X/Telegram can load its OG card.
- **Keywords:** Prefer “nostr git”, “NIP-34”, “GRASP”, “Lightning bounties”, “mirror git repository” — still accurate, less likely to trip naive “fake GitHub” heuristics than “github alternative”.
- **Import is a feature, not the headline:** README and meta mention importing from GitHub/GitLab/Codeberg under **mirror / backup**, not as the product identity.
- **Reputation ≠ SEO:** Google Safe Browsing clean + good sitemap does not fix Sophos category or LinkedIn link wrappers; see IT reclassification for those.

## Social previews (X, Telegram, LinkedIn)

- Homepage vs hubs: `/`, `/apps`, `/pages`, `/explore`, and `/new` each have their own **title**, **description**, and **OG image** (`buildPageSiteMetadata` + route `opengraph-image.tsx`). Do not reuse homepage copy for hub links. `/new` is **Create or import** — Nostr git create plus batch import/mirror from foreign forges (GitHub/GitLab/Codeberg).
- Repo cards (`create-repo-og-image.tsx`): keep the **bottom-left corner empty** — X overlays the link name chip there. Brand (`gittr · nostr`) + `NIP-34` sit **bottom-right**.
- **Canonical share URL** is always `/{entity}/{repo}` (no `?branch=` / `?file=` / tab path). Nested pages inherit the same `og:image`; Share/QR copies the root so social caches do not fork per deep link. File “Copy permalink” stays deep for collaborators.
- `og:image` / `twitter:image` are emitted as **absolute `https://`** URLs (`normalizeSocialImageUrl` + `getPublicSiteUrl`). Scheme-less pastes like `gittr.space` still resolve to HTTPS HTML; if `NEXT_PUBLIC_SITE_URL` were `http://…`, non-localhost hosts are upgraded to `https://` so messengers do not drop the card image.
- Use full `https://` in `NEXT_PUBLIC_SITE_URL` in production.
- After meta changes, caches (X, Telegram, Cloudflare) may lag — purge CDN or use platform debug tools. Repo OG URLs include `?v=…` (and Next’s content hash) so composition changes force a new image URL; paste the **page** URL again in a third-party card checker after deploy (X’s official Card Validator is retired).
- **X previews need a fast `og:image`:** Twitterbot often drops the card if the image takes longer than ~3–5s. Repo cards use a ~2.2s fetch budget + `revalidate = 3600` so the PNG is usually ready in time. HTML meta alone is not enough — X still fetches the image URL.

## Related

- Deploy env and sitemap flags: `docs/SETUP_INSTRUCTIONS.md` (Sitemap / SEO section)
- Publisher blocklist (excludes pubkeys from sitemap): `NEXT_PUBLIC_PUBLISHER_BLOCKLIST`
