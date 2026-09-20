import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "page.tsx"),
  "utf8"
);

describe("Your repositories card title", () => {
  it("puts the name on its own row on phones so Live/Public badges cannot truncate it", () => {
    expect(page).toContain(
      "flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2 sm:flex-wrap"
    );
    expect(page).toContain("break-all sm:truncate");
    expect(page).toContain("w-full sm:w-auto sm:flex-1");
  });

  it("uses a real href so right-click can open a repo in a new tab", () => {
    expect(page).toContain("href={repoHref}");
    expect(page).toContain("isModifiedPointerClick(e)");
    expect(page).not.toMatch(
      /<div\s+className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"/
    );
  });
});
