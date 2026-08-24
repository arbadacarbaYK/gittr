import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearProfileRepoHintsCache,
  fetchRepoCloneHintsFromProfile,
} from "./hydrate-clone-from-profile-repos";

describe("fetchRepoCloneHintsFromProfile", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    clearProfileRepoHintsCache();
  });

  afterEach(() => {
    clearProfileRepoHintsCache();
    vi.unstubAllGlobals();
  });

  it("returns clone and sourceUrl for a matching repo row", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        repos: [
          {
            repo: "LiE",
            sourceUrl: "https://friendly-machines.com/git/LiE",
            clone: ["https://friendly-machines.com/git/LiE.git"],
            lastNostrEventId: "abc",
          },
        ],
      }),
    });

    const hints = await fetchRepoCloneHintsFromProfile(
      "5e13bab588e1f3618bcc76499a7db1704aa0bb44a3cee46867f68a35a0667d7d",
      "LiE"
    );
    expect(hints?.clone).toEqual(["https://friendly-machines.com/git/LiE.git"]);
    expect(hints?.sourceUrl).toContain("friendly-machines.com");
    expect(hints?.lastNostrEventId).toBeUndefined();
  });

  it("returns lastNostrEventId only when it is a 64-char hex event id", async () => {
    const eventId = "a".repeat(64);
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        repos: [
          {
            repo: "ambersocket",
            clone: [
              "https://grasp.t5.st/npub1k0y4eceal2zryes3azm6nsgt0r0jsa2v8zcsdf9uqxttn0jlfe9q04c9h8/ambersocket.git",
            ],
            lastNostrEventId: eventId,
          },
        ],
      }),
    });
    const hints = await fetchRepoCloneHintsFromProfile(
      "b3c95ce33dfa84326611e8b7a9c10b78df28754c38b106a4bc0196b9be5f4e4a",
      "ambersocket"
    );
    expect(hints?.lastNostrEventId).toBe(eventId);
  });

  it("returns publicRead when the profile-repos row includes it", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        repos: [
          {
            repo: "secret",
            clone: ["https://git.gittr.space/npub1abc/secret.git"],
            publicRead: false,
          },
        ],
      }),
    });
    const hints = await fetchRepoCloneHintsFromProfile(
      "a".repeat(64),
      "secret"
    );
    expect(hints?.publicRead).toBe(false);
  });

  it("reuses a short-lived cache so Star/Settings/Code share one lookup", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        repos: [{ repo: "LiE", clone: ["https://example.com/LiE.git"] }],
      }),
    });
    const pk =
      "5e13bab588e1f3618bcc76499a7db1704aa0bb44a3cee46867f68a35a0667d7d";
    await fetchRepoCloneHintsFromProfile(pk, "LiE");
    await fetchRepoCloneHintsFromProfile(pk, "LiE");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid pubkey", async () => {
    expect(await fetchRepoCloneHintsFromProfile("bad", "LiE")).toBeNull();
  });

  it("accepts npub and decodes to hex for the profile-repos query", async () => {
    const { nip19 } = await import("nostr-tools");
    const hex =
      "5e13bab588e1f3618bcc76499a7db1704aa0bb44a3cee46867f68a35a0667d7d";
    const npub = nip19.npubEncode(hex);
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ repos: [{ repo: "LiE", clone: [] }] }),
    });
    await fetchRepoCloneHintsFromProfile(npub, "LiE");
    expect(fetch).toHaveBeenCalledWith(
      `/api/nostr/profile-repos?ownerPubkey=${encodeURIComponent(hex)}`,
      { cache: "no-store" }
    );
  });
});
