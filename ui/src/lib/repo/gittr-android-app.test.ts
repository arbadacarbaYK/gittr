import { describe, expect, it } from "vitest";

import { GITTR_OWNER_PUBKEY_HEX } from "../gittr-repo-links";

import { resolveAnnounceAppId, suggestAppIdFromRepo } from "./forge-releases";
import {
  GITTR_ANDROID_APP_ID,
  GITTR_ANDROID_ICON_URL,
  GITTR_ANDROID_SUMMARY,
  GITTR_LEGACY_SUGGESTED_APP_ID,
  GITTR_OFFICIAL_APP_TOPICS,
  appIdsToMatchForRepoDelete,
  iconUrlForNip82Announce,
  isOfficialGittrAndroidRepo,
  summaryForNip82Announce,
  topicsForNip82Announce,
} from "./gittr-android-app";

describe("official gittr Android announce", () => {
  it("is only the operator gittr repo", () => {
    expect(
      isOfficialGittrAndroidRepo({
        repo: "gittr",
        ownerPubkeyHex: GITTR_OWNER_PUBKEY_HEX,
      })
    ).toBe(true);
    expect(
      isOfficialGittrAndroidRepo({
        repo: "gittr.git",
        ownerPubkeyHex: GITTR_OWNER_PUBKEY_HEX.toUpperCase(),
      })
    ).toBe(true);
    expect(
      isOfficialGittrAndroidRepo({
        repo: "gittr",
        ownerPubkeyHex: "aa".repeat(32),
      })
    ).toBe(false);
    expect(
      isOfficialGittrAndroidRepo({
        repo: "other",
        ownerPubkeyHex: GITTR_OWNER_PUBKEY_HEX,
      })
    ).toBe(false);
  });

  it("suggests space.gittr.app for official gittr, slug id otherwise", () => {
    expect(suggestAppIdFromRepo("gittr", GITTR_OWNER_PUBKEY_HEX)).toBe(
      GITTR_ANDROID_APP_ID
    );
    expect(suggestAppIdFromRepo("gittr")).toBe(GITTR_LEGACY_SUGGESTED_APP_ID);
    expect(suggestAppIdFromRepo("demo")).toBe("space.gittr.demo");
    expect(suggestAppIdFromRepo("gittr", "aa".repeat(32))).toBe(
      GITTR_LEGACY_SUGGESTED_APP_ID
    );
  });

  it("ignores stored display names like GITTR for the official package id", () => {
    expect(
      resolveAnnounceAppId({
        existingAppId: "GITTR",
        repo: "gittr",
        ownerPubkeyHex: GITTR_OWNER_PUBKEY_HEX,
      })
    ).toBe(GITTR_ANDROID_APP_ID);
    expect(
      resolveAnnounceAppId({
        existingAppId: GITTR_LEGACY_SUGGESTED_APP_ID,
        repo: "gittr",
        ownerPubkeyHex: GITTR_OWNER_PUBKEY_HEX,
      })
    ).toBe(GITTR_LEGACY_SUGGESTED_APP_ID);
  });

  it("uses the bird logo for official gittr and a public repo logo for others", () => {
    expect(
      iconUrlForNip82Announce({
        repo: "gittr",
        ownerPubkeyHex: GITTR_OWNER_PUBKEY_HEX,
        repoLogoUrl: "https://cdn.example.com/other.png",
      })
    ).toBe(GITTR_ANDROID_ICON_URL);
    expect(
      iconUrlForNip82Announce({
        repo: "demo",
        ownerPubkeyHex: "aa".repeat(32),
        repoLogoUrl: "https://cdn.example.com/other.png",
      })
    ).toBe("https://cdn.example.com/other.png");
    expect(
      iconUrlForNip82Announce({
        repo: "demo",
        ownerPubkeyHex: "aa".repeat(32),
        repoLogoUrl: "/logo.svg",
        sourceUrl: "https://github.com/acme/demo",
        defaultBranch: "main",
      })
    ).toBe("https://raw.githubusercontent.com/acme/demo/main/logo.svg");
    expect(
      iconUrlForNip82Announce({
        repo: "demo",
        ownerPubkeyHex: "aa".repeat(32),
        files: [{ path: "logo.png" }],
        sourceUrl: "https://github.com/acme/demo",
      })
    ).toBe("https://raw.githubusercontent.com/acme/demo/main/logo.png");
    expect(
      iconUrlForNip82Announce({
        repo: "demo",
        ownerPubkeyHex: "aa".repeat(32),
        repoLogoUrl: "/logo.svg",
      })
    ).toBeUndefined();
    expect(
      iconUrlForNip82Announce({
        repo: "demo",
        ownerPubkeyHex: "aa".repeat(32),
        repoLogoUrl:
          "https://gittr.space/api/og/repo-image?ownerPubkey=aa&repo=demo",
      })
    ).toBeUndefined();
  });

  it("uses the product about for official gittr unless a custom description exists", () => {
    expect(
      summaryForNip82Announce({
        repo: "gittr",
        ownerPubkeyHex: GITTR_OWNER_PUBKEY_HEX,
        repoSummary:
          "Host your Git repositories on Nostr for enhanced discoverability. Make your code discoverable across the Nostr network and decentralize your code",
      })
    ).toBe(GITTR_ANDROID_SUMMARY);
    expect(
      summaryForNip82Announce({
        repo: "gittr",
        ownerPubkeyHex: GITTR_OWNER_PUBKEY_HEX,
        repoSummary: "",
      })
    ).toBe(GITTR_ANDROID_SUMMARY);
    expect(
      summaryForNip82Announce({
        repo: "demo",
        ownerPubkeyHex: "aa".repeat(32),
        repoSummary: "My app",
      })
    ).toBe("My app");
  });

  it("copies repo topics and fills official zapstore.yaml tags", () => {
    expect(
      topicsForNip82Announce({
        repoTopics: ["Android", "git"],
        repo: "demo",
        ownerPubkeyHex: "aa".repeat(32),
      })
    ).toEqual(["Android", "git"]);
    expect(
      topicsForNip82Announce({
        repoTopics: ["git"],
        repo: "gittr",
        ownerPubkeyHex: GITTR_OWNER_PUBKEY_HEX,
      })
    ).toEqual(["git", ...GITTR_OFFICIAL_APP_TOPICS.filter((t) => t !== "git")]);
  });

  it("matches both current and legacy app ids on delete", () => {
    expect(
      appIdsToMatchForRepoDelete({
        repo: "gittr",
        ownerPubkeyHex: GITTR_OWNER_PUBKEY_HEX,
        suggestedAppId: GITTR_ANDROID_APP_ID,
      })
    ).toEqual([GITTR_ANDROID_APP_ID, GITTR_LEGACY_SUGGESTED_APP_ID, "GITTR"]);
  });
});
