import { nip19 } from "nostr-tools";
import { describe, expect, it } from "vitest";

import { KIND_SOFTWARE_APPLICATION } from "../nostr/nip82-software";

import {
  pickListedAppForRepo,
  resolveRepoAppId,
  softwareAppMatchesGittrRepo,
} from "./listed-app-for-repo";

const OWNER =
  "f6150173b5d6f079b43540d84a8a95d50cf01a48c9d6037984e3d9600d5522af";
const NPUB = nip19.npubEncode(OWNER);

function app(
  tags: string[][],
  over: Partial<{ pubkey: string; createdAt: number }> = {}
) {
  const pubkey = over.pubkey || OWNER;
  return {
    pubkey,
    appId: tags.find((t) => t[0] === "d")?.[1] || "x",
    name: tags.find((t) => t[0] === "name")?.[1] || "x",
    gittrRepoPath: undefined as string | undefined,
    createdAt: over.createdAt ?? 1,
    raw: {
      id: "1".repeat(64),
      pubkey,
      kind: KIND_SOFTWARE_APPLICATION,
      created_at: over.createdAt ?? 1,
      content: "",
      tags,
    },
  };
}

describe("softwareAppMatchesGittrRepo", () => {
  it("matches buho-go via NIP-34 a-tag (not a second Push)", () => {
    const listing = app([
      ["d", "space.gittr.buhogo"],
      ["name", "buho-go"],
      ["a", `30617:${OWNER}:buho-go`],
    ]);
    expect(
      softwareAppMatchesGittrRepo(listing, {
        ownerPubkeyHex: OWNER,
        repoName: "buho-go",
        entity: NPUB,
      })
    ).toBe(true);
  });

  it("does not attach another publisher's app", () => {
    const listing = app(
      [
        ["d", "space.gittr.buhogo"],
        ["name", "buho-go"],
        ["a", `30617:${OWNER}:buho-go`],
      ],
      { pubkey: "aa".repeat(32) }
    );
    expect(
      softwareAppMatchesGittrRepo(listing, {
        ownerPubkeyHex: OWNER,
        repoName: "buho-go",
      })
    ).toBe(false);
  });

  it("does not fuzzy-match a short repo token inside a longer package id", () => {
    const listing = app([
      ["d", "space.gittr.buhogo"],
      ["name", "Buho GO"],
    ]);
    expect(
      softwareAppMatchesGittrRepo(listing, {
        ownerPubkeyHex: OWNER,
        repoName: "go",
      })
    ).toBe(false);
  });

  it("matches when the app name equals the repo slug", () => {
    const listing = app([
      ["d", "com.example.wallet"],
      ["name", "buho-go"],
    ]);
    expect(
      softwareAppMatchesGittrRepo(listing, {
        ownerPubkeyHex: OWNER,
        repoName: "buho-go",
      })
    ).toBe(true);
  });
});

describe("pickListedAppForRepo", () => {
  it("picks the newest matching listing", () => {
    const older = {
      ...app(
        [
          ["d", "space.gittr.buhogo"],
          ["name", "buho-go"],
          ["a", `30617:${OWNER}:buho-go`],
        ],
        { createdAt: 10 }
      ),
    };
    const newer = {
      ...app(
        [
          ["d", "space.gittr.buhogo"],
          ["name", "buho-go"],
          ["a", `30617:${OWNER}:buho-go`],
        ],
        { createdAt: 20 }
      ),
    };
    const picked = pickListedAppForRepo([older, newer], {
      ownerPubkeyHex: OWNER,
      repoName: "buho-go",
    });
    expect(picked?.createdAt).toBe(20);
  });
});

describe("resolveRepoAppId", () => {
  it("prefers the local announce over the catalog", () => {
    expect(resolveRepoAppId("space.gittr.buhogo", "com.other.app")).toBe(
      "space.gittr.buhogo"
    );
  });

  it("uses the catalog when this browser never announced", () => {
    expect(resolveRepoAppId(null, "space.gittr.buhogo")).toBe(
      "space.gittr.buhogo"
    );
  });

  it("ignores stray GITTR so catalog can fill the live id", () => {
    expect(resolveRepoAppId("GITTR", "space.gittr.app")).toBe(
      "space.gittr.app"
    );
  });
});
