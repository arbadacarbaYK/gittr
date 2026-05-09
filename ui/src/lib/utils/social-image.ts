export function normalizeSocialImageUrl(
  candidate: string | undefined | null,
  baseUrl: string
): string {
  const fallback = `${baseUrl}/opengraph-image`;
  if (!candidate || typeof candidate !== "string") return fallback;

  const trimmed = candidate.trim();
  if (!trimmed) return fallback;

  const absolute = trimmed.startsWith("http")
    ? trimmed
    : `${baseUrl}${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;

  const lower = absolute.toLowerCase();
  // X/Telegram card fetchers are inconsistent with SVGs.
  if (lower.endsWith(".svg") || lower.includes(".svg?")) return fallback;

  return absolute;
}
