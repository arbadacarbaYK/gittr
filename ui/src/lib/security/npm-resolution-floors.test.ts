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
  const pkg = JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../../package.json"),
      "utf8"
    )
  ) as { resolutions?: Record<string, string> };
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
});
