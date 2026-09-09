import { describe, expect, it } from "vitest";

import {
  buildExploreSeedRepos,
  mergeExploreSeedPaths,
} from "./explore-seed-repos";

const NPUB = "npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc";

describe("mergeExploreSeedPaths + buildExploreSeedRepos", () => {
  it("keeps snapshot timestamps and fills gaps from the pushed-repos file", () => {
    const merged = mergeExploreSeedPaths(
      { [`${NPUB}/gittr`]: 100 },
      [`${NPUB}/gittr`, `${NPUB}/gitnostr`],
      999
    );
    expect(merged.get(`${NPUB}/gittr`)).toBe(100);
    expect(merged.get(`${NPUB}/gitnostr`)).toBe(999);
    const repos = buildExploreSeedRepos(merged, 10);
    expect(repos.map((r) => r.repo).sort()).toEqual(["gitnostr", "gittr"]);
    expect(repos.every((r) => r.fromSeoSnapshot && r.ownerPubkey)).toBe(true);
  });
});
