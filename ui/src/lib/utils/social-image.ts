const OUR_CARD_PATH_SUFFIXES = ["/opengraph-image", "/twitter-image"];

/**
 * True when the URL is our own generated 1200×630 social card (same origin).
 * Only those images should carry og:image width/height hints: messengers like
 * Telegram compare hints to the fetched file and drop previews on mismatch
 * (e.g. 96×96 avatar labeled as 1200×630).
 */
export function isOurGeneratedSocialCard(
  absoluteUrl: string,
  baseUrl: string
): boolean {
  try {
    const u = new URL(absoluteUrl);
    const b = new URL(baseUrl);
    if (u.origin !== b.origin) return false;
    const path =
      (u.pathname.endsWith("/") ? u.pathname.slice(0, -1) : u.pathname) || "/";
    return OUR_CARD_PATH_SUFFIXES.some((s) => path.endsWith(s) || path === s);
  } catch {
    return false;
  }
}

/**
 * `openGraph.images` entry: include 1200×630 only for our generated card URLs.
 */
export function openGraphImageDescriptor(
  iconUrl: string,
  baseUrl: string,
  alt: string
): { url: string; alt: string; width?: number; height?: number } {
  if (isOurGeneratedSocialCard(iconUrl, baseUrl)) {
    return { url: iconUrl, alt, width: 1200, height: 630 };
  }
  return { url: iconUrl, alt };
}

export function normalizeSocialImageUrl(
  candidate: string | undefined | null,
  baseUrl: string
): string {
  const fallback = `${baseUrl}/opengraph-image`;
  if (!candidate || typeof candidate !== "string") return fallback;

  const trimmed = candidate.trim();
  if (!trimmed) return fallback;

  let absolute = trimmed.startsWith("http")
    ? trimmed
    : `${baseUrl}${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;

  // Telegram and most messengers only fetch HTTPS og:image URLs.
  if (absolute.startsWith("http://")) {
    absolute = `https://${absolute.slice("http://".length)}`;
  }

  const lower = absolute.toLowerCase();
  // X/Telegram card fetchers are inconsistent with SVGs.
  if (lower.endsWith(".svg") || lower.includes(".svg?")) return fallback;

  return absolute;
}
