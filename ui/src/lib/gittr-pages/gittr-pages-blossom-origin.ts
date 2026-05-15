/**
 * **gittr Pages** Blossom origin: same env the upload proxy and kind **24242** use.
 * Order: `NEXT_PUBLIC_GITTR_PAGES_BLOSSOM_URL` → `NEXT_PUBLIC_BLOSSOM_URL` → `https://blossom.band`.
 * No host overrides — if you point at a media-only Blossom (e.g. nostr.build), set the env to a
 * static-friendly NIP-96 origin (e.g. `https://blossom.band`) and rebuild.
 */

function readPublicEnv(key: string): string | undefined {
  try {
    if (typeof process === "undefined") return undefined;
    const env = (process as { env?: Record<string, string | undefined> }).env;
    return env?.[key];
  } catch {
    return undefined;
  }
}

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
    readPublicEnv("NEXT_PUBLIC_GITTR_PAGES_BLOSSOM_URL"),
    readPublicEnv("NEXT_PUBLIC_BLOSSOM_URL"),
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
