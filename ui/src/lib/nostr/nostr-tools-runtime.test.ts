import { nip19 } from "nostr-tools";
import { describe, expect, it } from "vitest";

describe("nostr-tools runtime (not a types-only stub)", () => {
  it("exposes nip19.decode as a function", () => {
    expect(typeof nip19.decode).toBe("function");
    const npub =
      "npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc";
    const decoded = nip19.decode(npub);
    expect(decoded.type).toBe("npub");
    expect(typeof decoded.data).toBe("string");
    expect((decoded.data as string).length).toBe(64);
  });
});
