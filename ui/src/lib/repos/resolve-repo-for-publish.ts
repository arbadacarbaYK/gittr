/**
 * Resolve repo context for publishing NIP-34 issues/PRs.
 *
 * Prefer local cache (fast), but never require it — strangers filing issues on
 * a repo they only opened via URL must still resolve owner pubkey from the
 * path entity (npub / hex / NIP-05). Optionally hydrate `d` / euc from kind 30617.
 */
import { getDefaultRelayUrls } from "../nostr/relay-env";
import { repoAnnouncementDTagCandidates } from "../nostr/repo-stars";
import { PLATFORM_STATS_RELAYS } from "../nostr/server-relay-subscribe";
import { loadStoredRepos } from "./storage";
import {
  getRepoOwnerPubkey,
  resolveEntityToPubkeyAsync,
} from "../utils/entity-resolver";
import { findRepoByEntityAndNameAsync } from "../utils/repo-finder";

const KIND_REPOSITORY_NIP34 = 30617;

export type RepoPublishContext = {
  entity: string;
  /** URL / display repo slug */
  repo: string;
  /** Canonical NIP-34 d-tag / repositoryName when known */
  repositoryName: string;
  ownerPubkey: string;
  earliestUniqueCommit?: string;
  defaultBranch?: string;
  /** True when a matching row existed in gittr_repos localStorage */
  fromStorage: boolean;
  /** Mutable localStorage row when fromStorage (for cache warm-ups) */
  storedRepo?: Record<string, unknown>;
};

export type AnnouncementHydration = {
  repositoryName?: string;
  earliestUniqueCommit?: string;
  defaultBranch?: string;
};

export type ResolveRepoForPublishOptions = {
  /** Injected 30617 lookup (tests / custom pools). Default: short SimplePool query. */
  fetchAnnouncement?: (
    ownerPubkey: string,
    repoSlug: string
  ) => Promise<AnnouncementHydration | null>;
  timeoutMs?: number;
};

/** Parse NIP-34 announcement tags we need for issue/PR publish. */
export function parseAnnouncementHydration(
  tags: string[][] | undefined
): AnnouncementHydration {
  const out: AnnouncementHydration = {};
  if (!Array.isArray(tags)) return out;

  let nameTag = "";
  for (const tag of tags) {
    if (!Array.isArray(tag) || tag.length < 2) continue;
    const [name, value, marker] = tag;
    if (name === "d" && value) {
      out.repositoryName = value;
    } else if (name === "name" && value) {
      nameTag = value;
    } else if (name === "r" && value && marker === "euc") {
      out.earliestUniqueCommit = value;
    } else if (name === "r" && value && !out.earliestUniqueCommit) {
      // Some clients omit the euc marker; keep first commit-ish r as soft fallback
      if (/^[0-9a-f]{40,64}$/i.test(value)) {
        out.earliestUniqueCommit = value;
      }
    }
  }
  if (!out.repositoryName && nameTag) {
    out.repositoryName = nameTag;
  }
  return out;
}

function eventMatchesD(
  tags: string[][] | undefined,
  author: string,
  dCandidates: string[]
): boolean {
  if (!Array.isArray(tags)) return false;
  const d = tags.find((t) => t[0] === "d")?.[1]?.trim();
  if (d && dCandidates.includes(d)) return true;
  const want = new Set(
    dCandidates.map((name) => `30617:${author}:${name}`.toLowerCase())
  );
  for (const t of tags) {
    if (t[0] === "a" && typeof t[1] === "string" && want.has(t[1].toLowerCase())) {
      return true;
    }
  }
  return false;
}

async function defaultFetchAnnouncement(
  ownerPubkey: string,
  repoSlug: string,
  timeoutMs: number
): Promise<AnnouncementHydration | null> {
  const author = ownerPubkey.toLowerCase();
  const dCandidates = repoAnnouncementDTagCandidates(repoSlug);
  if (!/^[0-9a-f]{64}$/.test(author) || dCandidates.length === 0) return null;

  const relays = [
    ...new Set([
      ...PLATFORM_STATS_RELAYS,
      ...getDefaultRelayUrls(),
      "wss://relay.gittr.space",
    ]),
  ].filter((r) => r.startsWith("wss://"));
  if (relays.length === 0) return null;

  try {
    const { SimplePool } = await import("nostr-tools");
    const pool = new SimplePool();
    try {
      const events = await Promise.race([
        pool.list(relays, [
          {
            kinds: [KIND_REPOSITORY_NIP34],
            authors: [author],
            limit: 40,
          },
        ]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("announcement timeout")), timeoutMs)
        ),
      ]);

      let latest: { created_at?: number; tags?: string[][] } | null = null;
      for (const event of events || []) {
        if ((event as { kind?: number }).kind !== KIND_REPOSITORY_NIP34) continue;
        if (
          !eventMatchesD(
            (event as { tags?: string[][] }).tags,
            author,
            dCandidates
          )
        ) {
          continue;
        }
        if (
          !latest ||
          ((event as { created_at?: number }).created_at || 0) >=
            (latest.created_at || 0)
        ) {
          latest = event as { created_at?: number; tags?: string[][] };
        }
      }
      if (!latest) return null;
      return parseAnnouncementHydration(latest.tags);
    } finally {
      try {
        pool.close(relays);
      } catch {
        /* ignore */
      }
    }
  } catch {
    return null;
  }
}

export async function resolveRepoForPublish(
  entity: string,
  repo: string,
  opts?: ResolveRepoForPublishOptions
): Promise<RepoPublishContext | null> {
  const trimmedEntity = entity?.trim();
  const trimmedRepo = repo?.trim();
  if (!trimmedEntity || !trimmedRepo) return null;

  const timeoutMs = opts?.timeoutMs ?? 6000;
  const fetchAnnouncement =
    opts?.fetchAnnouncement ??
    ((owner: string, slug: string) =>
      defaultFetchAnnouncement(owner, slug, timeoutMs));

  const repos = loadStoredRepos();
  const found = await findRepoByEntityAndNameAsync(
    repos as Array<{
      entity?: string;
      repo?: string;
      slug?: string;
      name?: string;
      ownerPubkey?: string;
      repositoryName?: string;
      earliestUniqueCommit?: string;
      defaultBranch?: string;
    }>,
    trimmedEntity,
    trimmedRepo
  );

  if (found) {
    let ownerPubkey =
      getRepoOwnerPubkey(found, trimmedEntity) ||
      (await resolveEntityToPubkeyAsync(trimmedEntity, found)) ||
      "";
    ownerPubkey = ownerPubkey.toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(ownerPubkey)) return null;

    let repositoryName =
      (typeof found.repositoryName === "string" &&
        found.repositoryName.trim()) ||
      trimmedRepo;
    let earliestUniqueCommit =
      typeof found.earliestUniqueCommit === "string"
        ? found.earliestUniqueCommit
        : undefined;
    const defaultBranch =
      typeof found.defaultBranch === "string"
        ? found.defaultBranch
        : undefined;

    // Fill missing euc / canonical name from relays when cache is thin
    if (!earliestUniqueCommit || repositoryName === trimmedRepo) {
      const hydrated = await fetchAnnouncement(ownerPubkey, trimmedRepo);
      if (hydrated?.repositoryName) repositoryName = hydrated.repositoryName;
      if (!earliestUniqueCommit && hydrated?.earliestUniqueCommit) {
        earliestUniqueCommit = hydrated.earliestUniqueCommit;
      }
    }

    return {
      entity: trimmedEntity,
      repo: trimmedRepo,
      repositoryName,
      ownerPubkey,
      earliestUniqueCommit,
      defaultBranch,
      fromStorage: true,
      storedRepo: found as Record<string, unknown>,
    };
  }

  const ownerPubkey = (
    (await resolveEntityToPubkeyAsync(trimmedEntity)) || ""
  ).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(ownerPubkey)) return null;

  const hydrated = await fetchAnnouncement(ownerPubkey, trimmedRepo);

  return {
    entity: trimmedEntity,
    repo: trimmedRepo,
    repositoryName: hydrated?.repositoryName?.trim() || trimmedRepo,
    ownerPubkey,
    earliestUniqueCommit: hydrated?.earliestUniqueCommit,
    defaultBranch: hydrated?.defaultBranch,
    fromStorage: false,
  };
}
