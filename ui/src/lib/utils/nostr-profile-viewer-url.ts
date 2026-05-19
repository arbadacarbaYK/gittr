import { nip19 } from "nostr-tools";

const PROFILE_MIRROR_HOSTS = new Set([
  "nosdav.net",
  "nostr.com",
  "snort.social",
  "iris.to",
  "coracle.social",
  "primal.net",
]);

function parseWebsiteUrl(website: string): URL | null {
  const trimmed = website.trim();
  if (!trimmed) return null;
  try {
    return new URL(
      trimmed.startsWith("http://") || trimmed.startsWith("https://")
        ? trimmed
        : `https://${trimmed}`
    );
  } catch {
    return null;
  }
}

function pathPubkeyOrNpub(pathname: string): string | null {
  const segment = pathname.replace(/^\/+|\/+$/g, "").split("/")[0];
  if (!segment) return null;
  if (/^[0-9a-f]{64}$/i.test(segment)) return segment.toLowerCase();
  if (segment.startsWith("npub1")) return segment;
  return null;
}

/** True when kind-0 `website` is another Nostr profile viewer for this pubkey (e.g. nosdav.net/{hex}). */
export function isNostrProfileMirrorWebsite(
  website: string,
  pubkeyHex: string | null | undefined
): boolean {
  if (!website.trim() || !pubkeyHex || !/^[0-9a-f]{64}$/i.test(pubkeyHex)) {
    return false;
  }
  const hex = pubkeyHex.toLowerCase();
  const npub = nip19.npubEncode(hex);
  const url = parseWebsiteUrl(website);
  if (!url) {
    const lower = website.toLowerCase();
    return lower.includes(hex) || lower.includes(npub.toLowerCase());
  }
  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  if (!PROFILE_MIRROR_HOSTS.has(host)) return false;
  const id = pathPubkeyOrNpub(url.pathname);
  if (!id) return false;
  if (id === hex) return true;
  if (id.startsWith("npub1")) {
    try {
      const decoded = nip19.decode(id);
      if (decoded.type === "npub" && typeof decoded.data === "string") {
        return decoded.data.toLowerCase() === hex;
      }
    } catch {
      return false;
    }
  }
  return false;
}

/** External profile page (njump.me) for npub or 64-char hex pubkey. */
export function nostrProfileViewerUrl(pubkeyOrNpub: string): string {
  const trimmed = pubkeyOrNpub.trim();
  if (trimmed.startsWith("npub1")) {
    return `https://njump.me/${trimmed}`;
  }
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return `https://njump.me/${nip19.npubEncode(trimmed.toLowerCase())}`;
  }
  return `https://njump.me/${encodeURIComponent(trimmed)}`;
}
