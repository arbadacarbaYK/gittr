import { nip19 } from "nostr-tools";

import { isUnusableRepositoryDescription } from "../repos/repo-about-text";

import { loadNostrSeoReposSnapshot } from "./nostr-seo-repos-snapshot";

const KIND_REPOSITORY = 51;
const KIND_REPOSITORY_NIP34 = 30617;

const OG_OWNER_RELAYS = [
  "wss://relay.gittr.space",
  "wss://relay.ngit.dev",
  "wss://gitnostr.com",
  "wss://nos.lol",
];

export function decodeOgOwnerPubkey(entity: string): string | null {
  if (/^[0-9a-f]{64}$/i.test(entity)) return entity.toLowerCase();
  if (entity.startsWith("npub")) {
    try {
      const decoded = nip19.decode(entity);
      if (decoded.type === "npub") {
        return (decoded.data as string).toLowerCase();
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function npubsFromSeoRepoPaths(
  paths: Record<string, number>,
  repoName: string
): string[] {
  const want = repoName.trim().toLowerCase();
  if (!want) return [];
  const npubs: string[] = [];
  for (const p of Object.keys(paths || {})) {
    const i = p.lastIndexOf("/");
    if (i < 1) continue;
    const npub = p.slice(0, i);
    const name = p.slice(i + 1);
    if (name.toLowerCase() === want && npub.startsWith("npub1")) {
      npubs.push(npub);
    }
  }
  return [...new Set(npubs)];
}

function hexFromNpub(npub: string): string | null {
  try {
    const decoded = nip19.decode(npub);
    if (decoded.type === "npub") return (decoded.data as string).toLowerCase();
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Unique `npub1…/repo` in the SEO snapshot. Vanity URLs like /DrShift/buho-go
 * are not npubs — crawlers still need the hex to load About.
 */
export function pubkeyFromSeoRepoPaths(
  paths: Record<string, number>,
  repoName: string
): string | null {
  const unique = npubsFromSeoRepoPaths(paths, repoName);
  if (unique.length !== 1) return null;
  return hexFromNpub(unique[0]!);
}

/** Every owner hex that the SEO snapshot lists for this repo name. */
export function pubkeysFromSeoRepoPaths(
  paths: Record<string, number>,
  repoName: string
): string[] {
  return npubsFromSeoRepoPaths(paths, repoName)
    .map((npub) => hexFromNpub(npub))
    .filter((pk): pk is string => !!pk);
}

export function mergeOgDescriptions(
  newer: string | null | undefined,
  older: string | null | undefined,
  repoName: string
): string | null {
  const n = (newer || "").trim();
  const o = (older || "").trim();
  if (n && !isUnusableRepositoryDescription(n, repoName)) return n;
  if (o && !isUnusableRepositoryDescription(o, repoName)) return o;
  return null;
}

async function collectPubkeysByRepoDTag(
  repoName: string,
  timeoutMs: number
): Promise<Map<string, { at: number; n: number }>> {
  try {
    const { RelayPool } = await import("nostr-relaypool");
    const pool = new RelayPool(OG_OWNER_RELAYS, { dontAutoReconnect: true });
    return await new Promise<Map<string, { at: number; n: number }>>(
      (resolve) => {
        let settled = false;
        const counts = new Map<string, { at: number; n: number }>();
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try {
            pool.close();
          } catch {
            /* ignore */
          }
          resolve(counts);
        };
        const timer = setTimeout(finish, timeoutMs);
        try {
          pool.subscribe(
            [
              {
                kinds: [KIND_REPOSITORY, KIND_REPOSITORY_NIP34],
                "#d": [repoName],
                limit: 20,
              },
            ],
            OG_OWNER_RELAYS,
            (event: { pubkey?: string; created_at?: number }) => {
              const pk =
                typeof event.pubkey === "string"
                  ? event.pubkey.toLowerCase()
                  : "";
              if (!/^[0-9a-f]{64}$/.test(pk)) return;
              const at =
                typeof event.created_at === "number" ? event.created_at : 0;
              const prev = counts.get(pk);
              counts.set(pk, {
                at: Math.max(prev?.at || 0, at),
                n: (prev?.n || 0) + 1,
              });
              if (counts.size === 1 && (prev?.n || 0) + 1 >= 2) {
                finish();
              }
            }
          );
        } catch {
          finish();
        }
      }
    );
  } catch {
    return new Map();
  }
}

function pickPubkeyFromCounts(
  counts: Map<string, { at: number; n: number }>
): string | null {
  let best: { pk: string; at: number; n: number } | null = null;
  for (const [pk, v] of counts) {
    if (!best || v.n > best.n || (v.n === best.n && v.at > best.at)) {
      best = { pk, at: v.at, n: v.n };
    }
  }
  return counts.size === 1 ? [...counts.keys()][0]! : best?.pk || null;
}

async function fetchPubkeyByRepoDTag(
  repoName: string,
  timeoutMs: number
): Promise<string | null> {
  return pickPubkeyFromCounts(
    await collectPubkeysByRepoDTag(repoName, timeoutMs)
  );
}

export async function fetchPubkeysByRepoDTag(
  repoName: string,
  timeoutMs: number
): Promise<string[]> {
  return [...(await collectPubkeysByRepoDTag(repoName, timeoutMs)).keys()];
}

/** Hex/npub, else unique SEO path, else a short `#d` relay lookup. */
export async function resolveOgOwnerPubkey(
  entity: string,
  repoName: string,
  timeoutMs = 900
): Promise<string | null> {
  const direct = decodeOgOwnerPubkey(entity);
  if (direct) return direct;
  try {
    const snap = await loadNostrSeoReposSnapshot({ allowStale: true });
    const fromSnap = pubkeyFromSeoRepoPaths(snap?.paths || {}, repoName);
    if (fromSnap) return fromSnap;
  } catch {
    /* ignore */
  }
  return fetchPubkeyByRepoDTag(repoName, timeoutMs);
}
