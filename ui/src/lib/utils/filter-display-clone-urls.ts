import { isGraspDomainForPushing, isGraspServer } from "./grasp-servers";

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
 * Sidebar clone list: keep primary git host + forge `source` + every host on the
 * Push allowlist (GRASP_SERVERS_FOR_PUSHING). Hide bare IP mirrors and random
 * third-party GRASP hosts that are not in the push set (legacy noise).
 */
export function filterDisplayCloneUrlsForSidebar(
  urls: string[],
  options: {
    primaryGitServerEnv?: string;
    sourceUrl?: string;
  }
): string[] {
  const withoutEmpty = urls.map((u) => String(u || "").trim()).filter(Boolean);

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

  return withoutBareIps.filter((u) => {
    if (u.startsWith("nostr://")) return true;
    if (src && sourceMatchesUpstreamClone(u, src)) return true;
    const h = gitUrlHostname(u);
    if (primary && h === primary) return true;
    // Keep mirrors we actually advertise on Push to Nostr
    if (isGraspDomainForPushing(h) || isGraspDomainForPushing(u)) return true;
    // Drop other GRASP hosts not on the push allowlist
    if (isGraspServer(u)) return false;
    return true;
  });
}
