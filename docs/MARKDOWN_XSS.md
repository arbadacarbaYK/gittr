# Markdown XSS controls

User and Nostr-sourced markdown (READMEs, repo files, About text, issue/PR bodies,
discussion body + comments) is rendered with `react-markdown` + `rehype-raw`
**and** `rehype-sanitize` via the shared helper:

`ui/src/lib/security/markdown-rehype-plugins.ts`

Never use `rehypeRaw` alone on those paths. Custom `components` (`code` / `img` / `a`)
are not a substitute for sanitization.

Mermaid fenced blocks go through `MermaidRenderer` with
`securityLevel: "antiscript"` (not `"loose"`).

CSP in `ui/next.config.js` still allows `'unsafe-inline'` / `'unsafe-eval'` for
Next/runtime needs. Sanitize is the primary XSS control for markdown; tightening
CSP is a separate follow-up (Report-Only Bundle B is optional / parked).

Unit coverage: `ui/src/lib/security/markdown-rehype-plugins.test.ts`.

## Separate sink: HTML / PDF file preview iframes

Repo file preview for `.html` (and PDF fallback) in
`ui/src/components/repo/RepoCodePage.tsx` is **not** covered by
`rehype-sanitize`. Content is shown in iframes:

- **HTML preview**: `sandbox` allows `allow-scripts` (and popups/forms/modals as
  needed) but **not** `allow-same-origin`. That keeps an opaque origin so preview
  scripts cannot reach parent `localStorage` / cookies / same-origin APIs.
- **PDF fallback iframe**: restrictive empty `sandbox=""` (no scripts). Native
  browser PDF viewers do not need `allow-scripts`; prefer this over leaving the
  iframe unsandboxed.

## URL attributes from Nostr events (Apps / Pages / Repo Links)

React escapes text, but `href={…}` / `src={…}` fed from **attacker-published
events** are still an XSS sink (`javascript:` executes on click). Guarded at
two choke points:

- **NIP-82 software catalog** (kinds 32267 / 3063): `icon`, `repository`,
  `url` (website), and asset download `url` pass `safeHttpUrlTag` in
  `ui/src/lib/nostr/nip82-software.ts` — http(s) only, no userinfo. Covers
  `/apps`, profile Pages & Apps sections, and the software-catalog API.
- **Repo sidebar Links** (30617 `links` / stored repos): `RepoLinks`
  (`ui/src/components/ui/repo-links.tsx`) drops any link whose URL is not
  http(s) before rendering.

The kind-0 profile `website` link is safe by construction (non-`http`-prefixed
values get `https://` prepended, so no `javascript:` can survive). Mermaid
diagrams render with `securityLevel: "antiscript"`; the theme script in
`layout.tsx` is static (no user input).

## README relative images (Nostr / GRASP)

Relative image paths in READMEs (e.g. `![…](docs/assets/foo.png)` or `<img src="docs/wok.svg">`) must **display**
on Nostr-native / GRASP repos via same-origin file APIs — see
`ui/src/lib/repos/resolve-readme-markdown-image.ts` and
`ReadmeMarkdownImage`. Forge `sourceUrl` hotlinks are best-effort; SVG and failed
raw URLs fall back to the gittr bridge (ownerPubkey+repo), not a guessed forge
`/raw/` path. Do not invent forge `/raw/` URLs for `git.gittr.space`.
Blossom is only for hosted media outside the git tree, not for in-repo README assets.
