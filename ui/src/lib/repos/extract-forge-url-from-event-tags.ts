import { nip34TagValuesFromRow } from "../utils/nip34-tag-values";

/** Hosts that are Nostr-git mirrors, not foreign forge upstreams. */
const GRASP_OR_GITTR_HOST_RE =
  /(^|\.)(gittr\.space|ngit\.dev|nostrver\.se|gitworkshop\.dev)$/i;

function looksLikeForeignForgeUrl(raw: string): boolean {
  if (!raw || typeof raw !== "string") return false;
  const t = raw.trim();
  if (
    t.includes("github.com") ||
    t.includes("gitlab.com") ||
    t.includes("codeberg.org")
  ) {
    return true;
  }
  try {
    let u = t;
    const sshMatch = u.match(/^git@([^:]+):(.+)$/);
    if (sshMatch) {
      u = `https://${sshMatch[1]}/${sshMatch[2]}`;
    } else if (u.startsWith("git://")) {
      u = u.replace(/^git:\/\//, "https://");
    } else if (!/^https?:\/\//i.test(u)) {
      u = `https://${u}`;
    }
    const parsed = new URL(u);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".local") ||
      GRASP_OR_GITTR_HOST_RE.test(host)
    ) {
      return false;
    }
    const parts = parsed.pathname
      .replace(/\/+$/, "")
      .split("/")
      .filter(Boolean);
    // GRASP / Nostr-git mirrors — never treat as forge SOURCE / forkedFrom
    if (parts[0]?.toLowerCase() === "grasp") {
      return false;
    }
    if (parts.some((p) => /^npub1[a-z0-9]+$/i.test(p))) {
      return false;
    }
    // Known GRASP hosts (shakespeare.diy, etc.) even without /grasp/ path
    if (
      host === "git.shakespeare.diy" ||
      host.endsWith(".shakespeare.diy") ||
      host.includes("shakespeare")
    ) {
      return false;
    }
    // owner/repo path shape
    return parts.length >= 2;
  } catch {
    return false;
  }
}

export function isForeignForgeUrl(raw: string): boolean {
  return looksLikeForeignForgeUrl(raw);
}

/**
 * Prefer an explicit `source` / `forkedFrom` forge URL, then any refetchable
 * forge entry in multi-value `clone` / `web` / `link` tags (NIP-34 often puts
 * GRASP first and GitHub later on the same `clone` row).
 *
 * `web` / `link` are for discovery (Refetch). Do **not** use
 * {@link extractForgeSourceFromEventTags} for persist that can flip Push onto
 * sync-from-source — a docs link to github.com must not make a Nostr-only repo
 * look imported.
 */
export function extractGithubUrlFromEventTags(
  tags: string[][],
  kinds: readonly string[] = ["source", "forkedFrom", "clone", "web", "link"]
): string {
  const byKind = new Map<string, string[]>();
  const allow = new Set(kinds);
  for (const tag of tags) {
    if (!Array.isArray(tag) || !tag[0]) continue;
    const kind = String(tag[0]);
    if (!allow.has(kind)) continue;
    const values = nip34TagValuesFromRow(tag);
    if (!values.length) continue;
    const prev = byKind.get(kind) || [];
    byKind.set(kind, prev.concat(values));
  }
  for (const kind of kinds) {
    for (const raw of byKind.get(kind) || []) {
      if (!looksLikeForeignForgeUrl(raw)) continue;
      return raw;
    }
  }
  return "";
}

/** Forge URL safe to persist as `sourceUrl` (Push tip / sync-from-source). */
export function extractForgeSourceFromEventTags(tags: string[][]): string {
  return extractGithubUrlFromEventTags(tags, ["source", "forkedFrom", "clone"]);
}
