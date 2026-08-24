import { nip19 } from "nostr-tools";

export type ProfileRepoCloneHints = {
  clone: string[];
  sourceUrl?: string;
  lastNostrEventId?: string;
};

function repoNameMatches(
  row: Record<string, unknown>,
  repoName: string
): boolean {
  const slug = repoName.trim();
  if (!slug) return false;
  const candidates = [row.repo, row.name, row.slug, row.d].filter(Boolean);
  return candidates.some((raw) => {
    const n = String(raw).trim();
    if (!n) return false;
    const base = n.replace(/\.git$/i, "");
    return (
      n === slug || base === slug || base.toLowerCase() === slug.toLowerCase()
    );
  });
}

/**
 * Server-side relay query for kind 30617 clone/source tags when the browser
 * Nostr subscription is slow or empty (foreign repos like LiE on friendly-machines).
 */
export async function fetchRepoCloneHintsFromProfile(
  ownerPubkey: string,
  repoName: string
): Promise<ProfileRepoCloneHints | null> {
  let pk = ownerPubkey.trim();
  if (pk.startsWith("npub")) {
    try {
      const decoded = nip19.decode(pk);
      if (decoded.type === "npub" && typeof decoded.data === "string") {
        pk = decoded.data;
      }
    } catch {
      return null;
    }
  }
  pk = pk.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pk)) return null;
  const slug = repoName.trim();
  if (!slug) return null;

  try {
    const res = await fetch(
      `/api/nostr/profile-repos?ownerPubkey=${encodeURIComponent(pk)}`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { repos?: unknown[] };
    const rows = Array.isArray(data?.repos) ? data.repos : [];
    const match = rows.find(
      (r): r is Record<string, unknown> =>
        !!r &&
        typeof r === "object" &&
        repoNameMatches(r as Record<string, unknown>, slug)
    );
    if (!match) return null;

    const clone = Array.isArray(match.clone)
      ? match.clone
          .filter(
            (u): u is string => typeof u === "string" && u.trim().length > 0
          )
          .map((u) => u.trim())
      : [];
    const sourceUrl =
      typeof match.sourceUrl === "string" && match.sourceUrl.trim()
        ? match.sourceUrl.trim()
        : undefined;

    return {
      clone,
      sourceUrl,
      lastNostrEventId:
        typeof match.lastNostrEventId === "string"
          ? match.lastNostrEventId
          : undefined,
    };
  } catch {
    return null;
  }
}
