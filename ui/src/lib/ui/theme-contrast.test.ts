import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../styles/globals.css"),
  "utf8"
);

describe("theme filled-button contrast", () => {
  it("gives cypherpunk black ink on neon accent fills", () => {
    expect(css).toMatch(
      /\[data-theme="cypherpunk"\][\s\S]*?--color-on-accent:\s*#000000/
    );
    expect(css).toContain(
      ':root[data-theme="cypherpunk"] .bg-purple-600.text-white'
    );
    expect(css).toContain("color: var(--color-on-accent) !important;");
  });
});
