import { GRASP_SERVERS_FOR_PUSHING } from "./grasp-servers";

const UPSTREAM_HOSTS = ["github.com", "gitlab.com", "codeberg.org"] as const;

/** Hostname for https URLs, or host part of git@host:path */
export function gitUrlHostname(url: string): string {
  const u = String(url || "").trim();
  if (!u || u.startsWith("nostr://")) return "";
  if (/^git@/i.test(u)) {
    return (u.slice(4).split(":")[0] ?? "").toLowerCase();
  }
  try {
    const withProto =
      u.startsWith("http://") || u.startsWith("https://") ? u : `https://${u}`;
    return new URL(withProto).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function normalizeCloneUrlKey(url: string): string {
  return String(url || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
}

/** One row per host/path. Prefer the `.git` form when both exist. */
export function dedupeNormalizedCloneUrls(urls: string[]): string[] {
  const byKey = new Map<string, string>();
  for (const raw of urls) {
    const u = String(raw || "").trim();
    if (!u) continue;
    const key = normalizeCloneUrlKey(u);
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, u);
      continue;
    }
    const nextHasGit = /\.git$/i.test(u);
    const prevHasGit = /\.git$/i.test(prev);
    if (nextHasGit && !prevHasGit) byKey.set(key, u);
  }
  return [...byKey.values()];
}

/**
 * gittr Push order: this deployment’s git host, then the other advertised
 * GRASP mirrors, then everything else, forge `source` last.
 */
export function orderCloneUrlsForSidebar(
  urls: string[],
  options: { primaryGitServerEnv?: string; sourceUrl?: string }
): string[] {
  const primary = primaryGitHostFromEnv(options.primaryGitServerEnv);
  const ranked = GRASP_SERVERS_FOR_PUSHING.map((h) => h.toLowerCase());
  const score = (u: string): number => {
    if (u.startsWith("nostr://")) return 400;
    if (u.startsWith("git@")) return 300;
    const h = gitUrlHostname(u);
    if (primary && h === primary) return 0;
    const gi = ranked.indexOf(h);
    if (gi >= 0) return 1 + gi;
    if (sourceMatchesUpstreamClone(u, options.sourceUrl)) return 200;
    return 100;
  };
  return [...urls].sort((a, b) => {
    const d = score(a) - score(b);
    if (d !== 0) return d;
    return a.localeCompare(b);
  });
}

/** Keep every clone we have already seen; a thinner later snapshot must not wipe mirrors. */
export function mergeCloneUrlLists(
  prev: readonly string[] | undefined | null,
  next: readonly string[] | undefined | null
): string[] {
  return dedupeNormalizedCloneUrls([...(next || []), ...(prev || [])]);
}

export function primaryGitHostFromEnv(
  envUrl: string | undefined
): string | null {
  if (!envUrl || typeof envUrl !== "string") return null;
  const t = envUrl.trim().replace(/^["']|["']$/g, "");
  if (!t) return null;
  const h = gitUrlHostname(t);
  return h || null;
}

function isKnownUpstreamHost(host: string): boolean {
  return UPSTREAM_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Bare IPv4 / IPv6 hosts — fine for fetch, noisy for sidebar clone lists. */
export function isIpLiteralHostname(host: string): boolean {
  const h = String(host || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!h) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  // IPv6 (with or without zone id)
  if (h.includes(":")) return true;
  return false;
}

function sourceMatchesUpstreamClone(
  cloneUrl: string,
  sourceUrl: string | undefined
): boolean {
  if (!sourceUrl) return false;
  const uh = gitUrlHostname(cloneUrl);
  const sh = gitUrlHostname(sourceUrl);
  if (!uh || !sh) return false;
  if (!isKnownUpstreamHost(uh) || !isKnownUpstreamHost(sh)) return false;
  return uh === sh;
}

/**
 * Sidebar clone list: keep every URL the announcement already listed.
 * Only strip empty rows, localhost, and bare-IP mirrors. has-files is a
 * badge — this must not drop git.gittr.space or other event hosts.
 */
export function filterDisplayCloneUrlsForSidebar(
  urls: string[],
  _options?: {
    primaryGitServerEnv?: string;
    sourceUrl?: string;
  }
): string[] {
  const withoutEmpty = urls
    .map((u) => String(u || "").trim())
    .filter((u) => u && !u.includes("localhost") && !u.includes("127.0.0.1"));

  const hasNamedHost = withoutEmpty.some((u) => {
    if (u.startsWith("nostr://")) return true;
    const h = gitUrlHostname(u);
    return !!h && !isIpLiteralHostname(h);
  });
  if (!hasNamedHost) return withoutEmpty;

  return withoutEmpty.filter((u) => {
    if (u.startsWith("nostr://")) return true;
    return !isIpLiteralHostname(gitUrlHostname(u));
  });
}

/**
 * Sidebar clone badge = this Code visit already loaded a file tree from that
 * host, so `git clone` is likely to work. Skipped extra GRASP stay announced
 * (no badge): they are often listed so other relays accept the note.
 */
export type CloneUrlLiveHint =
  | "has-files"
  | "no-files"
  | "checking"
  | "announced";

export type CloneUrlFetchStatusRow = {
  source: string;
  status: "pending" | "fetching" | "success" | "failed";
  error?: string;
};

function cloneUrlMatchKey(url: string): string {
  const host = gitUrlHostname(url);
  if (host) return host;
  return String(url || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
}

function fetchStatusMatchesClone(
  row: CloneUrlFetchStatusRow,
  cloneUrl: string
): boolean {
  const host = gitUrlHostname(cloneUrl);
  const src = String(row.source || "").toLowerCase();
  if (!src) return false;
  if (host && (src === host || src.includes(host))) return true;
  const key = cloneUrlMatchKey(cloneUrl);
  return Boolean(key && src.includes(key));
}

function matchingFetchRows(
  cloneUrl: string,
  rows: CloneUrlFetchStatusRow[] | undefined
): CloneUrlFetchStatusRow[] {
  return (rows || []).filter((row) => fetchStatusMatchesClone(row, cloneUrl));
}

function isSkippedRaceRow(row: CloneUrlFetchStatusRow): boolean {
  return /skipped/i.test(String(row.error || ""));
}

export function cloneUrlLiveHint(
  cloneUrl: string,
  opts: {
    fetchStatuses?: CloneUrlFetchStatusRow[];
    successfulSourceUrls?: string[];
  }
): CloneUrlLiveHint {
  const host = gitUrlHostname(cloneUrl);
  const matches = matchingFetchRows(cloneUrl, opts.fetchStatuses);
  const realFail = matches.some(
    (s) => s.status === "failed" && !isSkippedRaceRow(s)
  );
  if (realFail) return "no-files";
  if (matches.some((s) => s.status === "pending" || s.status === "fetching")) {
    return "checking";
  }

  for (const u of opts.successfulSourceUrls || []) {
    const other = gitUrlHostname(u);
    if (host && other && host === other) return "has-files";
    if (cloneUrlMatchKey(cloneUrl) === cloneUrlMatchKey(u)) return "has-files";
  }
  if (matches.some((s) => s.status === "success")) return "has-files";
  return "announced";
}

export function cloneUrlLiveHintShowsBadge(hint: CloneUrlLiveHint): boolean {
  return hint !== "announced";
}

export function cloneUrlLiveHintBadge(hint: CloneUrlLiveHint): string {
  switch (hint) {
    case "has-files":
      return "has files";
    case "no-files":
      return "no files";
    case "checking":
      return "…";
    default:
      return "";
  }
}

export function cloneUrlLiveHintTitle(hint: CloneUrlLiveHint): string {
  switch (hint) {
    case "has-files":
      return "This page already loaded a file tree from this host, so git clone should work.";
    case "no-files":
      return "This visit asked that host and got no file tree. git clone is unlikely to work.";
    case "checking":
      return "Asking this host for a file tree.";
    default:
      return "On the Nostr announcement only. git clone might not work — we did not load a tree from here this visit.";
  }
}
