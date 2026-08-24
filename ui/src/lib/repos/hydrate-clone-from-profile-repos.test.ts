import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchRepoCloneHintsFromProfile } from "./hydrate-clone-from-profile-repos";

describe("fetchRepoCloneHintsFromProfile", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
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
