import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function hubJobNames(html: string): string[] {
  const section = html.match(/<section id="jobs">[\s\S]*?<\/section>/);
  if (!section) throw new Error("index.html missing #jobs");
  return [...section[0].matchAll(/<div class="name">([^<]+)<\/div>/g)].map(
    (m) => decodeEntities(m[1].trim())
  );
}

function helpJobNames(src: string): string[] {
  const section = src.match(
    /<HelpSection id="what-is-gittr"[\s\S]*?<\/HelpSection>/
  );
  if (!section) throw new Error("help page missing what-is-gittr");
  const items = [...section[0].matchAll(/<li\b[\s\S]*?<\/li>/g)];
  return items.map((item) => {
    const title = item[0].match(
      /<strong className="text-white">([^<]+)<\/strong>/
    );
    if (!title) {
      throw new Error("what-is-gittr list item missing title strong");
    }
    return decodeEntities(title[1].trim());
  });
}

describe("docs hub What you can do jobs", () => {
  const hub = readFileSync(join(repoRoot, "index.html"), "utf8");
  const help = readFileSync(
    join(here, "..", "..", "app", "help", "page.tsx"),
    "utf8"
  );

  it("keeps the public hub tile names in lockstep with Help", () => {
    const fromHub = hubJobNames(hub);
    const fromHelp = helpJobNames(help);
    expect(fromHub).toEqual(fromHelp);
    expect(fromHub).toEqual(
      expect.arrayContaining([
        "Web of Trust badges",
        "External identities",
        "Security lab",
      ])
    );
    expect(fromHub).toHaveLength(20);
  });
});
