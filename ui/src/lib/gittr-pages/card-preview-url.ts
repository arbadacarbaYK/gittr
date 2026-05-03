/**
 * Optional live snapshot for Pages directory cards.
 * Uses image.thum.io as a passive screenshot URL (no API key). Sites must be HTTPS.
 * Set NEXT_PUBLIC_PAGES_CARD_PREVIEW=0 to disable (privacy / fewer third-party requests).
 */
export function pagesCardPreviewUrl(siteUrl: string): string | null {
  if (process.env.NEXT_PUBLIC_PAGES_CARD_PREVIEW === "0") {
    return null;
  }
  const u = siteUrl.trim();
  if (!u.startsWith("https://")) {
    return null;
  }
  return `https://image.thum.io/get/width/720/crop/900/noanimate/${u}`;
}
