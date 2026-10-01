import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/** Lowest x.y.z in a resolution string (`4.28.7` or `^4.28.7`). */
function resolutionFloor(raw: string): [number, number, number] {
  const m = String(raw)
    .trim()
    .match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) throw new Error(`unparsed resolution: ${raw}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function gte(
  actual: [number, number, number],
  floor: [number, number, number]
): boolean {
  for (let i = 0; i < 3; i++) {
    if (actual[i]! > floor[i]!) return true;
    if (actual[i]! < floor[i]!) return false;
  }
  return true;
}

describe("npm resolution floors (Dependencies tab / OSV)", () => {
  const uiRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
  const pkg = JSON.parse(
    readFileSync(join(uiRoot, "package.json"), "utf8")
  ) as {
    dependencies?: Record<string, string>;
    resolutions?: Record<string, string>;
  };
  const resolutions = pkg.resolutions || {};

  it("pins browserslist at the CVE-2026-73088 / CVE-2026-73089 floor", () => {
    expect(gte(resolutionFloor(resolutions.browserslist), [4, 28, 7])).toBe(
      true
    );
  });

  it("pins @xmldom/xmldom at the CVE-2026-83610 0.8.x floor", () => {
    expect(
      gte(resolutionFloor(resolutions["@xmldom/xmldom"]), [0, 8, 15])
    ).toBe(true);
  });

  it("pins js-yaml at the CVE-2026-84375 floor", () => {
    expect(gte(resolutionFloor(resolutions["js-yaml"]), [4, 3, 2])).toBe(true);

    const lock = readFileSync(join(uiRoot, "yarn.lock"), "utf8");
    const resolved = lock.match(
      /^js-yaml@[^:\n]+:\n  version "(\d+\.\d+\.\d+)"/m
    );
    expect(resolved?.[1]).toBeTruthy();
    expect(gte(resolutionFloor(resolved![1]!), [4, 3, 2])).toBe(true);
  });

  it("pins sharp at the GHSA-rgj7-g3m4-5g8c floor", () => {
    expect(gte(resolutionFloor(resolutions.sharp), [0, 35, 4])).toBe(true);

    const lock = readFileSync(join(uiRoot, "yarn.lock"), "utf8");
    const resolved = lock.match(
      /^sharp@[^:\n]+:\n  version "(\d+\.\d+\.\d+)"/m
    );
    expect(resolved?.[1]).toBeTruthy();
    expect(gte(resolutionFloor(resolved![1]!), [0, 35, 4])).toBe(true);
  });

  it("pins brace-expansion off CVE-2026-102276 / 102277 / 102278", () => {
    // Yarn can only force one version of a package name. minimatch still
    // needs 1.x, 2.x, and 5.x, so the floor lives in yarn.lock, not resolutions.
    const lock = readFileSync(join(uiRoot, "yarn.lock"), "utf8");
    const resolved = [
      ...lock.matchAll(
        /^brace-expansion@([^\n:]+):\n  version "(\d+\.\d+\.\d+)"/gm
      ),
    ];
    const byRange = Object.fromEntries(resolved.map((m) => [m[1], m[2]]));
    expect(byRange["^1.1.7"]).toBe("1.1.21");
    expect(byRange["^2.0.2"]).toBe("2.1.7");
    expect(byRange["^5.0.8"]).toBe("5.0.12");
  });

  it("pins dompurify at the GHSA-p98j-92pf-mc4p floor", () => {
    expect(gte(resolutionFloor(resolutions.dompurify), [3, 4, 16])).toBe(
      true
    );

    const lock = readFileSync(join(uiRoot, "yarn.lock"), "utf8");
    const resolved = lock.match(
      /^dompurify@[^:\n]+:\n  version "(\d+\.\d+\.\d+)"/m
    );
    expect(resolved?.[1]).toBeTruthy();
    expect(gte(resolutionFloor(resolved![1]!), [3, 4, 16])).toBe(true);
  });

  it("keeps next at the GHSA-vcvr-r3jv-pc5j ImageResponse floor", () => {
    const declared = pkg.dependencies?.next;
    expect(declared).toBeTruthy();
    // 16.3.6 patches next/og ImageResponse RCE; 16.3.8 is the September
    // security release that also covers the follow-on advisories.
    expect(gte(resolutionFloor(declared!), [16, 3, 8])).toBe(true);

    const lock = readFileSync(join(uiRoot, "yarn.lock"), "utf8");
    const resolved = lock.match(/^next@[^:\n]+:\n  version "(\d+\.\d+\.\d+)"/m);
    expect(resolved?.[1]).toBeTruthy();
    expect(gte(resolutionFloor(resolved![1]!), [16, 3, 8])).toBe(true);
  });
});
