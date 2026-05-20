import { getCurationMutedPubkeys } from "../services/curation.ts";

/** Hex pubkeys from gateway `.env` (synced from gittr `PUBLISHER_BLOCKLIST` on deploy). */
function getSyncMutedFromEnv(): Set<string> {
  const raw = Deno.env.get("GITTR_SYNC_MUTED_PUBKEYS")?.trim();
  if (!raw) return new Set();
  const out = new Set<string>();
  for (const part of raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)) {
    if (/^[0-9a-f]{64}$/i.test(part)) {
      out.add(part.toLowerCase());
    }
  }
  return out;
}

/** Upstream curation mute list + gittr operator sync (until kind 10000 includes the same `p` tags). */
export function getPagesDirectoryMutedPubkeys(): Set<string> {
  const muted = getCurationMutedPubkeys();
  for (const pk of getSyncMutedFromEnv()) {
    muted.add(pk);
  }
  return muted;
}
