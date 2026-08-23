import { beforeEach, describe, expect, it, vi } from "vitest";

const headerStore = new Map<string, string>();

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (key: string) => headerStore.get(key.toLowerCase()) ?? null,
    has: (key: string) => headerStore.has(key.toLowerCase()),
  }),
}));

describe("isRscClientNavigation", () => {
  beforeEach(() => {
    headerStore.clear();
  });

  it("is false for full document loads (no Flight headers)", async () => {
    const { isRscClientNavigation } = await import("./is-rsc-client-navigation");
    expect(await isRscClientNavigation()).toBe(false);
  });

  it("is true when RSC: 1 is set", async () => {
    headerStore.set("rsc", "1");
    const { isRscClientNavigation } = await import("./is-rsc-client-navigation");
    expect(await isRscClientNavigation()).toBe(true);
  });

  it("is true when next-router-state-tree is present", async () => {
    headerStore.set("next-router-state-tree", "[]");
    const { isRscClientNavigation } = await import("./is-rsc-client-navigation");
    expect(await isRscClientNavigation()).toBe(true);
  });
});
