/**
 * **gittr Pages** Blossom origin: same env the upload proxy and kind **24242** use.
 * Order: `NEXT_PUBLIC_GITTR_PAGES_BLOSSOM_URL` → `NEXT_PUBLIC_BLOSSOM_URL` → `https://blossom.band`.
 * No host overrides — if you point at a media-only Blossom (e.g. nostr.build), set the env to a
 * static-friendly NIP-96 origin (e.g. `https://blossom.band`) and rebuild.
 */

function normalizeBlossomBase(
  specific: string | undefined,
  fallback: string | undefined,
  finalDefault: string
): string {
  const raw = (specific || fallback || finalDefault).trim();
  const withProto = raw.startsWith("http") ? raw : `https://${raw}`;
  return withProto.replace(/\/$/, "");
}

/** True when the URL host is nostr.build’s media-only Blossom family. */
export function isMediaOnlyNostrBuildBlossom(origin: string): boolean {
  try {
    const h = new URL(origin).hostname.toLowerCase();
    return h === "nostr.build" || h.endsWith(".nostr.build");
  } catch {
    return false;
  }
}

/** Resolved env chain (trim + default). Same value the server uses for Pages uploads. */
export function rawGittrPagesBlossomEnvOrigin(): string {
  return normalizeBlossomBase(
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_GITTR_PAGES_BLOSSOM_URL
      : undefined,
    typeof process !== "undefined" ? process.env.NEXT_PUBLIC_BLOSSOM_URL : undefined,
    "https://blossom.band"
  );
}

/** Alias for `PUT …/upload`, kind **24242** / **35128** `server` — always equals `rawGittrPagesBlossomEnvOrigin()`. */
export function gittrPagesBlossomOrigin(): string {
  return rawGittrPagesBlossomEnvOrigin();
}

/** Optional BUD-11 `["server", "<hostname>"]` for kind 24242. */
export function gittrPagesBlossomServerTag(): string[] | undefined {
  try {
    const o = gittrPagesBlossomOrigin();
    const host = new URL(o).hostname.toLowerCase();
    if (host) return ["server", host];
  } catch {
    /* ignore */
  }
  return undefined;
}
