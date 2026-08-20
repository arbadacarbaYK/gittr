import { describe, expect, it } from "vitest";

import {
  KIND_SOFTWARE_ASSET,
  KIND_SOFTWARE_RELEASE,
  type NostrEventLike,
  parseSoftwareRelease,
} from "./nip82-software";
import {
  assetIdsAndRelayHintsFromRelease,
  mapSoftwareReleaseToRepoRelease,
  mergeForgeAndNostrReleases,
  normalizeRepoAppToken,
  parseAssetsById,
  softwareReleaseMatchesRepo,
} from "./nip82-repo-releases";

const OWNER =
  "5e759c2ca4a4e222ba7af89e6ff315e1d27843fe8bd0a3e7e61e4ba5b1c07326";

function releaseEvent(tags: string[][]): NostrEventLike {
  return {
    id: "1".repeat(64),
    pubkey: OWNER,
    kind: KIND_SOFTWARE_RELEASE,
    created_at: 100,
    content: "notes",
    tags: [
      ["i", "MORP Box"],
      ["version", "0.1.3"],
      ["d", "MORP Box@0.1.3"],
      ["c", "main"],
      ...tags,
    ],
  };
}

describe("normalizeRepoAppToken", () => {
  it("equates hyphen and space forms", () => {
    expect(normalizeRepoAppToken("MORP-Box")).toBe(
      normalizeRepoAppToken("MORP Box")
    );
  });
});

describe("softwareReleaseMatchesRepo", () => {
  it("matches fuzzy i tag to repo name", () => {
    const parsed = parseSoftwareRelease(releaseEvent([]));
    expect(parsed).not.toBeNull();
    expect(
      softwareReleaseMatchesRepo(parsed!, {
        ownerPubkeyHex: OWNER,
        repoName: "MORP-Box",
      })
    ).toBe(true);
  });

  it("matches a-tag nip34 address even when i does not fuzzy-match", () => {
    const parsed = parseSoftwareRelease({
      id: "1".repeat(64),
      pubkey: OWNER,
      kind: KIND_SOFTWARE_RELEASE,
      created_at: 100,
      content: "",
      tags: [
        ["i", "unrelated-app-id"],
        ["version", "0.1.3"],
        ["d", "unrelated-app-id@0.1.3"],
        ["c", "main"],
        ["a", `30617:${OWNER}:MORP-Box`],
      ],
    });
    expect(
      softwareReleaseMatchesRepo(parsed!, {
        ownerPubkeyHex: OWNER,
        repoName: "MORP-Box",
      })
    ).toBe(true);
  });

  it("rejects other owners", () => {
    const parsed = parseSoftwareRelease({
      ...releaseEvent([]),
      pubkey: "a".repeat(64),
    });
    expect(
      softwareReleaseMatchesRepo(parsed!, {
        ownerPubkeyHex: OWNER,
        repoName: "MORP-Box",
      })
    ).toBe(false);
  });
});

describe("mergeForgeAndNostrReleases", () => {
  it("keeps forge row and appends nostr-only versions", () => {
    const merged = mergeForgeAndNostrReleases(
      [
        {
          name: "v1",
          tag_name: "1.0.0",
          source: "forge",
          assets: [{ name: "a.zip", platform: "linux", url: "https://ex/a" }],
        },
      ],
      [
        {
          name: "0.1.3",
          tag_name: "0.1.3",
          source: "nostr",
          nostrReleaseId: "ab",
          assets: [
            {
              name: "app.apk",
              platform: "android",
              url: "https://blossom.example/x",
            },
          ],
        },
        {
          name: "1.0.0",
          tag_name: "1.0.0",
          source: "nostr",
          assets: [],
        },
      ]
    );
    expect(merged).toHaveLength(2);
    const forge = merged.find((r) => r.tag_name === "1.0.0");
    expect(forge?.source).toBe("forge");
    expect(forge?.assets?.[0]?.url).toBe("https://ex/a");
    expect(merged.find((r) => r.tag_name === "0.1.3")?.source).toBe("nostr");
  });

  it("enriches forge row missing assets from nostr", () => {
    const merged = mergeForgeAndNostrReleases(
      [{ name: "1.0.0", tag_name: "1.0.0", source: "forge", assets: [] }],
      [
        {
          name: "1.0.0",
          tag_name: "1.0.0",
          source: "nostr",
          nostrReleaseId: "nid",
          assets: [
            { name: "a.apk", platform: "android", url: "https://b/a.apk" },
          ],
        },
      ]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.assets?.[0]?.url).toBe("https://b/a.apk");
    expect(merged[0]?.nostrReleaseId).toBe("nid");
  });
});

describe("assetIdsAndRelayHintsFromRelease", () => {
  it("reads e-tag relay hints", () => {
    const parsed = parseSoftwareRelease(
      releaseEvent([
        ["e", "2".repeat(64), "wss://relay.ngit.dev/"],
        ["e", "3".repeat(64)],
      ])
    )!;
    const { ids, relayHints } = assetIdsAndRelayHintsFromRelease(parsed);
    expect(ids).toHaveLength(2);
    expect(relayHints).toContain("wss://relay.ngit.dev");
  });
});

describe("mapSoftwareReleaseToRepoRelease", () => {
  it("maps blossom urls onto Release assets", () => {
    const release = parseSoftwareRelease(releaseEvent([]))!;
    const assets = parseAssetsById([
      {
        id: "2".repeat(64),
        pubkey: OWNER,
        kind: KIND_SOFTWARE_ASSET,
        created_at: 1,
        content: "",
        tags: [
          ["m", "application/vnd.android.package-archive"],
          ["x", "ab".repeat(32)],
          ["url", "https://blossom.ditto.pub/ab"],
          ["f", "android-arm64-v8a"],
        ],
      },
    ]);
    const row = mapSoftwareReleaseToRepoRelease(release, [
      assets.get("2".repeat(64))!,
    ]);
    expect(row.tag_name).toBe("0.1.3");
    expect(row.source).toBe("nostr");
    expect(row.assets?.[0]?.url).toContain("blossom.ditto.pub");
    expect(row.assets?.[0]?.platform).toBe("android");
  });
});

describe("SOFTWARE_CATALOG_RELAYS", () => {
  it("includes relay.ngit.dev for GRASP publishers", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(
        new URL("./software-catalog-relays.ts", import.meta.url),
        "utf8"
      )
    );
    expect(src).toContain("wss://relay.ngit.dev");
  });
});
