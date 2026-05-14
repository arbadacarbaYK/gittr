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
 */
export function filterDisplayCloneUrlsForSidebar(
  urls: string[],
  options: {
    primaryGitServerEnv?: string;
    sourceUrl?: string;
  }
): string[] {
  const primary = primaryGitHostFromEnv(options.primaryGitServerEnv);
  const src = options.sourceUrl?.trim();
  if (!primary) return urls;

  const hasPrimary = urls.some((u) => gitUrlHostname(u) === primary);
  if (!hasPrimary) return urls;

  return urls.filter((u) => {
    const t = String(u || "").trim();
    if (!t) return false;
    if (t.startsWith("nostr://")) return true;
    if (src && sourceMatchesUpstreamClone(t, src)) return true;
    const h = gitUrlHostname(t);
    if (h === primary) return true;
    if (isGraspServer(t) && h !== primary) return false;
    return true;
  });
}
