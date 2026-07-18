import type { Event } from "nostr-tools";

/** Legacy gitnostr announcement kind (JSON content may include publicRead). */
const KIND_REPOSITORY_LEGACY = 51;

/**
 * gittr extension on kind 30617: ["public-read","false"] means private.
 * Kind 51 JSON may include publicRead: false. Missing tag/field => public (default).
 */

/** Parse gittr `public-read` tag. `undefined` = tag absent (treat as public). */
export function publicReadFromTags(
  tags: string[][] | undefined | null
): boolean | undefined {
  if (!Array.isArray(tags)) return undefined;
  for (const t of tags) {
    if (
      Array.isArray(t) &&
      t[0] === "public-read" &&
      typeof t[1] === "string"
    ) {
      return t[1].toLowerCase() !== "false";
    }
  }
  return undefined;
}

/** Parse gittr `public-write` tag. `undefined` = tag absent (treat as no public write). */
export function publicWriteFromTags(
  tags: string[][] | undefined | null
): boolean | undefined {
  if (!Array.isArray(tags)) return undefined;
  for (const t of tags) {
    if (
      Array.isArray(t) &&
      t[0] === "public-write" &&
      typeof t[1] === "string"
    ) {
      return t[1].toLowerCase() === "true";
    }
  }
  return undefined;
}

/**
 * Apply privacy tags onto a mutable repo-shaped object.
 * When tags are absent, defaults to public read / no public write (legacy).
 */
export function applyPrivacyTagsToRepoData(
  repoData: { publicRead?: boolean; publicWrite?: boolean },
  tags: string[][] | undefined | null
): void {
  const read = publicReadFromTags(tags);
  const write = publicWriteFromTags(tags);
  if (read !== undefined) {
    repoData.publicRead = read;
  } else if (repoData.publicRead === undefined) {
    repoData.publicRead = true;
  }
  if (write !== undefined) {
    repoData.publicWrite = write;
  } else if (repoData.publicWrite === undefined) {
    repoData.publicWrite = false;
  }
}

export function isPublicReadFromEvent(ev: Event): boolean {
  const fromTags = publicReadFromTags(ev.tags as string[][] | undefined);
  if (fromTags !== undefined) return fromTags;

  if ((ev.kind as number) === KIND_REPOSITORY_LEGACY) {
    const trimmed = (ev.content || "").trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const data = JSON.parse(trimmed) as { publicRead?: boolean };
        if (data.publicRead === false) return false;
      } catch {
        /* ignore */
      }
    }
  }

  return true;
}
