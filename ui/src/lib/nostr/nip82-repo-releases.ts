/**
 * Match / merge NIP-82 software releases onto a NIP-34 repo Releases tab.
 * Forge API rows and Nostr (Blossom) rows share the same UI Release shape.
 */

import {
  type NostrEventLike,
  type ParsedSoftwareAsset,
  type ParsedSoftwareRelease,
  mimeToKindLabel,
  parseSoftwareAsset,
  parseSoftwareRelease,
  platformHintToLabel,
  readTag,
  readTagAll,
} from "./nip82-software";

/** Normalize for comparing repo names / app ids ("MORP-Box" ↔ "MORP Box"). */
export function normalizeRepoAppToken(raw: string): string {
  return (raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function nip34AddressForRepo(
  ownerPubkeyHex: string,
  repoName: string
): string | null {
  const owner = (ownerPubkeyHex || "").trim().toLowerCase();
  const repo = (repoName || "").trim();
  if (!/^[0-9a-f]{64}$/.test(owner) || !repo) return null;
  return `30617:${owner}:${repo}`;
}

/**
 * True when a kind 30063 release belongs to this repo / owner.
 * Matches: `a` = 30617:owner:repo, fuzzy `i` / `d` vs repo name, optional app id hint.
 */
export function softwareReleaseMatchesRepo(
  release: ParsedSoftwareRelease,
  opts: {
    ownerPubkeyHex: string;
    repoName: string;
    /** Optional announced app id (kind 32267 `d`) from local repo cache. */
    announcedAppId?: string;
  }
): boolean {
  const owner = (opts.ownerPubkeyHex || "").trim().toLowerCase();
  const repo = (opts.repoName || "").trim();
  if (!owner || !repo) return false;
  if (release.pubkey.toLowerCase() !== owner) return false;

  const expectedA = nip34AddressForRepo(owner, repo);
  const aTags = readTagAll(release.raw, "a").map((x) => x.trim().toLowerCase());
  if (expectedA && aTags.some((a) => a === expectedA.toLowerCase())) {
    return true;
  }

  const announced = (opts.announcedAppId || "").trim();
  if (announced && release.appId === announced) return true;

  const repoTok = normalizeRepoAppToken(repo);
  if (!repoTok) return false;
  const candidates = [release.appId, release.d, readTag(release.raw, "name")]
    .filter(Boolean)
    .map((x) => normalizeRepoAppToken(String(x)));
  return candidates.some((c) => c === repoTok || c.includes(repoTok) || repoTok.includes(c));
}

export type RepoReleaseListItem = {
  name: string;
  tag_name: string;
  body?: string;
  published_at?: string;
  html_url?: string;
  author?: {
    login: string;
    avatar_url?: string;
    pubkey?: string;
    picture?: string;
  };
  assets?: Array<{
    name: string;
    platform: string;
    url?: string;
    size?: number;
    contentType?: string;
    sha256?: string;
  }>;
  prerelease?: boolean;
  /** Present when row came from kind 30063. */
  nostrReleaseId?: string;
  source?: "forge" | "nostr" | "local";
};

function assetFileName(asset: ParsedSoftwareAsset): string {
  if (asset.url) {
    try {
      const path = new URL(asset.url).pathname;
      const base = path.split("/").filter(Boolean).pop();
      if (base) return decodeURIComponent(base);
    } catch {
      /* ignore */
    }
  }
  const plat = asset.platforms[0] || mimeToKindLabel(asset.mime) || "bin";
  return `${asset.appId || "asset"}-${asset.version || "rel"}-${plat}`;
}

function assetPlatformLabel(asset: ParsedSoftwareAsset): string {
  for (const f of asset.platforms) {
    const lbl = platformHintToLabel(f);
    if (lbl) return lbl.toLowerCase();
  }
  const mimeLbl = mimeToKindLabel(asset.mime);
  if (mimeLbl) return mimeLbl.toLowerCase();
  return "other";
}

export function mapSoftwareReleaseToRepoRelease(
  release: ParsedSoftwareRelease,
  assets: ParsedSoftwareAsset[]
): RepoReleaseListItem {
  return {
    name: release.version,
    tag_name: release.version,
    body: release.content || undefined,
    published_at: new Date(release.createdAt * 1000).toISOString(),
    author: {
      login: "nostr",
      pubkey: release.pubkey,
    },
    assets: assets.map((a) => ({
      name: assetFileName(a),
      platform: assetPlatformLabel(a),
      url: a.url,
      contentType: a.mime,
      sha256: a.sha256,
    })),
    prerelease: (release.channel || "main") !== "main",
    nostrReleaseId: release.raw.id,
    source: "nostr",
  };
}

/** Prefer forge/local rows when the same tag exists; append Nostr-only versions. */
export function mergeForgeAndNostrReleases(
  existing: RepoReleaseListItem[],
  nostrRows: RepoReleaseListItem[]
): RepoReleaseListItem[] {
  const byTag = new Map<string, RepoReleaseListItem>();
  for (const r of existing) {
    const tag = (r.tag_name || "").trim().toLowerCase();
    if (!tag) continue;
    byTag.set(tag, { ...r, source: r.source || "forge" });
  }
  for (const r of nostrRows) {
    const tag = (r.tag_name || "").trim().toLowerCase();
    if (!tag) continue;
    if (byTag.has(tag)) {
      const prev = byTag.get(tag)!;
      // Enrich forge row with Blossom URLs when forge listed the tag without assets.
      if (
        (!prev.assets || prev.assets.length === 0) &&
        r.assets &&
        r.assets.length > 0
      ) {
        byTag.set(tag, {
          ...prev,
          assets: r.assets,
          nostrReleaseId: r.nostrReleaseId || prev.nostrReleaseId,
        });
      }
      continue;
    }
    byTag.set(tag, r);
  }
  return Array.from(byTag.values()).sort((a, b) => {
    const ta = a.published_at ? Date.parse(a.published_at) : 0;
    const tb = b.published_at ? Date.parse(b.published_at) : 0;
    return tb - ta;
  });
}

/** Collect kind 3063 ids + optional relay hints from `e` tags on a release. */
export function assetIdsAndRelayHintsFromRelease(
  release: ParsedSoftwareRelease
): { ids: string[]; relayHints: string[] } {
  const ids: string[] = [];
  const relays = new Set<string>();
  for (const t of release.raw.tags || []) {
    if (t[0] !== "e" || typeof t[1] !== "string") continue;
    if (!/^[0-9a-f]{64}$/i.test(t[1])) continue;
    ids.push(t[1]);
    const hint = typeof t[2] === "string" ? t[2].trim() : "";
    if (hint.startsWith("wss://") || hint.startsWith("ws://")) {
      relays.add(hint.replace(/\/$/, ""));
    }
  }
  return { ids, relayHints: Array.from(relays) };
}

export function parseMatchingRepoReleases(
  events: NostrEventLike[],
  opts: {
    ownerPubkeyHex: string;
    repoName: string;
    announcedAppId?: string;
  }
): ParsedSoftwareRelease[] {
  const out: ParsedSoftwareRelease[] = [];
  const seen = new Set<string>();
  for (const ev of events) {
    const parsed = parseSoftwareRelease(ev);
    if (!parsed) continue;
    if (!softwareReleaseMatchesRepo(parsed, opts)) continue;
    if (seen.has(parsed.raw.id)) continue;
    seen.add(parsed.raw.id);
    out.push(parsed);
  }
  return out;
}

export function parseAssetsById(
  events: NostrEventLike[]
): Map<string, ParsedSoftwareAsset> {
  const map = new Map<string, ParsedSoftwareAsset>();
  for (const ev of events) {
    const a = parseSoftwareAsset(ev);
    if (!a) continue;
    map.set(a.id, a);
  }
  return map;
}
