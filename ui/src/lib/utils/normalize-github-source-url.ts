/**
 * Repair common mistakes when storing or passing GitHub upstream URLs:
 * - Bare "owner/repo" or "owner/repo.git" (no scheme/host)
 * - Malformed "https://OWNER/repo" where OWNER was parsed as hostname (no dot in host)
 *
 * Does not rewrite valid https://github.com/... URLs or non-GitHub hosts with real domains.
 */
export function normalizeGithubSourceUrl(
  input: string | undefined | null
): string {
  if (input == null) return "";
  let s = String(input).trim();
  if (!s) return s;

  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const host = u.hostname || "";
      // e.g. https://PMK/week_calendar — host is mistaken for org name
      if (host && !host.includes(".") && u.pathname) {
        const parts = u.pathname.split("/").filter(Boolean);
        const repoSeg = (parts[0] || "").replace(/\.git$/i, "");
        if (/^[a-z0-9._-]+$/i.test(host) && repoSeg) {
          return `https://github.com/${host}/${repoSeg}`;
        }
      }
    } catch {
      /* keep s */
    }
    return s;
  }

  const bare = /^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)(?:\.git)?$/i.exec(s);
  if (bare && bare[1] && bare[2]) {
    return `https://github.com/${bare[1]}/${bare[2]}`;
  }

  return s;
}

/**
 * Prefer a real http(s) clone URL; never use labels like "github.com" as URLs.
 * Only derive from displayName when it looks like bare `owner/repo`.
 */
export function pickHttpSourceUrl(
  source: { url?: string; displayName?: string } | null | undefined
): string | undefined {
  if (!source) return undefined;
  const u = typeof source.url === "string" ? source.url.trim() : "";
  if (u && /^https?:\/\//i.test(u)) return normalizeGithubSourceUrl(u);
  const d =
    typeof source.displayName === "string" ? source.displayName.trim() : "";
  if (d && /^[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(d)) {
    return normalizeGithubSourceUrl(d);
  }
  return undefined;
}
