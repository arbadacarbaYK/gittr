/** Human-readable names for the My Repos republish banner / confirm. */
export function formatCloneRepublishRepoNames(
  repos: Array<{
    repositoryName?: string;
    repo?: string;
    slug?: string;
    name?: string;
  }>,
  maxListed = 8
): string {
  const names = repos
    .map((r) =>
      String(r.repositoryName || r.repo || r.slug || r.name || "")
        .trim()
        .replace(/\.git$/i, "")
    )
    .filter(Boolean);
  if (names.length === 0) return "";
  if (names.length <= maxListed) return names.join(", ");
  const shown = names.slice(0, maxListed).join(", ");
  return `${shown} (+${names.length - maxListed} more)`;
}
