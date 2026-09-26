import { beforeEach, describe, expect, it, vi } from "vitest";

const headerStore = new Map<string, string>();

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (key: string) => headerStore.get(key.toLowerCase()) ?? null,
    has: (key: string) => headerStore.has(key.toLowerCase()),
  }),
}));

describe("shouldUseFastDocumentMetadata", () => {
  beforeEach(() => {
    headerStore.clear();
  });

  it("is fast for a normal browser document", async () => {
    headerStore.set(
      "user-agent",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0"
    );
    const { shouldUseFastDocumentMetadata } = await import(
      "./is-rsc-client-navigation"
    );
    expect(await shouldUseFastDocumentMetadata()).toBe(true);
  });

  it("waits for a link-preview crawler", async () => {
    headerStore.set("user-agent", "Twitterbot/1.0");
    const { shouldUseFastDocumentMetadata } = await import(
      "./is-rsc-client-navigation"
    );
    expect(await shouldUseFastDocumentMetadata()).toBe(false);
  });
});

describe("isRscClientNavigation", () => {
  beforeEach(() => {
    headerStore.clear();
  });

  it("is false for full document loads (no Flight headers)", async () => {
    const { isRscClientNavigation } = await import(
      "./is-rsc-client-navigation"
    );
    expect(await isRscClientNavigation()).toBe(false);
  });

  it("is true when RSC: 1 is set", async () => {
    headerStore.set("rsc", "1");
    const { isRscClientNavigation } = await import(
      "./is-rsc-client-navigation"
    );
    expect(await isRscClientNavigation()).toBe(true);
  });

  it("is true when next-router-state-tree is present", async () => {
    headerStore.set("next-router-state-tree", "[]");
    const { isRscClientNavigation } = await import(
      "./is-rsc-client-navigation"
    );
    expect(await isRscClientNavigation()).toBe(true);
  });

  it("is true for Next Flight Accept / Next-Url", async () => {
    headerStore.set("accept", "text/x-component");
    const { isRscClientNavigation } = await import(
      "./is-rsc-client-navigation"
    );
    expect(await isRscClientNavigation()).toBe(true);
    headerStore.clear();
    headerStore.set("next-url", "/explore");
    expect(await isRscClientNavigation()).toBe(true);
  });
});
