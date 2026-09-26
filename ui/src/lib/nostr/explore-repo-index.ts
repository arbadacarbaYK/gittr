/**
 * Match an incoming repository announcement to a row already in the Explore
 * catalog. Callers must not bech32-decode every saved row on every event —
 * that scan froze the tab once the public list reached a few thousand repos.
 */

export function exploreRepoMatchKey(ownerHex: string, repoName: string): string {
  const owner = ownerHex.trim().toLowerCase();
  const label = repoName.trim().toLowerCase().replace(/[_-]/g, "");
  if (!owner || !label) return "";
  return `${owner}::${label}`;
}
