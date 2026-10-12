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
    devDependencies?: Record<string, string>;
    resolutions?: Record<string, string>;
  };
  const resolutions = pkg.resolutions || {};

  it("pins browserslist at the CVE-2026-73088 / CVE-2026-73089 floor", () => {
    expect(gte(resolutionFloor(resolutions.browserslist), [4, 28, 7])).toBe(
      true
    );
  });

  it("does not depend on Capacitor (CVE-2026-103922)", () => {
    const names = [
      "@capacitor/android",
      "@capacitor/cli",
      "@capacitor/core",
      "@capacitor/ios",
    ];
    for (const name of names) {
      expect(pkg.dependencies?.[name]).toBeUndefined();
      expect(pkg.devDependencies?.[name]).toBeUndefined();
    }
    const lock = readFileSync(join(uiRoot, "yarn.lock"), "utf8");
    expect(lock.includes("@capacitor/")).toBe(false);
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

  it("pins sharp at the GHSA-wq5f-xc86-pv6w librsvg floor", () => {
    // 0.35.4 cleared GHSA-rgj7-g3m4-5g8c; 0.35.5 clears the librsvg advisory.
    expect(gte(resolutionFloor(resolutions.sharp), [0, 35, 5])).toBe(true);

    const lock = readFileSync(join(uiRoot, "yarn.lock"), "utf8");
    const resolved = lock.match(
      /^sharp@[^:\n]+:\n  version "(\d+\.\d+\.\d+)"/m
    );
    expect(resolved?.[1]).toBeTruthy();
    expect(gte(resolutionFloor(resolved![1]!), [0, 35, 5])).toBe(true);
  });

  it("pins source-map-js at the CVE-2026-93749 floor", () => {
    expect(gte(resolutionFloor(resolutions["source-map-js"]), [1, 2, 2])).toBe(
      true
    );

    const lock = readFileSync(join(uiRoot, "yarn.lock"), "utf8");
    const resolved = lock.match(
      /^source-map-js@[^:\n]+:\n  version "(\d+\.\d+\.\d+)"/m
    );
    expect(resolved?.[1]).toBeTruthy();
    expect(gte(resolutionFloor(resolved![1]!), [1, 2, 2])).toBe(true);
  });

  it("pins postcss-selector-parser at the CVE-2026-104844 floor", () => {
    // 6.x has no fix. 7.1.6 is the first release outside the range.
    expect(
      gte(resolutionFloor(resolutions["postcss-selector-parser"]), [7, 1, 6])
    ).toBe(true);

    const lock = readFileSync(join(uiRoot, "yarn.lock"), "utf8");
    const resolved = lock.match(
      /^postcss-selector-parser@[^:\n]+:\n  version "(\d+\.\d+\.\d+)"/m
    );
    expect(resolved?.[1]).toBeTruthy();
    expect(gte(resolutionFloor(resolved![1]!), [7, 1, 6])).toBe(true);
  });

  it("pins katex at the CVE-2026-103923 floor that still installs on Node 20", () => {
    // Fixed in 0.18.2. 0.18.5+ depends on commander 15, which wants Node 22.
    expect(gte(resolutionFloor(resolutions.katex), [0, 18, 4])).toBe(true);

    const lock = readFileSync(join(uiRoot, "yarn.lock"), "utf8");
    const resolved = lock.match(
      /^katex@[^:\n]+:\n  version "(\d+\.\d+\.\d+)"/m
    );
    expect(resolved?.[1]).toBeTruthy();
    expect(gte(resolutionFloor(resolved![1]!), [0, 18, 4])).toBe(true);
  });

  it("keeps braces at the newest npm publish, which is still last-affected", () => {
    // GHSA-vfj7-8cjw-p6xm last_affected is 3.0.3. npm has no 3.0.4.
    const lock = readFileSync(join(uiRoot, "yarn.lock"), "utf8");
    const resolved = lock.match(
      /^braces@[^:\n]+:\n  version "(\d+\.\d+\.\d+)"/m
    );
    expect(resolved?.[1]).toBe("3.0.3");
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
    expect(gte(resolutionFloor(resolutions.dompurify), [3, 4, 16])).toBe(true);

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
