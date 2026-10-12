import { describe, expect, it } from "vitest";

import { gittrConsoleBootScript } from "./early-console-script";
import { gittrThemeBootScript } from "./theme-preference";

describe("early page scripts", () => {
  it("theme boot and console filter each parse on their own", () => {
    expect(() => new Function(gittrThemeBootScript())).not.toThrow();
    expect(() => new Function(gittrConsoleBootScript())).not.toThrow();
  });

  it("does not leave a try without catch in the console script", () => {
    const src = gittrConsoleBootScript();
    expect(src.includes("try")).toBe(false);
    expect(src).toContain("reconnecting after");
  });
});
