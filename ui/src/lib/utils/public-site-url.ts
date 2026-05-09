/**
 * Normalize the public site origin from NEXT_PUBLIC_SITE_URL.
 * Operators sometimes set "gittr.space" without a scheme; crawlers and Next.js
 * metadata need an absolute URL (https://...).
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
  return v.replace(/\/+$/, "");
}

/** Production / SEO: default https://gittr.space when env is unset. */
export function getPublicSiteUrl(): string {
  return normalizeSiteUrl(
    process.env.NEXT_PUBLIC_SITE_URL,
    "https://gittr.space"
  );
}
