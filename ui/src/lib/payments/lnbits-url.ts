/**
 * Resolve LNbits base URL for API routes.
 * No hardcoded third-party host — set LNBITS_URL or pass per-request body/query.
 * Blocks private/localhost targets (SSRF).
 */
import { hostnameLooksPrivateOrLocal } from "@/lib/security/safe-remote-url";

export function resolveLnbitsUrl(
  explicit?: string | string[] | null | undefined
): string {
  const raw = Array.isArray(explicit) ? explicit[0] : explicit;
  const s = (raw || process.env.LNBITS_URL || "").trim();
  if (!s) return "";
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  const cleaned = withScheme.replace(/\/+$/, "");
  try {
    const u = new URL(cleaned);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    if (hostnameLooksPrivateOrLocal(u.hostname)) return "";
    if (u.username || u.password) return "";
    return cleaned;
  } catch {
    return "";
  }
}
