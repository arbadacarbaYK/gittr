/**
 * Link a directory card should share.
 * Apps pass a site path (`/apps/id`). Pages pass the live https site URL.
 * Anything else is dropped so a bad gateway row cannot share `javascript:`.
 */
export function directoryCardShareUrl(target: string, origin = ""): string {
  const raw = target.trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!raw.startsWith("/") || raw.startsWith("//")) return "";
  const base = origin.replace(/\/$/, "");
  return `${base}${raw}`;
}
