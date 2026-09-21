# SEO & discoverability (gittr)

How search engines and social previews find gittr content. Marketing copy describes **use cases** (Nostr git hosting, mirror, collaborate, Pages, apps, bounties) and technical terms people search for (NIP-34, GRASP, git on Nostr). The daily **repo index snapshot** that fills `/sitemap.xml` at scale is built on the production host — do not overwrite it from a laptop.

## What controls SEO in the codebase

| Surface | Location | Notes |
| --- | --- | --- |
| Default title, description, keywords, Open Graph | `ui/src/lib/seo/site-metadata.ts` | Root card via `buildRootSiteMetadata()`; per-route cards via `buildPageSiteMetadata({ path, title, description })` so X/Telegram do not reuse the homepage `og:url` |
| Hub routes (`/pages`, `/apps`, `/explore`, `/new`, `/legal`, `/help`, `/bounty-hunt`, `/nostr-git`) | respective `page.tsx` / `layout.tsx` | Must set full `openGraph` + `twitter` + `canonical` (title alone is not enough for social crawlers). `/help` and `/bounty-hunt` are `"use client"` pages — metadata lives in `layout.tsx` so they do **not** inherit the homepage canonical. |
| Route OG images | `ui/src/app/opengraph-image.tsx`, `apps/`, `pages/`, `explore/`, `help/`, `bounty-hunt/`, `nostr-git/`, `[entity]/[repo]/` (+ matching `twitter-image.tsx`) | Hub taglines via `create-og-image.tsx`; repo cards via `create-repo-og-image.tsx` |
| Per-app title / description | `ui/src/app/apps/[id]/page.tsx` | Stable `/apps/{packageId}` URLs from the software catalog snapshot (legacy `/apps?q=` still filters). `/apps/mine` is `noindex`. |
| JSON-LD | `ui/src/lib/seo/json-ld.ts` | `WebSite` + SearchAction on every page; `SoftwareApplication` on home; `SoftwareSourceCode` on repo layouts; `TechArticle` + FAQ on `/nostr-git`; per-app `SoftwareApplication` when the catalog knows the id. |
| `llms.txt` | `ui/public/llms.txt` | Short product map for AI crawlers (`https://gittr.space/llms.txt`). |
| Per-repo title / description / OG image | `ui/src/app/[entity]/[repo]/layout.tsx` + `opengraph-image.tsx` | Composed **1200×630** dark card: name, owner, **About**, corner badge; stats as **GitHub icon + ★ count**, fork icon + count, **N + ★** for Nostr. Brand bottom-right (X uses bottom-left). Browsers on vanity paths (`/DrShift/buho-go`) **307** to `/{npub}/buho-go` so files/Push work. **Twitterbot / Telegram / Slack** stay on the vanity HTML so they get title + About without an empty 307 body; `og:url` is still the npub path. Vanity `opengraph-image` / `twitter-image` **307** from the image route itself (layout does not wrap those files) to the npub card so X does not wait on a cold vanity PNG. Bump `GITTR_OG_CARD_REV` / `?v=about4` when the PNG must invalidate. Bare `/DrShift` profile URLs are not rewritten. |
| `robots.txt` | `ui/src/app/robots.ts` | Allows `/`, `/new`, `/apps`, `/help`, `/nostr-git`, `/llms.txt`; disallows `/api/`, `/login`, `/signup`, `/settings/`, `/import`, `/apps/mine`, `/repositories`. **`meta-externalagent` / `Meta-ExternalFetcher` (Meta AI training/index) are Disallow: /**. Do **not** Disallow `facebookexternalhit` (share cards). Do **not** turn on Cloudflare “Block AI Scrapers” — that also hits Claude/GPT. Volume cap is nginx `meta_ai` zone, not a UA 403. `force-dynamic` so validators don’t keep a stale Disallow forever. |
| `sitemap.xml` | `ui/src/app/sitemap.ts` | **Dynamic** — built at request time on the server (not a static file in git) |
| PWA manifest | `ui/public/site.webmanifest` | Short description for install prompts |
| Canonical / `metadataBase` | `NEXT_PUBLIC_SITE_URL` | Must be `https://your.domain` in production |

After changing `site-metadata.ts` or env, rebuild and restart the Next app (`yarn build` + `gittr-frontend`).

## Sitemap: local vs production

The sitemap **exists in code everywhere** (`ui/src/app/sitemap.ts`). It is **not** a file you commit (except optional extras below).

When something requests `/sitemap.xml`, Next.js runs `sitemap()` which:

1. Adds static URLs: `/`, `/explore`, `/nostr-git`, `/apps`, `/help`, `/new`, `/pages`, `/bounty-hunt`, `/lab`, `/legal`
2. Adds per-app URLs `/apps/{id}` from `ui/data/software-catalog-snapshot.json` (cap 2500; production file is written by the live catalog scrape — same “server-owned” rule as the repo snapshot)
3. Loads the **daily SEO snapshot** (`ui/data/nostr-seo-repos-snapshot.json`) when present — **including if it is older than 14 days**
4. **Also** live-relay fan-out if that snapshot is missing or stale (or `SITEMAP_LIVE_NOSTR=1` for debugging) — results **merge** with disk, they do not replace it
5. Fetches **gittr Pages** manifest from `NEXT_PUBLIC_GITTR_PAGES_URL` (default `https://pages.gittr.space`) → published site URLs
6. Optionally merges lines from **`nostr-pushed-repos.txt`** (gitignored; gittr-HTTP-push / manual supplement only)

Repo URLs keep most of the 45k budget; app URLs and Pages fill reserved slices so a large repo snapshot cannot drop `/apps/{id}` from the sitemap.

### Daily SEO repo index (recommended on production)

Explore discovers public Nostr repos (not only repos people Push’d from gittr). A **daily standalone job** (`scripts/refresh-seo-repo-index.mts`) writes a durable disk snapshot; `/sitemap.xml` and `/api/explore/seed` prefer that file so crawlers and cold Explore loads do not fan out to relays inside the live Next process.

The same snapshot **seeds `/explore`** (`GET /api/explore/seed?limit=3000` reads `ui/data/nostr-seo-repos-snapshot.json` **even if it is older than 14 days**, and merges `nostr-pushed-repos.txt`). Explore paints **locals first**, then **pins Home’s live “Recent repositories” at the top in that same order** (stored in the browser so the first paint is not the SEO-cache sort; missing cache rows get stub cards). Extra `relays` tags on announces are **not** dialed, and known-dead hosts (`uid.ovh`, `ngit-relay.nostrver.se`, `/grasp` git paths, dropped social relays) are not opened as WebSockets. Discovery is gittr’s NIP-34 set plus the visitor’s NIP-65 list. **Never deploy a laptop `ui/data/nostr-seo-repos-snapshot.json` over Hetzner** — the live file is server-owned (`/opt/ngit/ui/data/…`); rebuild it with `systemctl start gittr-seo-repo-index-refresh.service`. The daily job must be allowed the full 120s relay window (a 50s hard-cap used to abort with 0 paths and leave deleted repos in a weeks-old file). Sitemap still fans out to live relays when the snap is missing *or stale*, then **merges** with the disk file so a failed nightly job cannot shrink the index to the pushed-repos file. Client Nostr sync still runs afterward to enrich, and it now **immediately** queries the same NIP-34 discovery relays as profile (`relay.gittr.space`, `relay.ngit.dev`, shakespeare, nostrhub, gitnostr, …) — not Dan Conway’s public GRASP. Extra `relays` tags on announces are dialed **once** per host; websites and git HTTPS hosts (`gitworkshop.dev`, `git.gittr.space`) are never opened as `wss://`. Seed/sync writes go through `saveStoredRepos` (slim metadata only — no file trees). If localStorage is full, Explore keeps a **session catalog in memory and sessionStorage** (and still shows those repos) while reclaiming space (evict `gittr_files__*` / other caches, progressive caps, ultra-slim rows). That session list **survives leaving `/explore` and searching on Explore** (search uses `router.replace`, not a full reload). Soft merge cap is **3000**. Load-more is only UI page size (**48**), not the catalog ceiling. A prior bug reloaded Explore from localStorage after every failed persist, which froze the UI around ~180–190 repos even while relays kept sending events. Per-event Explore `console.log` is off unless `localStorage.gittr_explore_debug=1` (including EOSE “Found N NIP-34 events for …” lines — those froze the tab).

**My Repositories** (`/repositories`) had the same quota trap: raw `localStorage.setItem("gittr_repos")` threw `QuotaExceededError`, and the catch path set the list to `[]` — so your own repos vanished while the console still logged hundreds of NIP-34 events. It now persists via `saveStoredRepos` (preferring your `ownerPubkey` when capping), keeps a session catalog, and never blanks the UI on save failure. Flush controls are labeled by scope: **Flush my own repos cache** (`clearOwnReposFromStorage`) vs **Flush others' repos cache** (`clearForeignReposFromStorage`); mobile uses short labels (“Flush my repos” / “Flush others”). Both hard-assign `/repositories` so a reload does not restore a prior repo tab from bfcache/history. Flush counts are **unique repos** (duplicate catalog rows are collapsed, not counted as extra repos). **Flush my own** clears the browser catalog *and* lifts local hide-tombstones for your pubkey so Nostr / profile-repos can refill; intentional Settings → Delete still uses tombstones (only a newer 30617 clears those). This page only syncs **your** Nostr announces — it does not refill other people’s repos after a flush (Explore still can).

**Reverse forge lookup:** the SEO seed only stores `npub/repo` paths — **no** upstream URLs. To find whether a GitHub/GitLab/Codeberg/Gitea/… repo already has a Nostr announce (and get the **npub** to DM), use exact match on kind **30617** `source` / `forkedFrom`: MCP `findReposBySource` or `GET /api/nostr/repos-by-github?source=https://…`.

**Client chrome on Explore:** leaving `/explore` uses urgent soft `appNavigate` (`router.push`, not `startTransition`) — live catalog `setState` flushes starve concurrent transitions, so the header looked dead. Hard `location.assign` remounted the whole app and felt like a ~10s tab freeze; it is last-resort after an 8s stall (home from Explore/Code after ~1.2s if that URL never changed). Leaving Explore **cancels** the 120ms catalog UI flush. Repo tab metadata uses an RSC fast path (no Nostr in `generateMetadata` on Flight requests). Header search on Explore uses `router.replace` so `?q=` does not wipe the catalog.

```bash
./scripts/install-gittr-seo-repo-index-timer.sh YOUR_SERVER_IP
```

- Timer: `gittr-seo-repo-index-refresh.timer` (**daily**, `Persistent=false` so enabling the timer mid-day does **not** immediately catch up a missed run)
- **Builder (own process):** `npx tsx /opt/ngit/scripts/refresh-seo-repo-index.mts` with `WorkingDirectory=/opt/ngit/ui` (sources `.env.local` for relays). Does **not** curl live Next.
- Snapshot path: `/opt/ngit/ui/data/nostr-seo-repos-snapshot.json`
- **Lab-agent mirror (server-only):** after each successful refresh, systemd `ExecStartPost` copies the same JSON to `/opt/ngit/data/lab-snapshot/nostr-seo-repos-snapshot.json` (next to `/lab`’s `index.html`). Not a gittr UI feature — operators/lab agents can read one folder.
- Status (read-only): `curl -sS http://127.0.0.1:3000/api/seo/refresh-nostr-repo-index`
- Emergency in-process rebuild (avoid on a sick box): `…?refresh=1` still exists on that API
- Manual oneshot: `systemctl start gittr-seo-repo-index-refresh.service`
- Logs: `journalctl -u gittr-seo-repo-index-refresh.service --since today`

**Ops note:** the builder has its own `MemoryMax=1500M`. Live Next keeps serving while discovery runs. Pair with `gittr-frontend` `MemoryMax` so UI leaks still restart cleanly.

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

- **Index what matters:** Home, `/nostr-git` (what Nostr git is — links the gittr README for the full platform map), explore, help, `/apps` and per-app pages, public repo pages, Pages directory — via sitemap + internal links (footer includes Nostr git / Repos / Apps). The `/pages` hub paints **48** cards first (`GET /api/gittr-pages/status-sites?limit=48`) then hydrates the rest; load-more is UI page size 48 (same as Explore).
- **Don’t index auth flows:** `robots.ts` blocks `/login`, `/signup`, `/settings/`, `/api/`, `/import`, `/apps/mine`, `/repositories`. `/new` (create/import hub) is **allowed** so X/Telegram can load its OG card.
- **Keywords / on-page copy:** Prefer “nostr git”, “git on nostr”, “Nostr git hosting”, “NIP-34”, “GRASP”, “Lightning bounties”, “mirror git repository”. Titles, H1s, and `/nostr-git` matter more than the keywords meta tag. Still avoid “github alternative” as the product identity.
- **GitHub repo README:** Lead with “Nostr git hosting” in the first paragraph so snippets for the gittr and gittr-mcp repositories match the live site.
- **gittr-blossom:** blob storage for gittr Pages and Nostr git, live at `blossom.gittr.space`. Repo on gittr: [gittr-blossom](https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr-blossom?branch=master) (branch `master`). GitHub About is that same sentence.
- **Import is a feature, not the headline:** README and meta mention importing from GitHub/GitLab/Codeberg under **mirror / backup**, not as the product identity.
- **Reputation ≠ SEO:** Google Safe Browsing clean + good sitemap does not fix Sophos category or LinkedIn link wrappers; see IT reclassification for those.

## Social previews (X, Telegram, LinkedIn)

- Homepage vs hubs: `/`, `/apps`, `/pages`, `/explore`, `/help`, `/nostr-git`, `/bounty-hunt`, and `/new` each have their own **title**, **description**, and **OG image**. Do not reuse homepage copy for hub links. `/new` is **Create or import** — Nostr git create plus batch import/mirror from foreign forges (GitHub/GitLab/Codeberg).
- Repo cards (`create-repo-og-image.tsx`): keep the **bottom-left corner empty** — X overlays the link name chip there. Brand (`gittr · nostr`) + `NIP-34` sit **bottom-right**.
- **Canonical share URL** is always `/{entity}/{repo}` (no `?branch=` / `?file=` / tab path). Nested pages inherit the same `og:image`; Share/QR copies the root so social caches do not fork per deep link. File “Copy permalink” stays deep for collaborators.
- `og:image` / `twitter:image` are emitted as **absolute `https://`** URLs (`normalizeSocialImageUrl` + `getPublicSiteUrl`). Scheme-less pastes like `gittr.space` still resolve to HTTPS HTML; if `NEXT_PUBLIC_SITE_URL` were `http://…`, non-localhost hosts are upgraded to `https://` so messengers do not drop the card image.
- Use full `https://` in `NEXT_PUBLIC_SITE_URL` in production.
- After meta changes, caches (X, Telegram, Cloudflare) may lag — purge CDN or use platform debug tools. Repo OG URLs include `?v=…` (and Next’s content-hash on `opengraph-image.tsx` / `twitter-image.tsx`). **Bump `GITTR_OG_CARD_REV` in those files** when About/composition changes, or X keeps the previous `twitter-image?<hash>` and an old blank card. Paste the **page** URL again after deploy (X’s official Card Validator is retired). Social crawlers are not 307’d off vanity HTML so `og:description` is the About text, not the generic “Repository X on gittr” fallback. About on the PNG is split into words so Satori wraps it instead of drawing one line under the logo.
- **X previews need a fast `og:image`:** Twitterbot often drops the card if the image takes longer than ~3–5s. Repo cards use a ~2.2s fetch budget + `revalidate = 3600` so the PNG is usually ready in time. HTML meta alone is not enough — X still fetches the image URL.

## Related

- Deploy env and sitemap flags: `docs/SETUP_INSTRUCTIONS.md` (Sitemap / SEO section)
- Publisher blocklist (excludes pubkeys from sitemap): `NEXT_PUBLIC_PUBLISHER_BLOCKLIST`
