/**
 * Normalize the public site origin from NEXT_PUBLIC_SITE_URL.
 * Operators sometimes set "gittr.space" without a scheme; crawlers and Next.js
 * metadata need an absolute URL (https://...).
 *
 * Telegram / X often fail to load og:image when the page was reached via a
 * scheme-less paste (`gittr.space`) if metadataBase or og:image is http:// —
 * always prefer https except for local dev hosts.
 */
export function normalizeSiteUrl(
  value: string | undefined | null,
  fallback: string
): string {
  let v = (value ?? "").trim();
  if (!v) return fallback.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(v)) {
    v = `https://${v.replace(/^\/+/, "")}`;
  }
  const isLocal =
    /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:|\/|$)/i.test(v) ||
    /^https?:\/\/\[::1\]/i.test(v);
  if (!isLocal && /^http:\/\//i.test(v)) {
    v = `https://${v.slice("http://".length)}`;
  }
  return v.replace(/\/+$/, "");
}

/** Production / SEO: default https://gittr.space when env is unset. */
export function getPublicSiteUrl(): string {
  return normalizeSiteUrl(
    process.env.NEXT_PUBLIC_SITE_URL,
    "https://gittr.space"
  );
}
