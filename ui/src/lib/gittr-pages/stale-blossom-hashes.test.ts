import { describe, expect, it } from "vitest";

import {
  hashesUsedByOtherSites,
  manifestPathHashes,
  newestManifestForDTag,
  staleBlossomHashes,
} from "./stale-blossom-hashes";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

describe("staleBlossomHashes", () => {
  it("drops fingerprints the new version no longer uses", () => {
    expect(
      staleBlossomHashes({
        previousHashes: [A, B],
        nextHashes: [B, C],
      })
    ).toEqual([A]);
  });

  it("keeps a file another live page still names", () => {
    expect(
      staleBlossomHashes({
        previousHashes: [A, B],
        nextHashes: [B],
        stillUsedHashes: [A],
      })
    ).toEqual([]);
  });

  it("ignores junk and repeats", () => {
    expect(
      staleBlossomHashes({
        previousHashes: ["nope", A, A.toUpperCase()],
        nextHashes: [],
      })
    ).toEqual([A]);
  });
});

describe("manifest selection", () => {
  it("reads path fingerprints and picks the newest event for this site", () => {
    const older = {
      created_at: 10,
      id: "1",
      tags: [
        ["d", "docs"],
        ["path", "/index.html", A],
      ],
    };
    const newer = {
      created_at: 20,
      id: "2",
      tags: [
        ["d", "docs"],
        ["path", "/index.html", B],
      ],
    };
    expect(manifestPathHashes(older.tags)).toEqual([A]);
    expect(newestManifestForDTag([older, newer], "docs")).toBe(newer);
  });

  it("keeps hashes from the newest copy of a different site only", () => {
    const events = [
      {
        created_at: 1,
        tags: [
          ["d", "other"],
          ["path", "/old.html", A],
        ],
      },
      {
        created_at: 5,
        tags: [
          ["d", "other"],
          ["path", "/index.html", C],
        ],
      },
      {
        created_at: 9,
        tags: [
          ["d", "docs"],
          ["path", "/index.html", B],
        ],
      },
    ];
    expect(hashesUsedByOtherSites(events, "docs")).toEqual([C]);
  });
});
