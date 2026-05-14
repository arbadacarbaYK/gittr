/**
 * NIP-34 repository announcements use tags whose values may span indices 1..n on a single tag
 * (e.g. ["clone", "https://a/x.git", "https://b/x.git"]). Older gittr builds emitted repeated
 * ["clone", url] rows instead; parsers must accept both.
 */
export function nip34TagValuesFromRow(tag: string[] | undefined): string[] {
  if (!Array.isArray(tag) || tag.length < 2) return [];
  const out: string[] = [];
  for (let i = 1; i < tag.length; i++) {
    const v = String(tag[i] ?? "").trim();
    if (v) out.push(v);
  }
  return out;
}

export function normalizeRelayWssUrl(relay: string): string {
  const t = String(relay || "").trim();
  if (!t) return "";
  if (t.startsWith("wss://") || t.startsWith("ws://")) return t;
  return `wss://${t}`;
}
