/**
 * Choose which file-tree listing to show on the Code tab.
 *
 * Historically we picked the *shortest* non-empty candidate to avoid polluted
 * GRASP mirrors. That inverted “keep richer local” and made a thin remote
 * listing hide newly uploaded paths (often root README.md) after redirect.
 */

export type SelectDisplayRepoFileTreeOpts<T extends { path: string }> = {
  indexed: T[];
  repoFiles?: T[] | null;
  bridgeFiles?: T[] | null;
  /** Forge/npub mirror preference when the viewer has no local edits. */
  preferUpstream: boolean;
  hasUnpushedEdits: boolean;
  /**
   * True when preferUpstream is because of a real forge SOURCE (GitHub/…).
   * False when preferUpstream is only “npub route” — then richest wins.
   */
  forgeUpstreamAuthoritative?: boolean;
  scrub?: (list: T[]) => T[];
  /** Path-union merge; later list wins bodies the same way as mergeRepoFileIndexes. */
  mergeIndexes: (a: T[], b: T[]) => T[];
};

function nonEmpty<T>(list: T[] | null | undefined): T[] {
  return Array.isArray(list) && list.length > 0 ? list : [];
}

/**
 * Pick the display tree for RepoCodePage `safeFiles`.
 */
export function selectDisplayRepoFileTree<T extends { path: string }>(
  opts: SelectDisplayRepoFileTreeOpts<T>
): T[] {
  const scrub = opts.scrub ?? ((list: T[]) => list);
  const indexed = scrub(nonEmpty(opts.indexed));
  const repoFiles = scrub(nonEmpty(opts.repoFiles));
  const bridge = scrub(nonEmpty(opts.bridgeFiles));
  const { mergeIndexes } = opts;

  // Owner just uploaded / edited: union network + local, local index last so
  // new paths (README) and override-backed rows win.
  if (opts.hasUnpushedEdits && indexed.length > 0) {
    const network = mergeIndexes(repoFiles, bridge);
    return mergeIndexes(network, indexed);
  }

  // Declared forge SOURCE without local edits: first non-empty in upstream order.
  if (opts.preferUpstream && opts.forgeUpstreamAuthoritative) {
    for (const list of [repoFiles, bridge, indexed]) {
      if (list.length > 0) return list;
    }
    return [];
  }

  // Nostr-only / cache: prefer the richest scrubbed listing (not the shortest).
  let best: T[] = [];
  for (const list of [indexed, repoFiles, bridge]) {
    if (list.length > best.length) best = list;
  }
  return best;
}

/**
 * When applying an upload batch, do not delete a flat basename that was also
 * part of this same batch (e.g. root README.md + docs/README.md).
 */
export function shouldDropFlatBasenameForNestedUpload(
  nestedPath: string,
  flatBasename: string,
  pathsInThisUpload: Set<string>
): boolean {
  if (!nestedPath.includes("/")) return false;
  if (!flatBasename || flatBasename === nestedPath) return false;
  if (pathsInThisUpload.has(flatBasename)) return false;
  return true;
}
