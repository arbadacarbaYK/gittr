/**
 * GRASP/git-nostr-bridge mirrors sometimes expose the whole repositories directory
 * as paths like `{64-hex-pubkey}/{repo}/...` or `npub1…/{repo}/...` inside one repo tree.
 * Strip those from the file browser — they are server layout, not project files.
 */

const NPUB_DIR = /^npub1[a-z0-9]+$/i;
const HEX_DIR = /^[0-9a-f]{64}$/i;

function firstPathSegment(path: string): string {
  return (
    String(path || "")
      .replace(/^\//, "")
      .split("/")
      .filter(Boolean)[0] || ""
  );
}

export function isGraspMirrorFilesystemPollutionPath(path: string): boolean {
  const first = firstPathSegment(path);
  return NPUB_DIR.test(first) || HEX_DIR.test(first);
}

export function filterGraspMirrorPollutionFromFileTree<
  T extends { path: string }
>(files: T[], opts?: { ownerPubkeyHex?: string }): T[] {
  if (!Array.isArray(files) || files.length === 0) return files;

  const owner = opts?.ownerPubkeyHex?.toLowerCase();
  const foreignHexDirs = new Set<string>();
  const foreignNpubDirs = new Set<string>();

  for (const f of files) {
    const first = firstPathSegment(f.path);
    if (HEX_DIR.test(first)) {
      if (owner && first.toLowerCase() === owner) continue;
      foreignHexDirs.add(first.toLowerCase());
    } else if (NPUB_DIR.test(first)) {
      foreignNpubDirs.add(first.toLowerCase());
    }
  }

  const foreignRootDirs = foreignHexDirs.size + foreignNpubDirs.size;
  // Always scrub when the tree is huge or any foreign pubkey/npub root appears (GRASP mirror layout).
  if (foreignRootDirs >= 1 || files.length >= 150) {
    return files.filter((f) => {
      const first = firstPathSegment(f.path);
      if (NPUB_DIR.test(first)) return false;
      if (HEX_DIR.test(first)) {
        if (owner && first.toLowerCase() === owner) return true;
        return false;
      }
      return true;
    });
  }

  return files.filter((f) => {
    const first = firstPathSegment(f.path);
    if (NPUB_DIR.test(first)) return false;
    if (HEX_DIR.test(first)) {
      if (owner && first.toLowerCase() === owner) return true;
      return false;
    }
    return true;
  });
}

/** Cap absurdly large bridge trees (mirror bloat) for UI responsiveness. */
export const REPO_FILE_TREE_SOFT_CAP = 1200;

export type CapFileTreeResult<T extends { path: string }> = {
  files: T[];
  truncated: boolean;
  originalCount: number;
};

export function capRepoFileTreeForDisplay<T extends { path: string }>(
  files: T[]
): CapFileTreeResult<T> {
  if (!Array.isArray(files) || files.length <= REPO_FILE_TREE_SOFT_CAP) {
    return { files, truncated: false, originalCount: files.length };
  }
  return {
    files: files.slice(0, REPO_FILE_TREE_SOFT_CAP),
    truncated: true,
    originalCount: files.length,
  };
}

/** Plain list for APIs / React state after filter + cap. */
export function fileTreeListFromScrub<T extends { path: string }>(
  result: CapFileTreeResult<T> | T[]
): T[] {
  return Array.isArray(result) ? result : result.files;
}
