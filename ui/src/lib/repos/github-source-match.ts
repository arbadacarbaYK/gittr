/**
 * Exact upstream forge URL key for reverse Nostr lookup (kind 30617 source tags).
 * Covers GitHub, GitLab, Codeberg, Gitea, … — not fuzzy slug/name matching.
 *
 * Canonical key: lowercase "host/owner/.../repo"
 */

const NOSTR_GIT_HOSTS = new Set([
  "relay.gittr.space",
  "git.gittr.space",
  "relay.ngit.dev",
  "ngit-relay.nostrver.se",
  "gitnostr.com",
  "ngit.danconwaydev.com",
  "git.shakespeare.diy",
  "git-01.uid.ovh",
  "git-02.uid.ovh",
  "git.jb55.com",
  "pages.gittr.space",
  "blossom.gittr.space",
]);

const UI_CUT_MARKERS = [
  "/-/",
  "/tree/",
  "/blob/",
  "/raw/",
  "/src/",
  "/commits/",
  "/commit/",
  "/issues",
  "/pulls",
  "/pull/",
  "/merge_requests",
  "/wiki",
  "/settings",
  "/actions",
  "/releases",
  "/tags",
  "/about",
];

export function isNostrGitHost(host: string): boolean {
  const h = String(host || "")
    .toLowerCase()
    .replace(/^www\./, "");
  if (!h) return false;
  if (NOSTR_GIT_HOSTS.has(h)) return true;
  if (h.endsWith(".pages.gittr.space")) return true;
  return false;
}

function stripUiSuffix(path: string): string {
  let p = `/${String(path || "").replace(/^\/+/, "")}`;
  const lower = p.toLowerCase();
  for (const marker of UI_CUT_MARKERS) {
    const idx = lower.indexOf(marker);
    if (idx > 0) {
      p = p.slice(0, idx);
      break;
    }
  }
  return p.replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * Normalize forge / git remote URL → "host/path/to/repo".
 * Bare "owner/repo" → github.com shorthand.
 */
export function normalizeForgeSourceKey(
  input: string | null | undefined
): string | null {
  if (input == null) return null;
  let s = String(input).trim();
  if (!s) return null;

  const scp = s.match(/^git@([^:]+):(.+)$/i);
  if (scp?.[1] && scp[2]) {
    const host = scp[1].toLowerCase().replace(/^www\./, "");
    if (isNostrGitHost(host)) return null;
    let path = scp[2]
      .replace(/\.git$/i, "")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
    path = stripUiSuffix(path);
    const parts = path.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return `${host}/${parts.map((p) => p.toLowerCase()).join("/")}`;
  }

  if (/^[^/\s]+\/[^/\s]+$/.test(s) && !s.includes(":") && !s.includes("@")) {
    const [owner, repo] = s.split("/");
    if (owner && repo) {
      return `github.com/${owner.toLowerCase()}/${repo
        .replace(/\.git$/i, "")
        .toLowerCase()}`;
    }
  }

  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    s = `https://${s}`;
  }

  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }

  if (
    url.protocol !== "http:" &&
    url.protocol !== "https:" &&
    url.protocol !== "ssh:"
  ) {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!host || isNostrGitHost(host)) return null;

  let path = url.pathname || "";
  path = path.replace(/\.git$/i, "");
  path = stripUiSuffix(path);
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  if (last && /\.(md|html?|png|jpe?g|svg|json|txt|pdf)$/i.test(last)) {
    return null;
  }

  return `${host}/${parts.map((p) => p.toLowerCase()).join("/")}`;
}

/** @deprecated Prefer normalizeForgeSourceKey; returns owner/repo for github only */
export function normalizeGithubOwnerRepo(
  input: string | null | undefined
): string | null {
  const key = normalizeForgeSourceKey(input);
  if (!key?.startsWith("github.com/")) return null;
  return key.slice("github.com/".length);
}

export function forgeKeysFrom30617Tags(tags: string[][]): Set<string> {
  const keys = new Set<string>();
  if (!Array.isArray(tags)) return keys;

  for (const name of ["source", "forkedFrom", "clone", "web", "link"] as const) {
    for (const tag of tags) {
      if (!Array.isArray(tag) || tag[0] !== name) continue;
      const values =
        name === "link"
          ? [tag[2]].filter(Boolean)
          : tag.slice(1).filter((v) => v != null && String(v).trim() !== "");
      for (const v of values) {
        const key = normalizeForgeSourceKey(String(v));
        if (key) keys.add(key);
      }
    }
  }
  return keys;
}

/** @deprecated alias */
export function githubKeysFrom30617Tags(tags: string[][]): Set<string> {
  return forgeKeysFrom30617Tags(tags);
}

export function matchedViaTags(
  tags: string[][],
  wantKey: string
): string[] {
  const via: string[] = [];
  if (!wantKey || !Array.isArray(tags)) return via;
  for (const name of ["source", "forkedFrom", "clone", "web", "link"]) {
    for (const tag of tags) {
      if (!Array.isArray(tag) || tag[0] !== name) continue;
      const values =
        name === "link"
          ? [tag[2]].filter(Boolean)
          : tag.slice(1).filter((v) => v != null && String(v).trim() !== "");
      for (const v of values) {
        if (normalizeForgeSourceKey(String(v)) === wantKey) {
          via.push(name);
          break;
        }
      }
    }
  }
  return [...new Set(via)];
}
