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

  it("keeps RemoteSigner dial warnings and still hides generic websocket noise", () => {
    const warns: unknown[][] = [];
    const errors: unknown[][] = [];
    const fake = {
      warn: (...args: unknown[]) => {
        warns.push(args);
      },
      error: (...args: unknown[]) => {
        errors.push(args);
      },
      log: () => {},
    };
    new Function("console", gittrConsoleBootScript())(fake);
    fake.warn(
      "[RemoteSigner] openDirectRelay first pass failed for wss://relay.gittr.space: boom"
    );
    fake.error("WebSocket connection to 'wss://relay.gittr.space/' failed");
    expect(warns).toHaveLength(1);
    expect(String(warns[0][0])).toContain("[RemoteSigner]");
    expect(errors).toHaveLength(0);
  });
});
