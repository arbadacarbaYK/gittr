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
CSP is a separate follow-up.

Unit coverage: `ui/src/lib/security/markdown-rehype-plugins.test.ts`.
