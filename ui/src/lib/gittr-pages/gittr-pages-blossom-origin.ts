/**
 * **gittr Pages** Blossom origin: same value the upload proxy and kind **24242** `server` tag use.
 * Next.js only inlines `NEXT_PUBLIC_*` when the key is a **static** `process.env.NAME` access.
 * Dynamic `env[key]` made the browser default to a different host than the API, and Blossom
 * then returned 401 “Auth token not valid for this server”.
 *
 * Order: `NEXT_PUBLIC_GITTR_PAGES_BLOSSOM_URL` → Pages host (`blossom.gittr.space`).
 * Do **not** fall through to `NEXT_PUBLIC_BLOSSOM_URL` — that one is media / NIP-96 and
 * is often blossom.band (nostr.build), which is not the Pages blob store.
 */
import { GITTR_BLOSSOM_ORIGIN } from "../gittr-repo-links";

export const DEFAULT_GITTR_PAGES_BLOSSOM_ORIGIN = GITTR_BLOSSOM_ORIGIN;

function normalizeBlossomBase(
  specific: string | undefined,
  fallback: string | undefined,
  finalDefault: string
): string {
  const raw = (specific || fallback || finalDefault).trim();
  const withProto = raw.startsWith("http") ? raw : `https://${raw}`;
  return withProto.replace(/\/$/, "");
}

function hostnameOfOrigin(origin: string): string {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Bare hostname from a BUD-11 `server` tag (host or full URL). */
export function normalizeBlossomServerTagHost(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (!v) return "";
  try {
    if (v.startsWith("http://") || v.startsWith("https://")) {
      return new URL(v).hostname.toLowerCase();
    }
  } catch {
    /* fall through */
  }
  return v.split("/")[0] || "";
}

export function blossomAuthServerHosts(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  for (const t of tags) {
    if (!Array.isArray(t) || t[0] !== "server" || typeof t[1] !== "string") {
      continue;
    }
    const host = normalizeBlossomServerTagHost(t[1]);
    if (host) out.push(host);
  }
  return out;
}

/**
 * BUD-11: no `server` tags → valid everywhere. If tags exist, one must match the upload host.
 */
export function blossomAuthServerMatchesOrigin(
  tags: unknown,
  origin: string
): boolean {
  const tagged = blossomAuthServerHosts(tags);
  if (tagged.length === 0) return true;
  const want = hostnameOfOrigin(origin);
  if (!want) return false;
  return tagged.includes(want);
}

/** Resolved env chain (trim + default). Same value the browser and the proxy must use. */
export function rawGittrPagesBlossomEnvOrigin(): string {
  const pages =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_GITTR_PAGES_BLOSSOM_URL
      : undefined;
  return normalizeBlossomBase(
    pages,
    undefined,
    DEFAULT_GITTR_PAGES_BLOSSOM_ORIGIN
  );
}

/** Alias for `PUT …/upload`, kind **24242** / **35128** `server`. */
export function gittrPagesBlossomOrigin(): string {
  return rawGittrPagesBlossomEnvOrigin();
}

/** Optional BUD-11 `["server", "<hostname>"]` for kind 24242. */
export function gittrPagesBlossomServerTag(): string[] | undefined {
  const host = hostnameOfOrigin(gittrPagesBlossomOrigin());
  if (host) return ["server", host];
  return undefined;
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
