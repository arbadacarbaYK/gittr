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
