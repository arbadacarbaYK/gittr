import { describe, expect, it } from "vitest";

import {
  discussionAddressTag,
  discussionNostrFilters,
  discussionRepoTagValues,
} from "./repo-scope";

const NPUB = "npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc";
const HEX = "9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c";

describe("discussion repo scope", () => {
  it("includes npub and hex #repo values so URL entity changes still find the thread", () => {
    const values = discussionRepoTagValues(NPUB, "gittr", HEX);
    expect(values).toContain(`${NPUB}/gittr`);
    expect(values).toContain(`${HEX}/gittr`);
  });

  it("subscribes by #repo aliases and NIP-34 #a", () => {
    const filters = discussionNostrFilters(NPUB, "gittr", HEX);
    expect(filters.some((f) => Array.isArray(f["#repo"]))).toBe(true);
    expect(
      filters.some((f) => f["#a"]?.[0] === discussionAddressTag(HEX, "gittr"))
    ).toBe(true);
  });
});
