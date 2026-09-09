import { describe, expect, it } from "vitest";

import { parseGitNameStatus, sanitizeNostrPrRef } from "./commit-range-diff";

describe("parseGitNameStatus", () => {
  it("maps added modified deleted and rename", () => {
    const parsed = parseGitNameStatus(
      [
        "A\tserver.js",
        "M\tpackage.json",
        "D\told.txt",
        "R100\ta.js\tb.js",
      ].join("\n")
    );
    expect(parsed).toEqual([
      { path: "server.js", status: "added" },
      { path: "package.json", status: "modified" },
      { path: "old.txt", status: "deleted" },
      { path: "b.js", status: "modified" },
    ]);
  });
});

describe("sanitizeNostrPrRef", () => {
  it("only allows refs/nostr/<64 hex>", () => {
    expect(
      sanitizeNostrPrRef(
        "refs/nostr/9f1730445f0b3760fdcf06b2422c6ba39355f3ba13dc78251d9180412bf25a93"
      )
    ).toBe(
      "refs/nostr/9f1730445f0b3760fdcf06b2422c6ba39355f3ba13dc78251d9180412bf25a93"
    );
    expect(sanitizeNostrPrRef("refs/heads/main")).toBe(null);
    expect(sanitizeNostrPrRef("refs/nostr/../etc/passwd")).toBe(null);
  });
});
