import { beforeEach, describe, expect, it, vi } from "vitest";

import { broadcastRepoAnnouncementEventId } from "../nostr/repo-stars";

import { fetchRepoCloneHintsFromProfile } from "./hydrate-clone-from-profile-repos";
import { persistRepoAnnouncementMeta } from "./repo-github-hub";
import { resolveLiveRepoAnnouncement } from "./resolve-live-repo-announcement";

vi.mock("../nostr/repo-stars", () => ({
  broadcastRepoAnnouncementEventId: vi.fn(),
}));

vi.mock("./repo-github-hub", () => ({
  persistRepoAnnouncementMeta: vi.fn(),
}));

vi.mock("./hydrate-clone-from-profile-repos", () => ({
  fetchRepoCloneHintsFromProfile: vi.fn(),
}));

const OWNER =
  "b3c95ce33dfa84326611e8b7a9c10b78df28754c38b106a4bc0196b9be5f4e4a";
const EVENT_ID = "a".repeat(64);

describe("resolveLiveRepoAnnouncement", () => {
  beforeEach(() => {
    vi.mocked(fetchRepoCloneHintsFromProfile).mockReset();
    vi.mocked(persistRepoAnnouncementMeta).mockReset();
    vi.mocked(broadcastRepoAnnouncementEventId).mockReset();
  });

  it("broadcasts and persists the 30617 id from profile-repos", async () => {
    vi.mocked(fetchRepoCloneHintsFromProfile).mockResolvedValue({
      clone: [
        "https://grasp.t5.st/npub1k0y4eceal2zryes3azm6nsgt0r0jsa2v8zcsdf9uqxttn0jlfe9q04c9h8/ambersocket.git",
      ],
      lastNostrEventId: EVENT_ID,
      publicRead: true,
    });

    const hints = await resolveLiveRepoAnnouncement({
      ownerPubkey: OWNER,
      repoName: "ambersocket",
      entity: "npub1k0y4eceal2zryes3azm6nsgt0r0jsa2v8zcsdf9uqxttn0jlfe9q04c9h8",
    });

    expect(hints?.lastNostrEventId).toBe(EVENT_ID);
    expect(broadcastRepoAnnouncementEventId).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: EVENT_ID, repo: "ambersocket" })
    );
    expect(persistRepoAnnouncementMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        lastNostrEventId: EVENT_ID,
        publicRead: true,
      })
    );
  });

  it("returns null without persist when profile-repos has no matching repo", async () => {
    vi.mocked(fetchRepoCloneHintsFromProfile).mockResolvedValue(null);
    expect(
      await resolveLiveRepoAnnouncement({
        ownerPubkey: OWNER,
        repoName: "missing",
        entity: "npub1abc",
      })
    ).toBeNull();
    expect(persistRepoAnnouncementMeta).not.toHaveBeenCalled();
  });
});
