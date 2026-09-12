import { describe, expect, it } from "vitest";

import {
  extractKnownForgeRepo,
  logoUrlFromNip34Tags,
  nativeRepoAvatarUrl,
  resolveRepoDisplayIcon,
} from "./resolve-repo-display-icon";

const OWNER =
  "746006d8779bd04e3219345594a4489a4246e74018f15e575e4fd14c9566bd5d";

describe("extractKnownForgeRepo", () => {
  it("parses GitHub HTTPS and SSH", () => {
    expect(
      extractKnownForgeRepo("https://github.com/greenart7c3/Amber.git")
    ).toEqual({
      hostname: "github.com",
      owner: "greenart7c3",
      repo: "Amber",
    });
    expect(
      extractKnownForgeRepo("git@github.com:greenart7c3/Amber.git")
    ).toEqual({
      hostname: "github.com",
      owner: "greenart7c3",
      repo: "Amber",
    });
  });

  it("rejects GRASP clones and custom ai:user@host source strings", () => {
    expect(
      extractKnownForgeRepo(
        "https://relay.ngit.dev/npub1w3sqdkrhn0gyuvsex32effzgnfpyde6qrrc4u467flg5e9txh4wsfn5vjg/archy.git"
      )
    ).toBeNull();
    expect(
      extractKnownForgeRepo(
        "ai:UnforgettablePassword1024@source.archipelago-foundation.org/lfg2025/archy"
      )
    ).toBeNull();
    expect(
      extractKnownForgeRepo(
        "https://gitnostr.com/npub1w3sqdkrhn0gyuvsex32effzgnfpyde6qrrc4u467flg5e9txh4wsfn5vjg/archy.git"
      )
    ).toBeNull();
  });
});

describe("resolveRepoDisplayIcon", () => {
  it("prefers stored logoUrl", () => {
    expect(
      resolveRepoDisplayIcon({
        logoUrl: "https://cdn.example/repo.png",
        ownerPicture: "https://cdn.example/owner.png",
      })
    ).toBe("https://cdn.example/repo.png");
  });

  it("uses raw GitHub logo files", () => {
    expect(
      resolveRepoDisplayIcon({
        files: [{ path: "logo.png" }],
        sourceUrl: "https://github.com/acme/lab",
        defaultBranch: "main",
        ownerPicture: "https://cdn.example/owner.png",
      })
    ).toBe("https://raw.githubusercontent.com/acme/lab/main/logo.png");
  });

  it("uses bridge avatar bytes for Nostr-only repos, not JSON file-content", () => {
    const icon = resolveRepoDisplayIcon({
      files: [{ path: "logo.png" }],
      sourceUrl:
        "ai:UnforgettablePassword1024@source.archipelago-foundation.org/lfg2025/archy",
      clone: [
        "https://relay.ngit.dev/npub1w3sqdkrhn0gyuvsex32effzgnfpyde6qrrc4u467flg5e9txh4wsfn5vjg/archy.git",
      ],
      ownerPubkey: OWNER,
      repoName: "archy",
      ownerPicture: "https://cdn.example/owner.png",
    });
    expect(icon).toBe(nativeRepoAvatarUrl(OWNER, "archy"));
    expect(icon).not.toContain("file-content");
  });

  it("falls back to owner picture when there is no logo file on explore", () => {
    expect(
      resolveRepoDisplayIcon({
        sourceUrl:
          "ai:UnforgettablePassword1024@source.archipelago-foundation.org/lfg2025/archy",
        ownerPubkey: OWNER,
        repoName: "archy",
        ownerPicture: "https://cdn.example/owner.png",
      })
    ).toBe("https://cdn.example/owner.png");
  });

  it("header may try the bridge logo before the owner picture", () => {
    expect(
      resolveRepoDisplayIcon({
        sourceUrl:
          "ai:UnforgettablePassword1024@source.archipelago-foundation.org/lfg2025/archy",
        ownerPubkey: OWNER,
        repoName: "archy",
        ownerPicture: "https://cdn.example/owner.png",
        nativeEvenWithoutFiles: true,
      })
    ).toBe(nativeRepoAvatarUrl(OWNER, "archy"));
  });
});

describe("logoUrlFromNip34Tags", () => {
  it("reads the NIP-34 image tag", () => {
    expect(
      logoUrlFromNip34Tags([
        ["d", "archy"],
        ["image", "https://example.com/archy.png"],
      ])
    ).toBe("https://example.com/archy.png");
    expect(logoUrlFromNip34Tags([["web", "https://example.com"]])).toBeNull();
  });
});
