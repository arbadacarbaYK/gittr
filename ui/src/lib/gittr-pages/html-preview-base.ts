/**
 * Code-tab HTML preview is a one-file srcDoc iframe. Relative CSS/JS/images
 * resolve against about:srcdoc unless we inject a <base> pointing at a raw
 * forge tree (GitHub / GitLab / Codeberg). Live Nostr Pages still serve the
 * real tree from pages.gittr.space after Push Manifest.
 */

export function injectHtmlPreviewBaseHref(
  html: string,
  baseHref: string | null | undefined
): string {
  const base = typeof baseHref === "string" ? baseHref.trim() : "";
  if (!html || !base) return html;
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    return html;
  }
  if (parsed.protocol !== "https:") return html;
  if (/<base\b/i.test(html)) return html;
  const href = parsed.toString().replace(/"/g, "");
  const tag = `<base href="${href}">`;
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (open) => `${open}${tag}`);
  }
  return `${tag}${html}`;
}

function encodePathSegments(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((p) => encodeURIComponent(p))
    .join("/");
}

function dirnamePosix(filePath: string): string {
  const norm = filePath.replace(/\\/g, "/").replace(/^\//, "");
  const i = norm.lastIndexOf("/");
  if (i <= 0) return "";
  return norm.slice(0, i);
}

/**
 * Directory URL (trailing slash) so `./docs-site/hub.css` next to `index.html`
 * loads from the forge raw tree.
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
