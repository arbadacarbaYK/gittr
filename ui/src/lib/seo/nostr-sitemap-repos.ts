import { KIND_REPOSITORY, KIND_REPOSITORY_NIP34 } from "@/lib/nostr/events";
import { getDefaultRelayUrls } from "@/lib/nostr/relay-env";

import { type Event, SimplePool, nip19 } from "nostr-tools";

const SITEMAP_RELAY_TIMEOUT_MS = 45_000;
const REPO_QUERY_LIMIT = 12_000;
const DELETION_QUERY_LIMIT = 8_000;

function getTag(ev: Event, name: string): string | undefined {
  for (const t of ev.tags || []) {
    if (t[0] === name && typeof t[1] === "string" && t[1].length > 0) {
      return t[1];
    }
  }
  return undefined;
}

function collectDeletionRefs(events: Event[]): {
  eventIds: Set<string>;
  addresses: Set<string>;
} {
  const eventIds = new Set<string>();
  const addresses = new Set<string>();
  for (const ev of events) {
    for (const t of ev.tags || []) {
      if (t[0] === "e" && t[1]) eventIds.add(t[1]);
      if (t[0] === "a" && t[1]) addresses.add(t[1]);
    }
  }
  return { eventIds, addresses };
}

function isDeletedNip34(ev: Event, addresses: Set<string>): boolean {
  const d = getTag(ev, "d");
  if (!d) return false;
  const coord = `30617:${ev.pubkey}:${d}`;
  if (addresses.has(coord)) return true;
  const a = getTag(ev, "a");
  if (a && addresses.has(a)) return true;
  return false;
}

function parseKind51RepoName(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }
  try {
    const repoData = JSON.parse(content) as { repositoryName?: string };
    const name = repoData.repositoryName?.trim();
    return name && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

/**
 * Returns `npub1…/repo-slug` lines discovered from Nostr (kinds 51 + 30617),
 * suitable for sitemap URLs. Empty if relays are not configured or query fails.
 */
export async function fetchSitemapRepoPathsFromNostr(): Promise<
  Map<string, number>
> {
  const relays = getDefaultRelayUrls();
  if (
    relays.length === 0 ||
    process.env.SITEMAP_SKIP_NOSTR === "1" ||
    process.env.SITEMAP_SKIP_NOSTR === "true"
  ) {
    return new Map();
  }

  const pool = new SimplePool({
    eoseSubTimeout: SITEMAP_RELAY_TIMEOUT_MS,
    getTimeout: SITEMAP_RELAY_TIMEOUT_MS,
  });

  try {
    const [repoEvents, deletionEvents] = await Promise.all([
      pool.list(relays, [
        {
          kinds: [KIND_REPOSITORY, KIND_REPOSITORY_NIP34],
          limit: REPO_QUERY_LIMIT,
        },
      ]),
      pool.list(relays, [{ kinds: [5], limit: DELETION_QUERY_LIMIT }]),
    ]);

    const { eventIds: deletedIds, addresses: deletedAddresses } =
      collectDeletionRefs(deletionEvents);

    const byId = new Map<string, Event>();
    for (const ev of repoEvents) {
      if (!byId.has(ev.id)) byId.set(ev.id, ev);
    }
    const unique = [...byId.values()];

    const nip34ByKey = new Map<string, Event>();
    const kind51ByKey = new Map<string, Event>();

    for (const ev of unique) {
      const kind = ev.kind as number;
      if (kind === KIND_REPOSITORY_NIP34) {
        const d = getTag(ev, "d");
        if (!d) continue;
        const key = `${ev.pubkey}:${d}`;
        const prev = nip34ByKey.get(key);
        if (!prev || (ev.created_at || 0) > (prev.created_at || 0)) {
          nip34ByKey.set(key, ev);
        }
      } else if (kind === KIND_REPOSITORY) {
        const name = parseKind51RepoName(ev.content);
        if (!name) continue;
        const key = `${ev.pubkey}:${name}`;
        const prev = kind51ByKey.get(key);
        if (!prev || (ev.created_at || 0) > (prev.created_at || 0)) {
          kind51ByKey.set(key, ev);
        }
      }
    }

    const pathToModified = new Map<string, number>();

    for (const ev of nip34ByKey.values()) {
      if (deletedIds.has(ev.id)) continue;
      if (isDeletedNip34(ev, deletedAddresses)) continue;
      const d = getTag(ev, "d");
      if (!d) continue;
      try {
        const npub = nip19.npubEncode(ev.pubkey);
        const line = `${npub}/${d}`;
        const ts = (ev.created_at || 0) * 1000;
        const prev = pathToModified.get(line);
        if (prev === undefined || ts > prev) pathToModified.set(line, ts);
      } catch {
        /* skip bad pubkey */
      }
    }

    for (const ev of kind51ByKey.values()) {
      if (deletedIds.has(ev.id)) continue;
      const name = parseKind51RepoName(ev.content);
      if (!name) continue;
      try {
        const npub = nip19.npubEncode(ev.pubkey);
        const line = `${npub}/${name}`;
        const ts = (ev.created_at || 0) * 1000;
        const prev = pathToModified.get(line);
        if (prev === undefined || ts > prev) pathToModified.set(line, ts);
      } catch {
        /* skip */
      }
    }

    return pathToModified;
  } catch (err) {
    console.error("[sitemap] Nostr repo index failed:", err);
    return new Map();
  } finally {
    try {
      pool.close(relays);
    } catch {
      /* ignore */
    }
  }
}
