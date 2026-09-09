import { existsSync, readFileSync } from "fs";
import { join } from "path";

/** Lines like `npub1…/repo-name` from the optional local supplement file. */
export function parseNostrPushedRepoLines(raw: string): string[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length > 0 && !l.startsWith("#") && /^npub1[0-9a-z]+\/.+/i.test(l)
    );
  return [...new Set(lines)];
}

export function loadNostrPushedRepoPaths(cwd = process.cwd()): string[] {
  const candidates = [
    join(cwd, "..", "nostr-pushed-repos.txt"),
    join(cwd, "nostr-pushed-repos.txt"),
  ];
  for (const filePath of candidates) {
    try {
      if (!existsSync(/* turbopackIgnore: true */ filePath)) continue;
      return parseNostrPushedRepoLines(
        readFileSync(/* turbopackIgnore: true */ filePath, "utf8")
      );
    } catch {
      /* continue */
    }
  }
  return [];
}
