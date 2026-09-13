import { describe, expect, it } from "vitest";

import { GITTR_OWNER_PUBKEY_HEX } from "../gittr-repo-links";

import { resolveAnnounceAppId, suggestAppIdFromRepo } from "./forge-releases";
import {
  GITTR_ANDROID_APP_ID,
  GITTR_LEGACY_SUGGESTED_APP_ID,
  GITTR_OFFICIAL_APP_TOPICS,
  appIdsToMatchForRepoDelete,
  isOfficialGittrAndroidRepo,
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
    ).toEqual([GITTR_ANDROID_APP_ID, GITTR_LEGACY_SUGGESTED_APP_ID]);
  });
});
