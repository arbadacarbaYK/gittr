/**
 * Resolve LNbits base URL for API routes.
 * No hardcoded third-party host — set LNBITS_URL or pass per-request body/query.
 */
export function resolveLnbitsUrl(
  explicit?: string | string[] | null | undefined
): string {
  const raw = Array.isArray(explicit) ? explicit[0] : explicit;
  const s = (raw || process.env.LNBITS_URL || "").trim();
  if (!s) return "";
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  return withScheme.replace(/\/+$/, "");
}
