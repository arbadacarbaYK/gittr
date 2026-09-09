import { describe, expect, it } from "vitest";

import {
  SEO_SNAPSHOT_MAX_AGE_MS,
  parseNostrSeoReposSnapshot,
  snapshotIsStale,
} from "./nostr-seo-repos-snapshot";

const PATHS = {
  "npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr": 1,
};

describe("parseNostrSeoReposSnapshot", () => {
  it("returns a fresh snapshot", () => {
    const now = 1_000_000;
    const raw = JSON.stringify({ at: now - 60_000, paths: PATHS });
    const snap = parseNostrSeoReposSnapshot(raw, now);
    expect(snap?.paths).toEqual(PATHS);
    expect(snapshotIsStale(snap!.at, now)).toBe(false);
  });

  it("drops a stale snapshot unless allowStale", () => {
    const now = SEO_SNAPSHOT_MAX_AGE_MS + 50_000;
    const raw = JSON.stringify({ at: 1, paths: PATHS });
    expect(parseNostrSeoReposSnapshot(raw, now)).toBeNull();
    const kept = parseNostrSeoReposSnapshot(raw, now, { allowStale: true });
    expect(snapShotPathCount(kept)).toBe(1);
    expect(snapshotIsStale(kept!.at, now)).toBe(true);
  });
});

function snapShotPathCount(
  snap: ReturnType<typeof parseNostrSeoReposSnapshot>
): number {
  return snap ? Object.keys(snap.paths).length : 0;
}
