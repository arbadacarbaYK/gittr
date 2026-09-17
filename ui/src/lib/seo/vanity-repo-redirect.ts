import { nip19 } from "nostr-tools";

import {
  type Kind0NameSource,
  normalizeKind0NameFields,
} from "../nostr/kind0-profile-fields";

import { loadNostrSeoReposSnapshot } from "./nostr-seo-repos-snapshot";
import {
  decodeOgOwnerPubkey,
  fetchPubkeysByRepoDTag,
  pubkeysFromSeoRepoPaths,
} from "./og-owner-pubkey";

const VANITY_CACHE_MS = 5 * 60 * 1000;
const vanityPkCache = new Map<string, { pk: string | null; at: number }>();

function decodePathname(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

/** Path after `/{entity}/{repo}` (`/issues`, `/commits/abc`, or ""). */
export function repoPathAfterEntityRepo(
  pathname: string,
  entity: string,
  repo: string
): string {
  const decoded = decodePathname(pathname || "");
  const prefixes = [
    `/${entity}/${repo}`,
    `/${encodeURIComponent(entity)}/${encodeURIComponent(repo)}`,
  ];
  for (const prefix of prefixes) {
    if (decoded === prefix) return "";
    if (decoded.startsWith(`${prefix}/`)) return decoded.slice(prefix.length);
  }
  return "";
}

export function isOgImageRepoSuffix(suffixOrPath: string): boolean {
  return /(?:^|\/)(opengraph-image|twitter-image)(?:\/|$|\?)/.test(
    suffixOrPath || ""
  );
}

export function canonicalNpubRepoPath(
  pubkeyHex: string,
  repo: string,
  suffix = "",
  search = ""
): string {
  const npub = nip19.npubEncode(pubkeyHex);
  const path = `/${npub}/${encodeURIComponent(repo)}${suffix || ""}`;
  return `${path}${search || ""}`;
}

export function profileNamesMatchEntity(
  meta: Kind0NameSource | null | undefined,
  entity: string
): boolean {
  const want = (entity || "").trim().toLowerCase();
  if (!want) return false;
  const { name, display_name } = normalizeKind0NameFields(meta);
  return [name, display_name].some(
    (n) => (n || "").trim().toLowerCase() === want
  );
}

/**
 * Owner hex for a vanity `/DisplayName/repo` URL, or null when the entity is
 * already npub/hex, the name is ambiguous, or the profile name does not match.
 * Unique SEO/`#d` hits still redirect when kind 0 never arrives.
 */
export async function resolveVanityRepoPubkey(
  entity: string,
  repoName: string,
  timeoutMs = 900
): Promise<string | null> {
  if (decodeOgOwnerPubkey(entity)) return null;
  const repo = (repoName || "").trim();
  const handle = (entity || "").trim();
  if (!handle || !repo) return null;
  const cacheKey = `${handle.toLowerCase()}::${repo.toLowerCase()}`;
  const hit = vanityPkCache.get(cacheKey);
  if (hit && Date.now() - hit.at < VANITY_CACHE_MS) return hit.pk;

  const candidates = new Set<string>();
  try {
    const snap = await loadNostrSeoReposSnapshot({ allowStale: true });
    for (const pk of pubkeysFromSeoRepoPaths(snap?.paths || {}, repo)) {
      candidates.add(pk);
    }
  } catch {
    /* ignore */
  }
  if (candidates.size !== 1) {
    for (const pk of await fetchPubkeysByRepoDTag(repo, timeoutMs)) {
      candidates.add(pk);
    }
  }

  let chosen: string | null = null;
  if (candidates.size === 1) {
    const only = [...candidates][0]!;
    try {
      const { fetchUserMetadata } = await import(
        "../nostr/fetch-metadata-server"
      );
      const meta = await Promise.race([
        fetchUserMetadata(only),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 600)),
      ]);
      if (!meta || profileNamesMatchEntity(meta as Kind0NameSource, handle))
        chosen = only;
    } catch {
      chosen = only;
    }
  } else if (candidates.size > 1) {
    try {
      const { fetchUserMetadata } = await import(
        "../nostr/fetch-metadata-server"
      );
      const matches: string[] = [];
      await Promise.all(
        [...candidates].slice(0, 8).map(async (pk) => {
          const meta = await Promise.race([
            fetchUserMetadata(pk),
            new Promise<null>((resolve) =>
              setTimeout(() => resolve(null), 600)
            ),
          ]);
          if (profileNamesMatchEntity(meta as Kind0NameSource | null, handle))
            matches.push(pk);
        })
      );
      if (matches.length === 1) chosen = matches[0]!;
    } catch {
      /* leave chosen null */
    }
  }

  vanityPkCache.set(cacheKey, { pk: chosen, at: Date.now() });
  return chosen;
}

/** 307 `/DisplayName/repo…` → `/npub1…/repo…` so Code/files/Push share one URL. */
export async function maybeRedirectVanityRepo(
  entity: string,
  repo: string
): Promise<void> {
  const pk = await resolveVanityRepoPubkey(entity, repo);
  if (!pk) return;
  const { headers } = await import("next/headers");
  const { redirect } = await import("next/navigation");
  const h = await headers();
  const pathname = h.get("x-gittr-pathname") || "";
  const search = h.get("x-gittr-search") || "";
  const suffix = repoPathAfterEntityRepo(pathname, entity, repo);
  if (isOgImageRepoSuffix(suffix) || isOgImageRepoSuffix(pathname)) return;
  redirect(canonicalNpubRepoPath(pk, repo, suffix, search));
}
