import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearWoTDistanceCache,
  fetchWoTDistanceFromOracle,
  resetWoTOracleThrottleForTests,
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
