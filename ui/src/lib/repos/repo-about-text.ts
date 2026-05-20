/** NIP-34 default placeholder when no real description was set. */
export function isPlaceholderRepositoryDescription(
  description: string | undefined | null,
  repoName: string
): boolean {
  const d = (description || "").trim();
  if (!d) return true;
  const slug = (repoName || "").trim().toLowerCase();
  if (!slug) return d.toLowerCase().startsWith("repository:");
  return (
    d.toLowerCase() === `repository: ${slug}` ||
    d.toLowerCase() === `repository:${slug}` ||
    d.toLowerCase().startsWith("imported from ")
  );
}

export function sidebarAboutText(
  description: string | undefined | null,
  repoName: string
): string {
  const d = (description || "").trim();
  if (!d || isPlaceholderRepositoryDescription(d, repoName)) return "";
  return d;
}

/** Repo cards (home, explore, repositories list): real blurb only, never "Imported from …". */
export function repoCardDescriptionText(
  description: string | undefined | null,
  repoName: string
): string {
  return sidebarAboutText(description, repoName);
}
