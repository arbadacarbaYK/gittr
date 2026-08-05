import { describe, expect, it } from "vitest";

import {
  hasGraspPathPrefix,
  isGraspServer,
  parseGraspPathClone,
} from "./grasp-servers";

const LAANTUNGIR =
  "https://laantungir.net/grasp/npub1f9z5ks7sa50fg7nqwc7l0eh5yxf9vwmeu86wa90l3fd0tantd0tskzpjx8/minibits_wallet.git";

describe("GRASP /grasp/ path clones", () => {
  it("detects /grasp/ path as GRASP even on unknown hosts", () => {
    expect(hasGraspPathPrefix(LAANTUNGIR)).toBe(true);
    expect(isGraspServer(LAANTUNGIR)).toBe(true);
    expect(isGraspServer("wss://laantungir.net/grasp")).toBe(true);
    expect(isGraspServer("https://example.com/owner/repo.git")).toBe(false);
  });

  it("parses /grasp/npub/repo", () => {
    const parsed = parseGraspPathClone(LAANTUNGIR);
    expect(parsed?.host).toBe("laantungir.net");
    expect(parsed?.npub).toMatch(/^npub1f9z5/);
    expect(parsed?.repo).toBe("minibits_wallet");
  });
});
