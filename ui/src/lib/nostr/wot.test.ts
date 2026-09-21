import { nip19 } from "nostr-tools";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearWoTDistanceCache,
  fetchWoTDistanceFromExtension,
  fetchWoTDistanceFromOracle,
  resetWoTOracleThrottleForTests,
  resolveWoTDistance,
  wotResultLabel,
  wotResultTitle,
} from "./wot";

const VIEWER = "a".repeat(64);
const TARGET_A = "b".repeat(64);
const TARGET_B = "c".repeat(64);
const TARGET_C = "d".repeat(64);

describe("fetchWoTDistanceFromOracle throttle", () => {
  beforeEach(() => {
    resetWoTOracleThrottleForTests();
    clearWoTDistanceCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad gateway", { status: 502 }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetWoTOracleThrottleForTests();
    clearWoTDistanceCache();
  });

  it("coalesces in-flight requests for the same pair", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () => resolve(new Response("bad gateway", { status: 502 })),
            20
          );
        })
    );

    const [a, b] = await Promise.all([
      fetchWoTDistanceFromOracle(VIEWER, TARGET_A),
      fetchWoTDistanceFromOracle(VIEWER, TARGET_A),
    ]);

    expect(a?.source).toBe("unavailable");
    expect(b?.source).toBe("unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("trips a circuit after oracle failure so later pairs skip HTTP", async () => {
    const fetchMock = vi.mocked(fetch);

    const first = await fetchWoTDistanceFromOracle(VIEWER, TARGET_A);
    expect(first?.source).toBe("unavailable");
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    const afterFirst = fetchMock.mock.calls.length;

    const second = await fetchWoTDistanceFromOracle(VIEWER, TARGET_B);
    expect(second?.source).toBe("unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(afterFirst);
  });

  it("limits concurrent oracle HTTP when many pairs start together", async () => {
    let concurrent = 0;
    let peak = 0;
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await new Promise((r) => setTimeout(r, 30));
      concurrent -= 1;
      return new Response("bad gateway", { status: 502 });
    });

    await Promise.all([
      fetchWoTDistanceFromOracle(VIEWER, TARGET_A),
      fetchWoTDistanceFromOracle(VIEWER, TARGET_B),
      fetchWoTDistanceFromOracle(VIEWER, TARGET_C),
    ]);

    expect(peak).toBeLessThanOrEqual(2);
    // First failures open the circuit; remaining queued calls skip HTTP.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe("extension integration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearWoTDistanceCache();
    resetWoTOracleThrottleForTests();
  });

  function install(hops: number | null = 2, account = VIEWER) {
    const getPublicKey = vi.fn(async () => account);
    const getDistance = vi.fn(async () => hops);
    vi.stubGlobal("window", { nostr: { getPublicKey, wot: { getDistance } } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"hops":3}'))
    );
    return { getPublicKey, getDistance };
  }

  it("uses the target-only API for the matching identity", async () => {
    const { getDistance } = install();
    expect(
      await resolveWoTDistance({ viewerHex: VIEWER, targetHex: TARGET_A })
    ).toEqual({ hops: 2, source: "extension" });
    expect(getDistance).toHaveBeenCalledWith(nip19.npubEncode(TARGET_A));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never queries another identity's graph", async () => {
    const { getDistance } = install(2, TARGET_B);
    expect(
      (await resolveWoTDistance({ viewerHex: VIEWER, targetHex: TARGET_A }))
        ?.source
    ).toBe("oracle");
    expect(getDistance).not.toHaveBeenCalled();
  });

  it("discards an account switch during the query", async () => {
    const { getPublicKey } = install();
    getPublicKey.mockResolvedValueOnce(VIEWER).mockResolvedValueOnce(TARGET_B);
    expect(await fetchWoTDistanceFromExtension(VIEWER, TARGET_A)).toBeNull();
  });

  it("discards a provider replacement during the query", async () => {
    const { getDistance } = install();
    getDistance.mockImplementation(async () => {
      vi.stubGlobal("window", { nostr: {} });
      return 2;
    });
    expect(await fetchWoTDistanceFromExtension(VIEWER, TARGET_A)).toBeNull();
  });

  it("does not override an extension null with a public oracle result", async () => {
    install(null);
    const result = await resolveWoTDistance({
      viewerHex: VIEWER,
      targetHex: TARGET_A,
    });
    expect(result).toEqual({ hops: null, source: "extension" });
    expect(wotResultLabel(result)).toBe("Distance unknown");
    expect(wotResultTitle(result)).toContain("mute settings");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("falls back on permission rejection", async () => {
    const { getPublicKey } = install();
    getPublicKey.mockRejectedValue(new Error("Permission denied"));
    expect(
      (await resolveWoTDistance({ viewerHex: VIEWER, targetHex: TARGET_A }))
        ?.source
    ).toBe("oracle");
  });

  it("falls back when the optional namespace is disabled", async () => {
    install();
    vi.stubGlobal("window", { nostr: {} });
    expect(
      (await resolveWoTDistance({ viewerHex: VIEWER, targetHex: TARGET_A }))
        ?.source
    ).toBe("oracle");
  });

  it.each([0, -1, 1.5, Infinity, NaN])(
    "rejects invalid non-self distance %s",
    async (hops) => {
      install(hops);
      expect(await fetchWoTDistanceFromExtension(VIEWER, TARGET_A)).toBeNull();
    }
  );

  it("preserves direct-follow precedence without querying providers", async () => {
    const { getDistance, getPublicKey } = install();
    expect(
      await resolveWoTDistance({
        viewerHex: VIEWER,
        targetHex: TARGET_A,
        follows: new Set([TARGET_A]),
      })
    ).toEqual({ hops: 1, source: "follows" });
    expect(getDistance).not.toHaveBeenCalled();
    expect(getPublicKey).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps oracle caches separate for different search depths", async () => {
    install();
    await Promise.all([
      fetchWoTDistanceFromOracle(VIEWER, TARGET_A, 2),
      fetchWoTDistanceFromOracle(VIEWER, TARGET_A, 4),
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
    await fetchWoTDistanceFromOracle(VIEWER, TARGET_A, 2);
    expect(fetch).toHaveBeenCalledTimes(2);
    clearWoTDistanceCache(VIEWER);
    await fetchWoTDistanceFromOracle(VIEWER, TARGET_A, 2);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("does not label absent evidence as outside", () => {
    expect(wotResultLabel(null)).toBe("Distance unknown");
  });
});
