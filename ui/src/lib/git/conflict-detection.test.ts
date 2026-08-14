import { describe, expect, it } from "vitest";
import { detectConflicts } from "./conflict-detection";

describe("detectConflicts", () => {
  it("does not conflict when tip still matches PR before", () => {
    const result = detectConflicts(
      [
        {
          path: "README.md",
          status: "modified",
          before: "# Lab kit\n",
          after: "# Lab kit\n\nowner edit\n",
        },
      ],
      { "README.md": "# Lab kit\n" },
      "main"
    );
    expect(result.hasConflicts).toBe(false);
  });

  it("flags edit-edit when tip diverged from PR before", () => {
    const result = detectConflicts(
      [
        {
          path: "README.md",
          status: "modified",
          before: "# Lab kit\n",
          after: "# Lab kit\n\npr edit\n",
        },
      ],
      { "README.md": "# Lab kit\n\nother tip edit\n" },
      "main"
    );
    expect(result.hasConflicts).toBe(true);
    expect(result.conflicts[0]?.type).toBe("edit-edit");
  });

  it("empty tip string vs non-empty before is treated as tip divergence (Nostr-only bug)", () => {
    // Historical bug: merge set baseFiles[path] = "" for repos without sourceUrl,
    // so every README PR looked conflicting. Prefer PR before as tip instead.
    const withEmptyTip = detectConflicts(
      [
        {
          path: "README.md",
          status: "modified",
          before: "# Lab kit\n",
          after: "# Lab kit\n\npr\n",
        },
      ],
      { "README.md": "" },
      "main"
    );
    expect(withEmptyTip.hasConflicts).toBe(true);

    const withBeforeAsTip = detectConflicts(
      [
        {
          path: "README.md",
          status: "modified",
          before: "# Lab kit\n",
          after: "# Lab kit\n\npr\n",
        },
      ],
      { "README.md": "# Lab kit\n" },
      "main"
    );
    expect(withBeforeAsTip.hasConflicts).toBe(false);
  });

  it("after aligning before to tip, Use PR version is mergeable", () => {
    const tip = "# Lab kit\n";
    const after = "# Lab kit\n\npr\n";
    // What handleConflictResolve does for resolution === "pr"
    const aligned = {
      path: "README.md",
      status: "modified" as const,
      before: tip,
      after,
    };
    const result = detectConflicts([aligned], { "README.md": tip }, "main");
    expect(result.hasConflicts).toBe(false);
  });
});
