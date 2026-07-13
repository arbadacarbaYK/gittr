import type { Event } from "nostr-tools";

import { KIND_REPOSITORY } from "./events";

/**
 * gittr extension on kind 30617: ["public-read","false"] means private.
 * Kind 51 JSON may include publicRead: false. Missing tag/field => public (default).
 */
export function isPublicReadFromEvent(ev: Event): boolean {
  for (const t of ev.tags || []) {
    if (t[0] === "public-read" && typeof t[1] === "string") {
      return t[1].toLowerCase() !== "false";
    }
  }

  if ((ev.kind as number) === KIND_REPOSITORY) {
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
