import path from "path";

import fs from "fs/promises";

export const NOSTR_SEO_REPOS_SNAPSHOT_PATH = path.join(
  process.cwd(),
  "data",
  "nostr-seo-repos-snapshot.json"
);

/** Lab-agent mirror next to /lab HTML (server-only; Next does not read this). */
export const NOSTR_SEO_REPOS_LAB_MIRROR_PATH = path.join(
  process.cwd(),
  "..",
  "data",
  "lab-snapshot",
  "nostr-seo-repos-snapshot.json"
);

/** Ignore snapshots older than this (force a fresh discovery). */
export const SEO_SNAPSHOT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export type NostrSeoReposSnapshot = {
  at: number;
  /** npub1…/repo → lastModified ms */
  paths: Record<string, number>;
};

export async function loadNostrSeoReposSnapshot(): Promise<NostrSeoReposSnapshot | null> {
  try {
    const raw = await fs.readFile(NOSTR_SEO_REPOS_SNAPSHOT_PATH, "utf8");
    const parsed = JSON.parse(raw) as NostrSeoReposSnapshot;
    if (!parsed || typeof parsed.at !== "number" || !parsed.paths) return null;
    if (Date.now() - parsed.at > SEO_SNAPSHOT_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Best-effort copy for lab agents (same bytes as UI snapshot). */
export async function mirrorNostrSeoReposSnapshotToLab(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(NOSTR_SEO_REPOS_LAB_MIRROR_PATH), {
      recursive: true,
    });
    await fs.copyFile(
      NOSTR_SEO_REPOS_SNAPSHOT_PATH,
      NOSTR_SEO_REPOS_LAB_MIRROR_PATH
    );
  } catch {
    /* optional mirror — do not fail the SEO write */
  }
}

export async function saveNostrSeoReposSnapshot(
  pathToModified: Map<string, number>
): Promise<NostrSeoReposSnapshot> {
  const snap: NostrSeoReposSnapshot = {
    at: Date.now(),
    paths: Object.fromEntries(pathToModified),
  };
  await fs.mkdir(path.dirname(NOSTR_SEO_REPOS_SNAPSHOT_PATH), {
    recursive: true,
  });
  await fs.writeFile(
    NOSTR_SEO_REPOS_SNAPSHOT_PATH,
    JSON.stringify(snap),
    "utf8"
  );
  await mirrorNostrSeoReposSnapshotToLab();
  return snap;
}

export function snapshotPathMap(
  snap: NostrSeoReposSnapshot | null
): Map<string, number> {
  if (!snap?.paths) return new Map();
  return new Map(Object.entries(snap.paths));
}
