import { isGraspServer } from "@/lib/utils/grasp-servers";

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
 * Older repository announcements listed many public GRASP HTTPS/SSH mirrors even though
 * the repo was only pushed to the primary git host. When the list already includes that
 * primary host (from NEXT_PUBLIC_GIT_SERVER_URL), hide other GRASP hosts for sidebar display.
 * If the announcement does not mention the primary host, keep all URLs (avoid breaking
 * repos that only advertise a third-party GRASP host).
 *
 * Also hides bare IP clone hosts (e.g. http://23.x.x.x:7334/…) when any named-host
 * clone URL exists — those are legacy grasp mirrors and confuse the sidebar.
 */
export function filterDisplayCloneUrlsForSidebar(
  urls: string[],
  options: {
    primaryGitServerEnv?: string;
    sourceUrl?: string;
  }
): string[] {
  const withoutEmpty = urls
    .map((u) => String(u || "").trim())
    .filter(Boolean);

  const hasNamedHost = withoutEmpty.some((u) => {
    if (u.startsWith("nostr://")) return true;
    const h = gitUrlHostname(u);
    return !!h && !isIpLiteralHostname(h);
  });
  const withoutBareIps = hasNamedHost
    ? withoutEmpty.filter((u) => {
        if (u.startsWith("nostr://")) return true;
        return !isIpLiteralHostname(gitUrlHostname(u));
      })
    : withoutEmpty;

  const primary = primaryGitHostFromEnv(options.primaryGitServerEnv);
  const src = options.sourceUrl?.trim();
  if (!primary) return withoutBareIps;

  const hasPrimary = withoutBareIps.some((u) => gitUrlHostname(u) === primary);
  if (!hasPrimary) return withoutBareIps;

  return withoutBareIps.filter((u) => {
    if (u.startsWith("nostr://")) return true;
    if (src && sourceMatchesUpstreamClone(u, src)) return true;
    const h = gitUrlHostname(u);
    if (h === primary) return true;
    if (isGraspServer(u) && h !== primary) return false;
    return true;
  });
}
