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
    // Home GRASP deployments: https://host/grasp/npub…/repo — not a forge upstream
    const parts = parsed.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    if (parts[0]?.toLowerCase() === "grasp") {
      return false;
    }
    // owner/repo path shape
    return parts.length >= 2;
  } catch {
    return false;
  }
}

/**
 * Prefer an explicit `source` / `forkedFrom` forge URL, then any refetchable
 * forge entry in multi-value `clone` / `web` / `link` tags (NIP-34 often puts
 * GRASP first and GitHub later on the same `clone` row).
 */
export function extractGithubUrlFromEventTags(tags: string[][]): string {
  const preferOrder = ["source", "forkedFrom", "clone", "web", "link"] as const;
  const byKind = new Map<string, string[]>();
  for (const tag of tags) {
    if (!Array.isArray(tag) || !tag[0]) continue;
    const kind = String(tag[0]);
    if (
      kind !== "source" &&
      kind !== "forkedFrom" &&
      kind !== "clone" &&
      kind !== "web" &&
      kind !== "link"
    ) {
      continue;
    }
    const values = nip34TagValuesFromRow(tag);
    if (!values.length) continue;
    const prev = byKind.get(kind) || [];
    byKind.set(kind, prev.concat(values));
  }
  for (const kind of preferOrder) {
    for (const raw of byKind.get(kind) || []) {
      if (!looksLikeForeignForgeUrl(raw)) continue;
      return raw;
    }
  }
  return "";
}
