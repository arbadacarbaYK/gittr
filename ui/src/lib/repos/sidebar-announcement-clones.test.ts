import { describe, expect, it } from "vitest";

import {
  pickGitServerFromAnnouncementClones,
  sidebarClonesFromAnnouncement,
} from "./sidebar-announcement-clones";

const npub = "npub1k0y4eceal2zryes3azm6nsgt0r0jsa2v8zcsdf9uqxttn0jlfe9q04c9h8";

describe("sidebarClonesFromAnnouncement", () => {
  it("uses event clone tags and ignores inferred gittr", () => {
    const announced = [
      `https://grasp.t5.st/${npub}/amber-up.git`,
      `https://gitnostr.com/${npub}/amber-up.git`,
      `https://relay.ngit.dev/${npub}/amber-up.git`,
    ];
    const out = sidebarClonesFromAnnouncement({
      announcementClones: announced,
      mergedClones: [
        `https://git.gittr.space/${npub}/amber-up.git`,
        ...announced,
      ],
    });
    expect(out).toEqual(announced);
    expect(out.some((u) => u.includes("git.gittr.space"))).toBe(false);
  });

  it("does not invent gittr when the event has not arrived", () => {
    const out = sidebarClonesFromAnnouncement({
      announcementClones: [],
      mergedClones: [
        `https://git.gittr.space/${npub}/amber-up.git`,
        `https://relay.ngit.dev/${npub}/amber-up.git`,
      ],
    });
    expect(out).toEqual([`https://relay.ngit.dev/${npub}/amber-up.git`]);
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
