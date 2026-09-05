/**
 * NIP-82 / Zapstore installers may be pinned to public Blossom hosts.
 * gittr’s own Blossom (Pages / nsite) is never an Apps pin target.
 */
import { GITTR_BLOSSOM_ORIGIN } from "../gittr-repo-links";

/** Primal → Ditto → Haven. gittr Pages Blossom is not in this list. */
export const NGIT_BLOSSOM_ORIGINS = [
  "https://blossom.primal.net",
  "https://blossom.ditto.pub",
  "https://haven.danconwaydev.com",
] as const;

export type NgitBlossomOrigin = (typeof NGIT_BLOSSOM_ORIGINS)[number];

const SHA256_PATH = /^\/[0-9a-f]{64}(?:\.[a-z0-9]{1,12})?$/i;

function hostnameOf(originOrUrl: string): string | null {
  try {
    return new URL(originOrUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function gittrBlossomHostnames(): Set<string> {
  const out = new Set<string>(["blossom.gittr.space"]);
  const fromConst = hostnameOf(GITTR_BLOSSOM_ORIGIN);
  if (fromConst) out.add(fromConst);
  return out;
}

/** True when this host is gittr’s Pages blob CDN, not an Apps pin target. */
export function isGittrBlossomHostname(hostname: string): boolean {
  const h = (hostname || "").toLowerCase();
  if (!h) return false;
  if (gittrBlossomHostnames().has(h)) return true;
  if (h.includes("blossom") && h.endsWith(".gittr.space")) return true;
  return false;
}

export function ngitBlossomHostnames(): string[] {
  return NGIT_BLOSSOM_ORIGINS.map((o) => hostnameOf(o)).filter(
    (h): h is string => Boolean(h)
  );
}

export function isAllowedNgitBlossomOrigin(origin: string): boolean {
  const host = hostnameOf(origin);
  if (!host || isGittrBlossomHostname(host)) return false;
  return ngitBlossomHostnames().includes(host);
}

/**
 * Kind 3063 `url` may only be rewritten to an allowlisted public Blossom HTTPS blob.
 * Forge URLs and gittr Blossom URLs are rejected (caller keeps the forge URL).
 */
export function allowedNip82BlossomAssetUrl(url: string): string | null {
  const raw = (url || "").trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.search || parsed.hash) return null;
  const host = parsed.hostname.toLowerCase();
  if (isGittrBlossomHostname(host)) return null;
  if (!ngitBlossomHostnames().includes(host)) return null;
  if (!SHA256_PATH.test(parsed.pathname)) return null;
  return `https://${host}${parsed.pathname.toLowerCase()}`;
}

export function blossomBlobUrl(
  origin: string,
  sha256Hex: string
): string | null {
  const sha = (sha256Hex || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha)) return null;
  if (!isAllowedNgitBlossomOrigin(origin)) return null;
  const base = origin.replace(/\/$/, "");
  return `${base}/${sha}`;
}

/** Pick a usable blob URL from a BUD-02 descriptor, else `${origin}/${sha256}`. */
export function resolvePinnedBlossomUrl(args: {
  putOrigin: string;
  sha256Hex: string;
  descriptorUrl?: string;
}): string | null {
  const fromDescriptor = args.descriptorUrl
    ? allowedNip82BlossomAssetUrl(args.descriptorUrl)
    : null;
  if (fromDescriptor) return fromDescriptor;
  return blossomBlobUrl(args.putOrigin, args.sha256Hex);
}
