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

  it("does not stamp extra file lines as newest by default", () => {
    const merged = mergeExploreSeedPaths(
      { [`${NPUB}/gittr`]: 1_700_000_000_000 },
      [`${NPUB}/pushed-only`]
    );
    expect(merged.get(`${NPUB}/pushed-only`)).toBe(0);
    const repos = buildExploreSeedRepos(merged, 10);
    expect(repos[0]?.repo).toBe("gittr");
  });

  it("drops bare hex-64 d tags from the seed", () => {
    const hex =
      "7da083932c0e21087669074509b4e169b7ad9925c7a01c3fd3bd3dd0034d1336";
    const merged = mergeExploreSeedPaths({ [`${NPUB}/${hex}`]: 9 });
    expect(buildExploreSeedRepos(merged, 10)).toEqual([]);
  });
});
