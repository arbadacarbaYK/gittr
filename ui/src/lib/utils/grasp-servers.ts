/**
 * Centralized list of known GRASP (Git-Nostr-Bridge) server domains
 *
 * GRASP servers are BOTH Nostr relays (wss://) AND git servers (git:///http:///https://)
 * They support the NIP-34 protocol for git repositories on Nostr.
 *
 * This list is used across the application to:
 * - Identify GRASP servers vs regular Nostr relays
 * - Prioritize GRASP servers for repository operations (they have the most repos)
 * - Display GRASP servers separately in the UI
 */

/**
 * KNOWN_GRASP_DOMAINS: List of actual GRASP git servers (NOT regular Nostr relays)
 *
 * GRASP servers are BOTH Nostr relays AND git servers that support NIP-34.
 * They serve git repositories via HTTPS/SSH and can be cloned with standard git commands.
 *
 * Regular Nostr relays (like relay.damus.io, nos.lol) are NOT GRASP servers
 * and should NOT be included in clone URLs.
 *
 * This list includes ALL known GRASP servers (for reading/fetching repos).
 */
export const KNOWN_GRASP_DOMAINS = [
  // Actual GRASP git servers (verified to serve git repos)
  "relay.ngit.dev",
  "ngit-relay.nostrver.se",
  "gitnostr.com",
  "ngit.danconwaydev.com",
  "git.shakespeare.diy",
  "git-01.uid.ovh",
  "git-02.uid.ovh",
  "git.jb55.com", // Read-only: jb55 hosts repos but only their own, not a public GRASP server for pushing
  // gittr.space GRASP server (our own server)
  "git.gittr.space",
] as const;

/**
 * Never auto-add these to Push `clone[]` / GRASP sync waits — even if the user
 * lists them in kind 10317. Still OK for *reading* other people's clone tags.
 */
export const GRASP_DOMAINS_EXCLUDED_FROM_PUSHING = [
  "git-01.uid.ovh",
  "git-02.uid.ovh",
  "git.jb55.com",
  // Public ngit mirror; often 502 / WSS refused (2026-07) — stalls Push sync
  "ngit-relay.nostrver.se",
] as const;

/**
 * GRASP_SERVERS_FOR_PUSHING: default GRASP hosts we add to NIP-34 `clone` and
 * wait on during Push (when present in env relays). Must accept announcements
 * from arbitrary users and be reasonably reachable.
 *
 * Exclusions live in GRASP_DOMAINS_EXCLUDED_FROM_PUSHING (still in
 * KNOWN_GRASP_DOMAINS for fetching).
 */
export const GRASP_SERVERS_FOR_PUSHING = [
  "relay.ngit.dev",
  "gitnostr.com",
  "ngit.danconwaydev.com",
  "git.shakespeare.diy",
  // gittr.space GRASP server (our own)
  "git.gittr.space",
] as const;

/** Normalize a relay/git URL or bare host to lowercase hostname. */
export function normalizeGraspHost(hostOrUrl: string): string {
  if (!hostOrUrl) return "";
  return (
    hostOrUrl
      .trim()
      .replace(/^wss?:\/\//i, "")
      .replace(/^https?:\/\//i, "")
      .replace(/^git:\/\//i, "")
      .replace(/^git@/i, "")
      .split("/")[0]
      ?.split(":")[0]
      ?.toLowerCase() || ""
  );
}

export function isGraspDomainExcludedFromPushing(hostOrUrl: string): boolean {
  const domain = normalizeGraspHost(hostOrUrl);
  if (!domain) return false;
  return GRASP_DOMAINS_EXCLUDED_FROM_PUSHING.some(
    (ex) => domain === ex || domain.endsWith(`.${ex}`)
  );
}

/** Domain match helper for GRASP push allowlist (defaults). */
export function isGraspDomainForPushing(hostOrUrl: string): boolean {
  const domain = normalizeGraspHost(hostOrUrl);
  if (!domain || isGraspDomainExcludedFromPushing(domain)) return false;
  return GRASP_SERVERS_FOR_PUSHING.some(
    (grasp) => domain === grasp || domain.endsWith(`.${grasp}`)
  );
}

/**
 * Merge user kind-10317 GRASP prefs + env/default GRASP into unique hostnames
 * for Push clone tags. User order wins; duplicates (same host) are skipped once.
 *
 * - Defaults: must be on GRASP_SERVERS_FOR_PUSHING
 * - User list: allowlist OR any isGraspServer host, unless excluded
 */
export function mergeGraspHostsForPush(
  userGraspWssOrHosts: string[],
  defaultGraspWssOrHosts: string[]
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const consider = (entry: string, fromUser: boolean) => {
    const host = normalizeGraspHost(entry);
    if (!host || seen.has(host)) return;
    if (isGraspDomainExcludedFromPushing(host)) return;
    const allowed =
      isGraspDomainForPushing(host) ||
      (fromUser && isGraspServer(`wss://${host}`));
    if (!allowed) return;
    seen.add(host);
    out.push(host);
  };

  for (const u of userGraspWssOrHosts) consider(u, true);
  for (const u of defaultGraspWssOrHosts) consider(u, false);
  return out;
}

/**
 * Check if a URL is a GRASP server
 * @param url - The relay or git server URL (wss://, git://, http://, https://)
 * @returns true if the URL is a known GRASP server
 */
export function isGraspServer(url: string): boolean {
  if (!url) return false;

  // Extract domain from URL (remove protocol and path)
  const domain = normalizeGraspHost(url);
  if (!domain) return false;

  // Check against known GRASP domains
  if (
    KNOWN_GRASP_DOMAINS.some((grasp) => {
      const graspDomain = grasp.toLowerCase();
      return (
        domain === graspDomain ||
        domain.includes(graspDomain) ||
        graspDomain.includes(domain)
      );
    })
  ) {
    return true;
  }

  // Pattern matching: Any relay with "git." in domain is likely GRASP
  if (domain.includes("git.")) {
    return true;
  }

  // Pattern matching: git-01., git-02., etc.
  if (domain.match(/git-\d+\./)) {
    return true;
  }

  return false;
}

/**
 * Filter relays to get only GRASP servers
 * @param relays - Array of relay URLs
 * @returns Array of GRASP server URLs
 */
export function getGraspServers(relays: string[]): string[] {
  return relays.filter(isGraspServer);
}

/**
 * Filter relays to get only regular Nostr relays (not GRASP)
 * @param relays - Array of relay URLs
 * @returns Array of regular relay URLs
 */
export function getRegularRelays(relays: string[]): string[] {
  return relays.filter((r) => !isGraspServer(r));
}
