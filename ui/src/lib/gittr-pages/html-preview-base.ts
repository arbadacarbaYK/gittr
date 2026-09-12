/**
 * Code-tab HTML preview is a one-file srcDoc iframe. A `<base href>` to GitHub
 * raw is blocked by CSP `base-uri 'self'`, and GitHub raw serves CSS as
 * text/plain so the browser will not apply it. Rewrite relative href/src to
 * same-origin `/api/gittr-pages/preview-asset` (correct MIME). Live Nostr
 * Pages still serve the real tree after Push Manifest.
 */

export type HtmlPreviewRewriteArgs = {
  sourceUrl?: string | null;
  branch?: string | null;
  filePath?: string | null;
  /** Page origin so srcDoc iframes resolve stylesheets on gittr, not about:srcdoc. */
  origin?: string | null;
};

export function dirnamePosix(filePath: string): string {
  const norm = filePath.replace(/\\/g, "/").replace(/^\//, "");
  const i = norm.lastIndexOf("/");
  if (i <= 0) return "";
  return norm.slice(0, i);
}

/** Resolve `./docs-site/hub.css` next to `index.html` → `docs-site/hub.css`. */
export function resolveRepoRelativeAssetPath(
  fromFilePath: string,
  relativeHref: string
): string | null {
  const rel = (relativeHref || "").trim();
  if (!rel) return null;
  const lower = rel.toLowerCase();
  if (
    lower.startsWith("https:") ||
    lower.startsWith("http:") ||
    lower.startsWith("data:") ||
    lower.startsWith("blob:") ||
    lower.startsWith("mailto:") ||
    lower.startsWith("javascript:") ||
    lower.startsWith("#") ||
    lower.startsWith("//")
  ) {
    return null;
  }
  const dir = dirnamePosix(fromFilePath || "");
  const combined = dir ? `${dir}/${rel}` : rel;
  const parts: string[] = [];
  for (const p of combined.replace(/\\/g, "/").split("/")) {
    if (!p || p === ".") continue;
    if (p === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    if (p.includes("\\") || p.includes("\0")) return null;
    parts.push(p);
  }
  const out = parts.join("/");
  return out || null;
}

export function previewAssetApiHref(args: {
  sourceUrl: string;
  branch: string;
  repoPath: string;
  origin?: string | null;
}): string {
  const params = new URLSearchParams({
    sourceUrl: args.sourceUrl,
    branch: args.branch,
    path: args.repoPath,
  });
  const path = `/api/gittr-pages/preview-asset?${params.toString()}`;
  const origin = (args.origin || "").replace(/\/$/, "");
  return origin ? `${origin}${path}` : path;
}

export function rewriteRelativeHtmlAssets(
  html: string,
  args: HtmlPreviewRewriteArgs | null | undefined
): string {
  const sourceUrl =
    typeof args?.sourceUrl === "string" ? args.sourceUrl.trim() : "";
  if (!html || !sourceUrl) return html;
  const branch = (args?.branch || "main").trim() || "main";
  const filePath = (args?.filePath || "index.html").trim() || "index.html";
  const origin = typeof args?.origin === "string" ? args.origin.trim() : "";

  return html.replace(
    /\b(href|src)=["']([^"']+)["']/gi,
    (full, attr: string, raw: string) => {
      const repoPath = resolveRepoRelativeAssetPath(filePath, raw);
      if (!repoPath) return full;
      const href = previewAssetApiHref({
        sourceUrl,
        branch,
        repoPath,
        origin,
      }).replace(/"/g, "");
      return `${attr}="${href}"`;
    }
  );
}

/** @deprecated Use {@link rewriteRelativeHtmlAssets} with sourceUrl/branch/filePath. */
export function injectHtmlPreviewBaseHref(
  html: string,
  _baseHref?: string | null
): string {
  return html;
}

function encodePathSegments(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((p) => encodeURIComponent(p))
    .join("/");
}

/**
 * Directory URL (trailing slash) so a filename in that folder can be appended
 * for a server-side GitHub/GitLab/Codeberg raw fetch.
 */
export function forgeRawDirectoryHref(args: {
  sourceUrl?: string | null;
  branch?: string | null;
  filePath?: string | null;
}): string | null {
  const raw = (args.sourceUrl || "").trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  const branch = (args.branch || "main").trim() || "main";
  const dir = encodePathSegments(dirnamePosix(args.filePath || ""));
  const branchEnc = encodeURIComponent(branch);

  if (host === "github.com") {
    const tail = dir ? `${dir}/` : "";
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branchEnc}/${tail}`;
  }
  if (host === "gitlab.com") {
    const tail = dir ? `${dir}/` : "";
    return `https://gitlab.com/${owner}/${repo}/-/raw/${branchEnc}/${tail}`;
  }
  if (host === "codeberg.org") {
    const tail = dir ? `${dir}/` : "";
    return `https://codeberg.org/${owner}/${repo}/raw/branch/${branchEnc}/${tail}`;
  }
  return null;
}

export function forgeRawFileHref(args: {
  sourceUrl?: string | null;
  branch?: string | null;
  filePath?: string | null;
}): string | null {
  const filePath = (args.filePath || "").replace(/\\/g, "/").replace(/^\//, "");
  if (!filePath) return null;
  const dirHref = forgeRawDirectoryHref(args);
  if (!dirHref) return null;
  const baseName = filePath.split("/").filter(Boolean).pop();
  if (!baseName) return null;
  return `${dirHref}${encodeURIComponent(baseName)}`;
}
