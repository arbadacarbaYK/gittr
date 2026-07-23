# SEO & discoverability (gittr)

How search engines and social previews find gittr content. Marketing copy was updated to describe **use cases** (mirror, collaborate, Pages, apps, bounties) instead of positioning as a “GitHub alternative,” while keeping technical terms like NIP-34 and GRASP for people who search for them.

## What controls SEO in the codebase

| Surface | Location | Notes |
| --- | --- | --- |
| Default title, description, keywords, Open Graph | `ui/src/lib/seo/site-metadata.ts` | Root card via `buildRootSiteMetadata()`; per-route cards via `buildPageSiteMetadata({ path, title, description })` so X/Telegram do not reuse the homepage `og:url` |
| Hub routes (`/pages`, `/apps`, `/explore`, `/legal`) | respective `page.tsx` / `layout.tsx` | Must set full `openGraph` + `twitter` + `canonical` (title alone is not enough for social crawlers) |
| Route OG images | `ui/src/app/pages/opengraph-image.tsx`, `apps/opengraph-image.tsx`, root `opengraph-image.tsx` | Distinct taglines; shared renderer in `ui/src/lib/seo/create-og-image.tsx` |
| Per-repo title / description / OG image | `ui/src/app/[entity]/[repo]/layout.tsx` | Uses repo description when present; otherwise `buildRepoFallbackDescription()` |
| `robots.txt` | `ui/src/app/robots.ts` | Allows `/`; disallows `/api/`, `/login`, `/settings/`, etc. |
| `sitemap.xml` | `ui/src/app/sitemap.ts` | **Dynamic** — built at request time on the server (not a static file in git) |
| PWA manifest | `ui/public/site.webmanifest` | Short description for install prompts |
| Canonical / `metadataBase` | `NEXT_PUBLIC_SITE_URL` | Must be `https://your.domain` in production |

After changing `site-metadata.ts` or env, rebuild and restart the Next app (`yarn build` + `gittr-frontend`).

## Sitemap: local vs production

The sitemap **exists in code everywhere** (`ui/src/app/sitemap.ts`). It is **not** a file you commit (except optional extras below).

When something requests `/sitemap.xml`, Next.js runs `sitemap()` which:

1. Adds static URLs: `/`, `/explore`, `/help`, `/pages`
2. **Queries Nostr relays** (`NEXT_PUBLIC_NOSTR_RELAYS`) for repository announcements (kinds **51** and **30617**), applies deletions, publisher blocklist, **skips private repos** (`public-read: false` on kind 30617), and **skips announces whose only `clone` tags are localhost/private** (same cheap filter as homepage recent + explore; no bridge/file probe) → `npub…/repo` URLs
3. Fetches **gittr Pages** manifest from `NEXT_PUBLIC_GITTR_PAGES_URL` (default `https://pages.gittr.space`) → published site URLs
4. Optionally merges lines from **`nostr-pushed-repos.txt`** (gitignored)

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
- **Don’t index auth flows:** `robots.ts` blocks `/login`, `/signup`, `/settings/`, `/api/`.
- **Keywords:** Prefer “nostr git”, “NIP-34”, “GRASP”, “Lightning bounties”, “mirror git repository” — still accurate, less likely to trip naive “fake GitHub” heuristics than “github alternative”.
- **Import is a feature, not the headline:** README and meta mention importing from GitHub/GitLab/Codeberg under **mirror / backup**, not as the product identity.
- **Reputation ≠ SEO:** Google Safe Browsing clean + good sitemap does not fix Sophos category or LinkedIn link wrappers; see IT reclassification for those.

## Social previews (X, Telegram, LinkedIn)

- Repo and profile pages set Open Graph / Twitter cards in layout metadata.
- Use full `https://` in `NEXT_PUBLIC_SITE_URL`.
- After meta changes, caches (X, Telegram, Cloudflare) may lag — purge CDN or use platform debug tools if previews stay stale.

## Related

- Deploy env and sitemap flags: `docs/SETUP_INSTRUCTIONS.md` (Sitemap / SEO section)
- Publisher blocklist (excludes pubkeys from sitemap): `NEXT_PUBLIC_PUBLISHER_BLOCKLIST`
