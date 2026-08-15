import { describe, expect, it } from "vitest";

import {
  collectStarredOwnerPubkeys,
  resolveStarredRepoIcon,
} from "./starred-repo-icon";

const NPUB =
  "npub1ye5ptcxfyyxl5vjvdjar2ua3f0hynkjzpx552mu5snj3qmx5pzjscpknpr";
// nip19 decode of above (hzrd149 / wok owner in prod fixtures — verify via getRepoOwnerPubkey path)
const OWNER_HEX =
  "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5";

describe("resolveStarredRepoIcon", () => {
  it("uses kind-0 picture for npub entity even without matchingRepo.ownerPubkey", () => {
    const icon = resolveStarredRepoIcon(
      { entity: NPUB, repo: "wok", slug: `${NPUB}/wok` },
      null,
      {
        [OWNER_HEX]: {
          picture: "https://example.com/avatar.png",
          name: "hzrd149",
        },
      }
    );
    expect(icon).toBe("https://example.com/avatar.png");
  });

  it("prefers logoUrl over metadata picture", () => {
    const icon = resolveStarredRepoIcon(
      {
        entity: NPUB,
        repo: "wok",
        logoUrl: "https://cdn.example/logo.png",
      },
      null,
      {
        [OWNER_HEX]: { picture: "https://example.com/avatar.png" },
      }
    );
    expect(icon).toBe("https://cdn.example/logo.png");
  });

  it("ignores non-http pictures", () => {
    const icon = resolveStarredRepoIcon(
      { entity: NPUB, repo: "wok" },
      null,
      {
        [OWNER_HEX]: { picture: "data:image/png;base64,xxx" },
      }
    );
    expect(icon).toBeNull();
  });
});

describe("collectStarredOwnerPubkeys", () => {
  it("decodes npub entities into hex for metadata fetch", () => {
    const keys = collectStarredOwnerPubkeys(
      [{ entity: NPUB, repo: "wok", slug: `${NPUB}/wok` }],
      []
    );
    expect(keys).toEqual([OWNER_HEX]);
  });

  it("uses matchingRepo.ownerPubkey when present", () => {
    const hex =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const keys = collectStarredOwnerPubkeys(
      [{ entity: NPUB, repo: "coinjoin", slug: `${NPUB}/coinjoin` }],
      [
        {
          slug: `${NPUB}/coinjoin`,
          entity: NPUB,
          repo: "coinjoin",
          ownerPubkey: hex,
        },
      ]
    );
    expect(keys).toEqual([hex]);
  });
});
