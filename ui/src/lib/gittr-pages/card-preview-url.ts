/**
 * Card snapshot backgrounds were served via image.thum.io, which often returns a
 * 200 OK “sign up for paid account” image — unusable as a subtle background.
 * Previews are disabled until a paid-capable or first-party screenshot path exists.
 */
export function pagesCardPreviewUrl(_siteUrl: string): string | null {
  return null;
}
