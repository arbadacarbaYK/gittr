/** Gittr tag on kind 30617: the owner dropped the forge `source` on purpose. */
export const SOURCE_CLEARED_TAG = "source-cleared";

export function announcementClearsForgeSource(
  tags: string[][] | undefined
): boolean {
  return (tags || []).some(
    (tag) =>
      Array.isArray(tag) &&
      tag[0] === SOURCE_CLEARED_TAG &&
      String(tag[1] || "") === "true"
  );
}
