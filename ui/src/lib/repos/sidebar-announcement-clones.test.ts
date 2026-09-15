import { describe, expect, it } from "vitest";

import {
  mergeAnnouncementTagClones,
  pickGitServerFromAnnouncementClones,
  sidebarClonesFromAnnouncement,
  sidebarEventCloneUrls,
} from "./sidebar-announcement-clones";

const npub = "npub1k0y4eceal2zryes3azm6nsgt0r0jsa2v8zcsdf9uqxttn0jlfe9q04c9h8";

describe("sidebarClonesFromAnnouncement", () => {
  it("lists every event clone including git.gittr.space", () => {
    const announced = [
      `https://git.gittr.space/${npub}/gittr.git`,
      `https://git.shakespeare.diy/${npub}/gittr.git`,
      `https://gitnostr.com/${npub}/gittr.git`,
      `https://relay.ngit.dev/${npub}/gittr.git`,
      `https://ngit.danconwaydev.com/${npub}/gittr.git`,
    ];
    const out = sidebarClonesFromAnnouncement({
      announcementClones: announced,
      mergedClones: announced,
      forgeSourceUrl: "https://github.com/arbadacarbaYK/gittr",
    });
    for (const u of announced) {
      expect(out).toContain(u);
    }
    expect(out.some((u) => u.includes("github.com"))).toBe(true);
  });

  it("does not invent gittr when the event has not arrived", () => {
    const out = sidebarClonesFromAnnouncement({
      announcementClones: [],
      mergedClones: [`https://relay.ngit.dev/${npub}/amber-up.git`],
    });
    expect(out).toEqual([`https://relay.ngit.dev/${npub}/amber-up.git`]);
    expect(out.some((u) => u.includes("git.gittr.space"))).toBe(false);
  });

  it("keeps git.gittr.space from a persisted event when React announcement is thin", () => {
    const announced = [`https://relay.ngit.dev/${npub}/gittr.git`];
    const persisted = [
      `https://git.gittr.space/${npub}/gittr.git`,
      `https://git.shakespeare.diy/${npub}/gittr.git`,
      `https://gitnostr.com/${npub}/gittr.git`,
      ...announced,
    ];
    const out = sidebarClonesFromAnnouncement({
      announcementClones: announced,
      mergedClones: persisted,
      forgeSourceUrl: "https://github.com/arbadacarbaYK/gittr",
    });
    expect(out.some((u) => u.includes("git.gittr.space"))).toBe(true);
    expect(out.some((u) => u.includes("git.shakespeare.diy"))).toBe(true);
    expect(out.some((u) => u.includes("gitnostr.com"))).toBe(true);
    expect(out.some((u) => u.includes("github.com"))).toBe(true);
  });

  it("unions a GitHub source onto announcement GRASP clones", () => {
    const announced = [
      `https://relay.ngit.dev/${npub}/andronixorigin.git`,
      `https://git.gittr.space/${npub}/andronixorigin.git`,
    ];
    const out = sidebarClonesFromAnnouncement({
      announcementClones: announced,
      mergedClones: announced,
      forgeSourceUrl: "https://github.com/AndronixApp/AndronixOrigin",
    });
    expect(out).toEqual([
      ...announced,
      "https://github.com/AndronixApp/AndronixOrigin",
    ]);
  });
});

describe("mergeAnnouncementTagClones", () => {
  it("keeps git.gittr.space from an older event when the latest note is thin", () => {
    const gittr = `https://git.gittr.space/${npub}/gittr.git`;
    const ngit = `https://relay.ngit.dev/${npub}/gittr.git`;
    expect(mergeAnnouncementTagClones([gittr, ngit], [ngit])).toEqual(
      expect.arrayContaining([gittr, ngit])
    );
  });

  it("drops inferred uid.ovh that was never on the 30617 clone tags", () => {
    const gittr = `https://git.gittr.space/${npub}/gittr.git`;
    const ngit = `https://relay.ngit.dev/${npub}/gittr.git`;
    const inferred = `https://git-01.uid.ovh/${npub}/gittr.git`;
    const out = mergeAnnouncementTagClones(
      [gittr, ngit, inferred],
      [gittr, ngit]
    );
    expect(out).toEqual(expect.arrayContaining([gittr, ngit]));
    expect(out.some((u) => u.includes("uid.ovh"))).toBe(false);
  });

  it("does not shrink a full event list when fetch clone is GitHub-only", () => {
    const announced = [
      `https://git.gittr.space/${npub}/gittr.git`,
      `https://git.shakespeare.diy/${npub}/gittr.git`,
      `https://gitnostr.com/${npub}/gittr.git`,
      `https://relay.ngit.dev/${npub}/gittr.git`,
      `https://relay.gittr.space/${npub}/gittr.git`,
      `https://ngit.danconwaydev.com/${npub}/gittr.git`,
    ];
    const out = sidebarClonesFromAnnouncement({
      announcementClones: announced,
      mergedClones: announced,
      forgeSourceUrl: "https://github.com/arbadacarbaYK/gittr",
    });
    for (const u of announced) {
      expect(out).toContain(u);
    }
    expect(out.filter((u) => u.includes("github.com"))).toHaveLength(1);
  });

  it("keeps git.gittr.space from a persisted event when the live snapshot is thin", () => {
    const gittr = `https://git.gittr.space/${npub}/gittr.git`;
    const ngit = `https://relay.ngit.dev/${npub}/gittr.git`;
    const out = sidebarEventCloneUrls({
      announcementClones: [ngit],
      storedAnnounced: [gittr, ngit],
    });
    expect(out).toEqual(expect.arrayContaining([gittr, ngit]));
  });

  it("keeps an excluded GRASP host when the event actually listed it", () => {
    const uid = `https://git-01.uid.ovh/${npub}/gittr.git`;
    const ngit = `https://relay.ngit.dev/${npub}/gittr.git`;
    expect(mergeAnnouncementTagClones([ngit], [ngit, uid])).toEqual(
      expect.arrayContaining([ngit, uid])
    );
  });
});

describe("pickGitServerFromAnnouncementClones", () => {
  it("picks the first HTTPS clone when gittr is not on the event", () => {
    const pick = pickGitServerFromAnnouncementClones([
      `https://grasp.t5.st/${npub}/amber-up.git`,
      `https://relay.ngit.dev/${npub}/amber-up.git`,
    ]);
    expect(pick?.href).toContain("grasp.t5.st");
    expect(pick?.kind).toBe("clone");
  });

  it("prefers git.gittr.space when the nostr-only event listed it", () => {
    const pick = pickGitServerFromAnnouncementClones([
      `https://relay.ngit.dev/${npub}/officecli.git`,
      `https://git.gittr.space/${npub}/officecli.git`,
    ]);
    expect(pick?.href).toContain("git.gittr.space");
  });

  it("does not favor gittr when the repo already has an external forge source", () => {
    const pick = pickGitServerFromAnnouncementClones(
      [
        `https://relay.ngit.dev/${npub}/officecli.git`,
        `https://git.gittr.space/${npub}/officecli.git`,
      ],
      { hasExternalForgeSource: true }
    );
    expect(pick?.href).toContain("relay.ngit.dev");
  });
});
