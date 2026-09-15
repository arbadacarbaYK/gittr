import { describe, expect, it } from "vitest";

import { shouldScanDependencySourcePath } from "./dependency-scan-path";

describe("shouldScanDependencySourcePath", () => {
  it("scans real app source", () => {
    expect(
      shouldScanDependencySourcePath("ui/src/lib/discussions/storage.ts")
    ).toBe(true);
  });

  it("skips unit tests and vendor trees", () => {
    expect(
      shouldScanDependencySourcePath("ui/src/lib/discussions/storage.test.ts")
    ).toBe(false);
    expect(shouldScanDependencySourcePath("ui/src/foo.spec.tsx")).toBe(false);
    expect(
      shouldScanDependencySourcePath("ui/src/lib/__tests__/parser.ts")
    ).toBe(false);
    expect(
      shouldScanDependencySourcePath("ui/node_modules/react/index.js")
    ).toBe(false);
  });
});
