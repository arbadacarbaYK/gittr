# SEO & discoverability (gittr)

How search engines and social previews find gittr content. Marketing copy was updated to describe **use cases** (mirror, collaborate, Pages, apps, bounties) instead of positioning as a “GitHub alternative,” while keeping technical terms like NIP-34 and GRASP for people who search for them.

## What controls SEO in the codebase

| Surface | Location | Notes |
| --- | --- | --- |
| Default title, description, keywords, Open Graph | `ui/src/lib/seo/site-metadata.ts` | Root card via `buildRootSiteMetadata()`; per-route cards via `buildPageSiteMetadata({ path, title, description })` so X/Telegram do not reuse the homepage `og:url` |
| Hub routes (`/pages`, `/apps`, `/explore`, `/new`, `/legal`) | respective `page.tsx` / `layout.tsx` | Must set full `openGraph` + `twitter` + `canonical` (title alone is not enough for social crawlers) |
| Route OG images | `ui/src/app/opengraph-image.tsx`, `apps/`, `pages/`, `explore/`, `[entity]/[repo]/` (+ matching `twitter-image.tsx`) | Hub taglines via `create-og-image.tsx`; repo cards via `create-repo-og-image.tsx` |
| Per-repo title / description / OG image | `ui/src/app/[entity]/[repo]/layout.tsx` + `opengraph-image.tsx` | Composed **1200×630** dark card: name, owner, About, corner badge; stats as **GitHub icon + ★ count**, fork icon + count, **N + ★** for Nostr (no “source stars” prose). Brand bottom-right (X uses bottom-left). |
| `robots.txt` | `ui/src/app/robots.ts` | Allows `/` and explicitly `/new` (create/import social cards); disallows `/api/`, `/login`, `/signup`, `/settings/`, `/import`. **`meta-externalagent` / `Meta-ExternalFetcher` (Meta AI training/index) are Disallow: /**. Do **not** Disallow `facebookexternalhit` (share cards). Do **not** turn on Cloudflare “Block AI Scrapers” — that also hits Claude/GPT. Volume cap is nginx `meta_ai` zone, not a UA 403. `force-dynamic` so validators don’t keep a stale Disallow forever. |
| `sitemap.xml` | `ui/src/app/sitemap.ts` | **Dynamic** — built at request time on the server (not a static file in git) |
| PWA manifest | `ui/public/site.webmanifest` | Short description for install prompts |
| Canonical / `metadataBase` | `NEXT_PUBLIC_SITE_URL` | Must be `https://your.domain` in production |

After changing `site-metadata.ts` or env, rebuild and restart the Next app (`yarn build` + `gittr-frontend`).

## Sitemap: local vs production

The sitemap **exists in code everywhere** (`ui/src/app/sitemap.ts`). It is **not** a file you commit (except optional extras below).

When something requests `/sitemap.xml`, Next.js runs `sitemap()` which:

1. Adds static URLs: `/`, `/explore`, `/help`, `/pages`
2. Loads the **daily SEO snapshot** (`ui/data/nostr-seo-repos-snapshot.json`) when present — explore-class discovery written by a **standalone** systemd job (not inside live Next)
3. **Live relay fan-out only if that snapshot is missing/stale** (or `SITEMAP_LIVE_NOSTR=1` for debugging) — crawlers normally hit disk only
4. Fetches **gittr Pages** manifest from `NEXT_PUBLIC_GITTR_PAGES_URL` (default `https://pages.gittr.space`) → published site URLs
5. Optionally merges lines from **`nostr-pushed-repos.txt`** (gitignored; gittr-HTTP-push / manual supplement only)

### Daily SEO repo index (recommended on production)

Explore discovers public Nostr repos (not only repos people Push’d from gittr). A **daily standalone job** (`scripts/refresh-seo-repo-index.mts`) writes a durable disk snapshot; `/sitemap.xml` and `/api/explore/seed` prefer that file so crawlers and cold Explore loads do not fan out to relays inside the live Next process.

The same snapshot **seeds `/explore`** when the browser cache is thin (`GET /api/explore/seed?limit=3000` reads `ui/data/nostr-seo-repos-snapshot.json` — no live relay round-trip). Client Nostr sync still runs afterward to enrich. Seed/sync writes go through `saveStoredRepos` (slim metadata only — no file trees). If localStorage is full, Explore keeps a **session catalog in memory** (and still shows those repos) while reclaiming space (evict `gittr_files__*` / other caches, progressive caps, ultra-slim rows). Soft merge cap is **3000**. Load-more is only UI page size (**48**), not the catalog ceiling. A prior bug reloaded Explore from localStorage after every failed persist, which froze the UI around ~180–190 repos even while relays kept sending events.

**My Repositories** (`/repositories`) had the same quota trap: raw `localStorage.setItem("gittr_repos")` threw `QuotaExceededError`, and the catch path set the list to `[]` — so your own repos vanished while the console still logged hundreds of NIP-34 events. It now persists via `saveStoredRepos` (preferring your `ownerPubkey` when capping), keeps a session catalog, and never blanks the UI on save failure. Flush controls are labeled by scope: **Flush my own repos cache** (`clearOwnReposFromStorage`) vs **Flush others' repos cache** (`clearForeignReposFromStorage`); mobile uses short labels (“Flush my repos” / “Flush others”). Both hard-assign `/repositories` so a reload does not restore a prior repo tab from bfcache/history. Flush counts are **unique repos** (duplicate catalog rows are collapsed, not counted as extra repos). **Flush my own** clears the browser catalog *and* lifts local hide-tombstones for your pubkey so Nostr / profile-repos can refill; intentional Settings → Delete still uses tombstones (only a newer 30617 clears those). This page only syncs **your** Nostr announces — it does not refill other people’s repos after a flush (Explore still can).

**Reverse forge lookup:** the SEO seed only stores `npub/repo` paths — **no** upstream URLs. To find whether a GitHub/GitLab/Codeberg/Gitea/… repo already has a Nostr announce (and get the **npub** to DM), use exact match on kind **30617** `source` / `forkedFrom`: MCP `findReposBySource` or `GET /api/nostr/repos-by-github?source=https://…`.

**Client chrome on Explore:** leaving `/explore` uses soft `appNavigate` (`startTransition` + `router.push`) by default — hard `location.assign` remounted the whole app and felt like a ~10s tab freeze. Soft nav hard-assigns only after an 8s stall. Leaving a **Code** tab pushes urgently (hydrate `setState` starves the transition); the logo/home hard-loads `/` after ~1.2s only if that Code URL never changed. Repo tab metadata uses an RSC fast path (no Nostr in `generateMetadata` on Flight requests). Search may still hard-assign into Explore when needed for a clean entry.

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
