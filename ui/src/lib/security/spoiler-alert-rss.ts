/**
 * Vulnerability Spoiler Alert RSS — early (often pre-CVE) patch signals.
 * Public feed: https://vulnerabilityspoileralert.com/feed.xml
 *
 * Product rules:
 * - Notifications only (never Dependencies / OSV audit UI)
 * - Same opt-in as security_cve (no extra toggle)
 * - Fail-open if the feed is down
 */

export const DEFAULT_SPOILER_RSS_URL =
  "https://vulnerabilityspoileralert.com/feed.xml";

export type SpoilerSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

export type SpoilerAlertItem = {
  /** Stable id — prefer RSS guid, else link, else title hash. */
  id: string;
  title: string;
  link: string;
  summary: string;
  severity: SpoilerSeverity;
  verified: boolean;
  /** GitHub owner/repo parsed from title when present. */
  githubRepo: string | null;
  pubDate?: string;
};

export type SpoilerPackageLike = {
  name: string;
  direct?: boolean;
};

const SEVERITY_RE = /^\[(CRITICAL|HIGH|MEDIUM|LOW)\]\s+/i;
const IN_REPO_RE = /\bin\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\s*$/i;

export function parseSpoilerSeverity(raw: string): SpoilerSeverity {
  const u = String(raw || "")
    .trim()
    .toUpperCase();
  if (u === "CRITICAL" || u === "HIGH" || u === "MEDIUM" || u === "LOW") {
    return u;
  }
  return "UNKNOWN";
}

/** Extract GitHub owner/repo from a Spoiler Alert title. */
export function parseSpoilerGithubRepoFromTitle(title: string): string | null {
  const m = IN_REPO_RE.exec(String(title || "").trim());
  if (!m?.[1]) return null;
  return m[1].toLowerCase();
}

function stripCdata(s: string): string {
  return String(s || "")
    .replace(/^<!\[CDATA\[/i, "")
    .replace(/\]\]>$/i, "")
    .trim();
}

function decodeXmlEntities(s: string): string {
  return stripCdata(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function firstTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = re.exec(block);
  return m?.[1] != null ? decodeXmlEntities(m[1]) : "";
}

function allCategories(block: string): string[] {
  const out: string[] = [];
  const re = /<category\b[^>]*>([\s\S]*?)<\/category>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    if (m[1] == null) continue;
    out.push(decodeXmlEntities(m[1]).toLowerCase());
  }
  return out;
}

/**
 * Parse Spoiler Alert RSS 2.0 XML (tolerant string parser — no DOM required).
 */
export function parseSpoilerAlertRssXml(xml: string): SpoilerAlertItem[] {
  const items: SpoilerAlertItem[] = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(xml || "")))) {
    const block = m[1] || "";
    const title = firstTag(block, "title");
    if (!title) continue;
    const link = firstTag(block, "link");
    const guid = firstTag(block, "guid") || link || title;
    const description = firstTag(block, "description");
    const pubDate = firstTag(block, "pubDate") || undefined;
    const cats = allCategories(block);

    let severity = parseSpoilerSeverity(
      cats.find((c) =>
        ["critical", "high", "medium", "low"].includes(c)
      ) || ""
    );
    if (severity === "UNKNOWN") {
      const fromTitle = SEVERITY_RE.exec(title);
      if (fromTitle?.[1]) severity = parseSpoilerSeverity(fromTitle[1]);
    }

    const verified = cats.includes("verified");
    const githubRepo =
      parseSpoilerGithubRepoFromTitle(title) ||
      (() => {
        // Fallback: last path segments of github.com/owner/repo links in body
        const gm = /github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i.exec(
          `${link} ${description}`
        );
        return gm?.[1] ? gm[1].toLowerCase() : null;
      })();

    items.push({
      id: guid,
      title,
      link,
      summary: description.slice(0, 500),
      severity,
      verified,
      githubRepo,
      pubDate,
    });
  }
  return items;
}

/** Bot early-warning bar: HIGH/CRITICAL only (verified or unverified). */
export function eligibleSpoilerAlerts(
  items: SpoilerAlertItem[]
): SpoilerAlertItem[] {
  return items.filter(
    (i) => i.severity === "CRITICAL" || i.severity === "HIGH"
  );
}

/**
 * Does this lockfile/manifest package look related to a GitHub owner/repo
 * from a Spoiler Alert item?
 */
export function packageMatchesSpoilerGithubRepo(
  packageName: string,
  githubRepo: string
): boolean {
  const pkg = String(packageName || "")
    .trim()
    .toLowerCase();
  const slug = String(githubRepo || "")
    .trim()
    .toLowerCase();
  if (!pkg || !slug || !slug.includes("/")) return false;
  const [owner, repo] = slug.split("/");
  if (!owner || !repo) return false;

  // Go / module paths
  if (pkg.includes(`github.com/${slug}`)) return true;
  if (pkg === `github.com/${slug}`) return true;

  // Scoped npm: @grafana/foo ↔ grafana/grafana or grafana/*
  if (pkg.startsWith(`@${owner}/`)) return true;

  // Exact unscoped name equals repo short name
  if (pkg === repo) return true;

  // org/repo style package ids
  if (pkg === slug) return true;

  return false;
}

export type SpoilerMatch = {
  item: SpoilerAlertItem;
  packageName: string;
};

/**
 * Match Spoiler items against scanned packages (prefer direct deps, same as CVE bot).
 */
export function matchSpoilersToPackages(
  items: SpoilerAlertItem[],
  packages: SpoilerPackageLike[],
  opts?: { directOnly?: boolean }
): SpoilerMatch[] {
  const directOnly = opts?.directOnly !== false;
  const pkgs = packages.filter((p) =>
    directOnly ? p.direct === true : true
  );
  const out: SpoilerMatch[] = [];
  const seen = new Set<string>();

  for (const item of eligibleSpoilerAlerts(items)) {
    if (!item.githubRepo) continue;
    for (const p of pkgs) {
      if (!packageMatchesSpoilerGithubRepo(p.name, item.githubRepo)) continue;
      const key = `${item.id}|${p.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ item, packageName: p.name });
    }
  }
  return out;
}

export function spoilerDedupKey(
  ownerPubkey: string,
  repo: string,
  spoilerId: string,
  packageName: string
): string {
  return `${ownerPubkey.toLowerCase()}|${repo}|spoiler:${spoilerId}|${packageName}`;
}

export function formatSpoilerNotificationDm(opts: {
  repoName: string;
  matches: SpoilerMatch[];
}): { title: string; message: string } {
  const repo = (opts.repoName || "repo").includes("/")
    ? opts.repoName.split("/").pop() || opts.repoName
    : opts.repoName;
  const n = opts.matches.length;
  const title =
    n === 1
      ? `Early dependency notice: ${repo} — possible pre-CVE patch (${opts.matches[0]?.item.severity || "HIGH"})`
      : `Early dependency notice: ${repo} — ${n} possible pre-CVE patches`;

  const lines: string[] = [];
  lines.push(`Repo: ${repo}`);
  lines.push(
    "Early tip from the public Vulnerability Spoiler Alert feed (not an OSV/CVE confirmation). Not shown on the Dependencies tab — please verify before acting."
  );
  lines.push("");

  for (const m of opts.matches.slice(0, 5)) {
    const v = m.item.verified ? "verified" : "unverified";
    const gh = m.item.githubRepo || "upstream";
    lines.push(
      `• ${m.item.severity} (${v}) — dep \`${m.packageName}\` may relate to ${gh}`
    );
    lines.push(`  ${m.item.title}`);
    if (m.item.link) lines.push(`  ${m.item.link}`);
  }
  if (opts.matches.length > 5) {
    lines.push("");
    lines.push(`…and ${opts.matches.length - 5} more in the feed.`);
  }
  lines.push("");
  lines.push(
    "Treat as a tip to investigate / upgrade — not a confirmed CVE. Confirmed lockfile CVEs still use the Dependencies tab + separate alerts."
  );

  return { title, message: lines.join("\n") };
}

export type FetchSpoilerRssResult =
  | { ok: true; items: SpoilerAlertItem[]; url: string }
  | { ok: false; error: string; url: string };

/** Fetch + parse. Never throws — callers should fail-open. */
export async function fetchSpoilerAlertRss(
  url: string = DEFAULT_SPOILER_RSS_URL,
  fetchImpl: typeof fetch = fetch
): Promise<FetchSpoilerRssResult> {
  const target = (url || DEFAULT_SPOILER_RSS_URL).trim();
  try {
    const res = await fetchImpl(target, {
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml, */*",
        "User-Agent": "gittr-cve-bot/spoiler-rss",
      },
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `HTTP ${res.status}`,
        url: target,
      };
    }
    const text = await res.text();
    if (!text.trim()) {
      return { ok: false, error: "empty body", url: target };
    }
    const items = parseSpoilerAlertRssXml(text);
    return { ok: true, items, url: target };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      url: target,
    };
  }
}
