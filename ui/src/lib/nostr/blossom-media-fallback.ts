/**
 * Kind-0 `picture` / `banner` URLs are often Blossom SHA-256 blobs.
 * One host 502ing (e.g. blossom.ditto.pub) must not hide the avatar —
 * the same bytes are commonly mirrored on other public Blossom servers.
 */

const SHA256 = /[0-9a-f]{64}/i;
const EXT = /\.([a-z0-9]{1,12})$/i;

/** Public mirrors that actually serve profile blobs (not gittr Pages Blossom). */
export const PROFILE_BLOSSOM_MIRROR_ORIGINS = [
  "https://blossom.primal.net",
  "https://blossom.dreamith.to",
  "https://image.nostr.build",
] as const;

/** Hosts that currently stall or 502 often — try mirrors first. */
const DEPRIORITIZED_HOSTS = new Set(["blossom.ditto.pub"]);

function originHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function extractBlossomSha256(url: string): {
  hash: string;
  ext: string;
} | null {
  const raw = (url || "").trim();
  if (!raw) return null;
  let pathname = raw;
  try {
    pathname = new URL(raw).pathname;
  } catch {
    /* use raw */
  }
  const hashMatch = pathname.match(SHA256);
  if (!hashMatch) return null;
  const hash = hashMatch[0]!.toLowerCase();
  const after = pathname.slice(pathname.toLowerCase().indexOf(hash) + 64);
  const extMatch = after.match(EXT);
  const ext = extMatch ? `.${extMatch[1]!.toLowerCase()}` : "";
  return { hash, ext };
}

function candidateFor(origin: string, hash: string, ext: string): string {
  return `${origin.replace(/\/$/, "")}/${hash}${ext}`;
}

/**
 * Ordered URLs to try for a kind-0 picture/banner.
 * Original URL is included (first, unless its host is known-flaky).
 * Non-blossom http(s) URLs return `[original]` only.
 * Inline `data:image/…` (SVG/PNG baked into kind 0) returns `[original]`.
 */
export function blossomMediaFallbackUrls(
  url: string | null | undefined
): string[] {
  const original = (url || "").trim();
  if (!original) return [];
  // Kind-0 sometimes embeds an SVG/PNG (no host to mirror).
  if (/^data:image\/[a-z0-9.+-]+/i.test(original)) return [original];
  if (!/^https?:\/\//i.test(original)) return [];

  const parsed = extractBlossomSha256(original);
  if (!parsed) return [original];

  const seen = new Set<string>();
  const out: string[] = [];
  const push = (u: string) => {
    if (!u || seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };

  const host = originHost(original);
  const originalFirst = !host || !DEPRIORITIZED_HOSTS.has(host);
  if (originalFirst) push(original);

  for (const origin of PROFILE_BLOSSOM_MIRROR_ORIGINS) {
    if (host && originHost(origin) === host) continue;
    push(candidateFor(origin, parsed.hash, parsed.ext));
    if (parsed.ext) push(candidateFor(origin, parsed.hash, ""));
  }

  if (!originalFirst) push(original);

  return out;
}

/** Next URL after `failedSrc` failed, or null when the list is exhausted. */
export function nextBlossomMediaUrl(
  failedSrc: string,
  originalSrc: string | null | undefined
): string | null {
  const list = blossomMediaFallbackUrls(originalSrc || failedSrc);
  const failed = (failedSrc || "").trim();
  const idx = list.findIndex((u) => u === failed);
  if (idx >= 0) return list[idx + 1] || null;
  // Browser may rewrite src (trailing slash, resolved URL). Compare by hash+host.
  const rest = list.filter((u) => u !== failed);
  return rest.find((u) => u !== list[0]) || rest[0] || null;
}
