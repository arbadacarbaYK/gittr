import { describe, expect, it } from "vitest";

import { eventBelongsToRepo } from "./event-belongs-to-repo";

describe("eventBelongsToRepo", () => {
  const owner =
    "b3c95ce33dfa84326611e8b7a9c10b78df28754c38b106a4bc0196b9be5f4e4a";
  const entity =
    "npub1k0y4eceal2zryes3azm6nsgt0r0jsa2v8zcsdf9uqxttn0jlfe9q04c9h8";

  it("matches NIP-34 a-tags even when a relay hint is present", () => {
    expect(
      eventBelongsToRepo(
        {
          tags: [["a", `30617:${owner}:wyrd`, "wss://grasp.t5.st"]],
        },
        entity,
        "wyrd",
        owner
      )
    ).toBe(true);
  });

  it("rejects a different repo identifier", () => {
    expect(
      eventBelongsToRepo(
        { tags: [["a", `30617:${owner}:other`]] },
        entity,
        "wyrd",
        owner
      )
    ).toBe(false);
  });
});
