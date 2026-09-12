/**
 * Whether a NIP-34 issue/PR event is for this repo route.
 * `a` tags look like `30617:<owner-hex>:<d>` and may include a relay hint in t[2].
 */
export function eventBelongsToRepo(
  event: { tags: string[][] },
  entity: string,
  repo: string,
  ownerHex: string | null
): boolean {
  const aTag = event.tags.find((t) => t[0] === "a");
  if (aTag?.[1]) {
    const parts = aTag[1].split(":");
    if (parts.length >= 3 && parts[0] === "30617") {
      return parts[2] === repo;
    }
  }
  const repoTag = event.tags.find((t) => t[0] === "repo");
  if (!repoTag) return false;
  const ownerOk =
    repoTag[1] === entity || (ownerHex != null && repoTag[1] === ownerHex);
  return ownerOk && repoTag[2] === repo;
}
