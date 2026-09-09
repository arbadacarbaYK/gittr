import { describe, expect, it } from "vitest";

import { parseNostrPushedRepoLines } from "./nostr-pushed-repos";

describe("parseNostrPushedRepoLines", () => {
  it("keeps unique npub/repo lines and skips comments", () => {
    const raw = `# comment
npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr
npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr
not-a-path
npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gitnostr
`;
    expect(parseNostrPushedRepoLines(raw)).toEqual([
      "npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr",
      "npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gitnostr",
    ]);
  });
});
