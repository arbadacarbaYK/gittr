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
 */
export const KNOWN_GRASP_DOMAINS = [
  // Actual GRASP git servers (verified to serve git repos)
  'relay.ngit.dev',
  'ngit-relay.nostrver.se',
  'gitnostr.com',
  'ngit.danconwaydev.com',
  'git.shakespeare.diy',
  'git-01.uid.ovh',
  'git-02.uid.ovh',
  'git.jb55.com',
  // gittr.space GRASP server (our own server)
  'git.gittr.space',
] as const;

/**
 * Check if a URL is a GRASP server
 * @param url - The relay or git server URL (wss://, git://, http://, https://)
 * @returns true if the URL is a known GRASP server
 */
export function isGraspServer(url: string): boolean {
  if (!url) return false;
  
  // Extract domain from URL (remove protocol and path)
  const domain = url
    .replace(/^wss?:\/\//, '')
    .replace(/^https?:\/\//, '')
    .replace(/^git:\/\//, '')
    .split('/')[0]
    ?.toLowerCase() || '';
  
  // Check against known GRASP domains
  if (domain && KNOWN_GRASP_DOMAINS.some(grasp => {
    const graspDomain = grasp.toLowerCase();
    return domain === graspDomain || 
           domain.includes(graspDomain) || 
           graspDomain.includes(domain);
  })) {
    return true;
  }
  
  // Pattern matching: Any relay with "git." in domain is likely GRASP
  if (domain.includes('git.')) {
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
  return relays.filter(r => !isGraspServer(r));
}

