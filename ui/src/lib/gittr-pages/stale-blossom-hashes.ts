/**
 * Which Blossom blobs a new page publish may remove.
 * A file that did not change keeps its fingerprint. A file another live page
 * still names is left alone. Everything the previous version used and the new
 * version does not is safe to delete.
 */

const SHA256_RE = /^[0-9a-f]{64}$/;

export type ManifestLike = {
  created_at?: number;
  id?: string;
  tags?: unknown;
};

function tagValue(tags: unknown, name: string): string {
  if (!Array.isArray(tags)) return "";
  for (const row of tags) {
    if (Array.isArray(row) && row[0] === name && typeof row[1] === "string") {
      return row[1].trim();
    }
  }
  return "";
}

export function manifestPathHashes(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of tags) {
    if (!Array.isArray(row) || row[0] !== "path") continue;
    const sha = String(row[2] ?? "").trim().toLowerCase();
    if (!SHA256_RE.test(sha) || seen.has(sha)) continue;
    seen.add(sha);
    out.push(sha);
  }
  return out;
}

function isNewer(candidate: ManifestLike, current: ManifestLike): boolean {
  const a = candidate.created_at ?? 0;
  const b = current.created_at ?? 0;
  if (a !== b) return a > b;
  return (candidate.id || "") > (current.id || "");
}

/** Latest event for one site name (`d` tag). */
export function newestManifestForDTag(
  events: ManifestLike[],
  dTag: string
): ManifestLike | null {
  const want = dTag.trim();
  let best: ManifestLike | null = null;
  for (const ev of events) {
    if (tagValue(ev.tags, "d") !== want) continue;
    if (!best || isNewer(ev, best)) best = ev;
  }
  return best;
}

/**
 * Fingerprints still named by this publisher's other live pages.
 * Relays may return older copies; only the newest event per site counts.
 */
export function hashesUsedByOtherSites(
  events: ManifestLike[],
  currentDTag: string
): string[] {
  const want = currentDTag.trim();
  const newest = new Map<string, ManifestLike>();
  for (const ev of events) {
    const d = tagValue(ev.tags, "d");
    if (!d || d === want) continue;
    const prev = newest.get(d);
    if (!prev || isNewer(ev, prev)) newest.set(d, ev);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ev of newest.values()) {
    for (const sha of manifestPathHashes(ev.tags)) {
      if (seen.has(sha)) continue;
      seen.add(sha);
      out.push(sha);
    }
  }
  return out;
}

export function staleBlossomHashes(args: {
  previousHashes: string[];
  nextHashes: string[];
  stillUsedHashes?: string[];
}): string[] {
  const next = new Set(args.nextHashes.map((h) => h.toLowerCase()));
  const keep = new Set(
    (args.stillUsedHashes || []).map((h) => h.toLowerCase())
  );
  const seen = new Set<string>();
  const stale: string[] = [];
  for (const raw of args.previousHashes) {
    const sha = String(raw || "").trim().toLowerCase();
    if (!SHA256_RE.test(sha) || seen.has(sha)) continue;
    seen.add(sha);
    if (next.has(sha) || keep.has(sha)) continue;
    stale.push(sha);
  }
  return stale;
}
