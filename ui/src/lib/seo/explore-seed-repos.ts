import { nip19 } from "nostr-tools";

export type ExploreSeedRepo = {
  entity: string;
  repo: string;
  repoName: string;
  ownerPubkey: string;
  lastActivity: number;
  /** Thin seed from SEO sitemap snapshot — Nostr sync may enrich later. */
  fromSeoSnapshot?: boolean;
};

function pathKeyToSeedRepo(
  pathKey: string,
  lastActivity: number
): ExploreSeedRepo | null {
  const slash = pathKey.indexOf("/");
  if (slash <= 0) return null;
  const entity = pathKey.slice(0, slash).trim();
  const repo = pathKey.slice(slash + 1).trim();
  if (!entity.startsWith("npub1") || !repo) return null;
  let ownerPubkey = "";
  try {
    const decoded = nip19.decode(entity);
    if (decoded.type === "npub" && typeof decoded.data === "string") {
      ownerPubkey = decoded.data.toLowerCase();
    }
  } catch {
    return null;
  }
  if (!/^[0-9a-f]{64}$/.test(ownerPubkey)) return null;
  return {
    entity,
    repo,
    repoName: repo,
    ownerPubkey,
    lastActivity: typeof lastActivity === "number" ? lastActivity : 0,
    fromSeoSnapshot: true,
  };
}

/** Merge snapshot paths with optional `npub/repo` file lines, newest first. */
export function mergeExploreSeedPaths(
  snapshotPaths: Record<string, number> | Map<string, number>,
  extraPathKeys: string[] = [],
  extraActivityMs: number = Date.now()
): Map<string, number> {
  const out = new Map<string, number>();
  const entries =
    snapshotPaths instanceof Map
      ? snapshotPaths.entries()
      : Object.entries(snapshotPaths);
  for (const [key, ts] of entries) {
    if (!key) continue;
    out.set(key, typeof ts === "number" ? ts : 0);
  }
  for (const line of extraPathKeys) {
    const key = String(line || "").trim();
    if (!key || out.has(key)) continue;
    out.set(key, extraActivityMs);
  }
  return out;
}

export function buildExploreSeedRepos(
  pathToActivity: Map<string, number>,
  limit: number
): ExploreSeedRepo[] {
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 3000;
  const entries = [...pathToActivity.entries()]
    .sort((a, b) => (b[1] || 0) - (a[1] || 0))
    .slice(0, cap);

  const repos: ExploreSeedRepo[] = [];
  for (const [pathKey, lastActivity] of entries) {
    const row = pathKeyToSeedRepo(pathKey, lastActivity);
    if (row) repos.push(row);
  }
  return repos;
}
