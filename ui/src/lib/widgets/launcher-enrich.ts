/**
 * Background facts for the launcher tiles. Runs from the leaderboard job,
 * not from the phone request: announcement text, Nostr stars, GitHub stars.
 * A miss stays null. Zero is not stored as a star count.
 */
import { KIND_REACTION, KIND_REPOSITORY_NIP34 } from "@/lib/nostr/events";
import { NIP34_DISCOVERY_RELAYS } from "@/lib/nostr/nip34-discovery-relays";
import { isRepoAnnouncementDeleted } from "@/lib/nostr/repo-deleted";
import { isPublicReadFromEvent } from "@/lib/nostr/repo-public-read";
import { aggregateRepoStarReactions } from "@/lib/nostr/repo-stars";
import { withRelayPoolSubscribe } from "@/lib/nostr/server-relay-subscribe";
import { loadSoftwareCatalogSnapshot } from "@/lib/nostr/software-catalog-snapshot";
import type { LeaderboardSnapshot } from "@/lib/platform-leaderboard-snapshot";
import {
  type LauncherEnrichCache,
  saveLauncherEnrichCache,
} from "@/lib/widgets/launcher-enrich-cache";
import {
  descriptionFromAnnouncement,
  githubFromAnnouncementTags,
  parseGithubOwnerRepo,
  safeRepoName,
} from "@/lib/widgets/launcher-feed";
import { resolveDisplayNames } from "@/lib/widgets/launcher-names";

import { nip19 } from "nostr-tools";

const REPO_CAP = 8;
const APP_GITHUB_CAP = 12;

type AnnouncementHit = {
  id: string;
  description: string;
  github: { owner: string; repo: string } | null;
  createdAt: number;
};

function repoKey(owner: string, repoName: string): string {
  return `${owner.toLowerCase()}/${repoName}`;
}

export { loadLauncherEnrichCache } from "@/lib/widgets/launcher-enrich-cache";

function positive(n: number | null | undefined): number | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

async function fetchGithubStars(spec: {
  owner: string;
  repo: string;
}): Promise<number | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "gittr-space",
  };
  const token = process.env.GITHUB_PLATFORM_TOKEN || "";
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(
        spec.owner
      )}/${encodeURIComponent(spec.repo)}`,
      { headers, signal: AbortSignal.timeout(2500) }
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { stargazers_count?: unknown };
    return typeof data.stargazers_count === "number"
      ? positive(data.stargazers_count)
      : null;
  } catch {
    return null;
  }
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let index = 0;
  const workers = Math.max(1, Math.min(concurrency, items.length || 1));
  async function worker() {
    while (index < items.length) {
      const current = index++;
      const item = items[current];
      if (item === undefined) return;
      out[current] = await fn(item);
    }
  }
  if (items.length === 0) return out;
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

async function loadAnnouncements(
  repos: Array<{ entity: string; repoName: string }>
): Promise<Map<string, AnnouncementHit>> {
  const found = new Map<string, AnnouncementHit>();
  if (repos.length === 0) return found;
  const filters = repos.map((repo) => ({
    kinds: [KIND_REPOSITORY_NIP34],
    authors: [repo.entity],
    "#d": [repo.repoName],
    limit: 2,
  }));
  const events: Array<{
    id?: string;
    kind?: number;
    pubkey?: string;
    created_at?: number;
    content?: string;
    tags?: string[][];
  }> = [];
  await withRelayPoolSubscribe(NIP34_DISCOVERY_RELAYS, async (subscribe) => {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3500);
      let eose = 0;
      subscribe(
        filters,
        NIP34_DISCOVERY_RELAYS,
        (event) => {
          events.push(event as (typeof events)[number]);
        },
        undefined,
        () => {
          eose += 1;
          if (eose >= NIP34_DISCOVERY_RELAYS.length) {
            clearTimeout(timer);
            resolve();
          }
        }
      );
    });
  });

  for (const event of events) {
    if (event.kind !== KIND_REPOSITORY_NIP34) continue;
    const owner = String(event.pubkey || "").toLowerCase();
    const dTag = event.tags?.find((tag) => tag[0] === "d")?.[1];
    if (!owner || !dTag) continue;
    if (isRepoAnnouncementDeleted(event)) continue;
    if (!isPublicReadFromEvent(event as never)) continue;
    const key = repoKey(owner, dTag);
    const prev = found.get(key);
    const createdAt = event.created_at || 0;
    if (prev && prev.createdAt >= createdAt) continue;
    const id = String(event.id || "");
    if (!/^[0-9a-f]{64}$/i.test(id)) continue;
    found.set(key, {
      id,
      description: descriptionFromAnnouncement(event),
      github: githubFromAnnouncementTags(event.tags),
      createdAt,
    });
  }
  return found;
}

async function loadNostrStars(ids: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (ids.length === 0) return counts;
  const events: Array<{
    kind?: number;
    pubkey?: string;
    created_at?: number;
    content?: string;
    tags?: string[][];
    id?: string;
  }> = [];
  await withRelayPoolSubscribe(NIP34_DISCOVERY_RELAYS, async (subscribe) => {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3500);
      let eose = 0;
      subscribe(
        [{ kinds: [KIND_REACTION], "#e": ids, limit: 500 }],
        NIP34_DISCOVERY_RELAYS,
        (event) => {
          events.push(event as (typeof events)[number]);
        },
        undefined,
        () => {
          eose += 1;
          if (eose >= NIP34_DISCOVERY_RELAYS.length) {
            clearTimeout(timer);
            resolve();
          }
        }
      );
    });
  });

  for (const id of ids) {
    const mine = events.filter((event) =>
      event.tags?.some(
        (tag) => tag[0] === "e" && tag[1]?.toLowerCase() === id.toLowerCase()
      )
    );
    const { count } = aggregateRepoStarReactions(mine as never);
    const stars = positive(count);
    if (stars != null) counts.set(id.toLowerCase(), stars);
  }
  return counts;
}

function topRepos(snap: LeaderboardSnapshot) {
  return [...(snap.topRepos || [])]
    .filter(
      (repo) =>
        /^[0-9a-f]{64}$/i.test(repo.entity || "") &&
        !!safeRepoName(repo.repoName) &&
        (repo.activityCount || 0) > 0
    )
    .sort((a, b) => (b.activityCount || 0) - (a.activityCount || 0))
    .slice(0, REPO_CAP)
    .map((repo) => ({
      entity: repo.entity.toLowerCase(),
      repoName: safeRepoName(repo.repoName),
    }));
}

export async function warmLauncherWidgetEnrichment(
  snap: LeaderboardSnapshot
): Promise<LauncherEnrichCache> {
  const repos = topRepos(snap);
  const pubkeys = [
    ...repos.map((repo) => repo.entity),
    ...(snap.topUsers || []).map((user) => user.pubkey),
  ];
  try {
    await resolveDisplayNames(pubkeys);
  } catch (error) {
    console.warn("[launcher-widget] names skipped", error);
  }

  let announcements = new Map<string, AnnouncementHit>();
  try {
    announcements = await loadAnnouncements(repos);
  } catch (error) {
    console.warn("[launcher-widget] announcements skipped", error);
  }

  let starCounts = new Map<string, number>();
  try {
    starCounts = await loadNostrStars(
      [...announcements.values()].map((hit) => hit.id)
    );
  } catch (error) {
    console.warn("[launcher-widget] nostr stars skipped", error);
  }

  const githubSpecs = new Map<string, { owner: string; repo: string }>();
  for (const hit of announcements.values()) {
    if (!hit.github) continue;
    githubSpecs.set(
      `${hit.github.owner.toLowerCase()}/${hit.github.repo.toLowerCase()}`,
      hit.github
    );
  }

  const catalog = await loadSoftwareCatalogSnapshot();
  const newestGithubApps = [...(catalog?.apps || [])]
    .filter((app) => parseGithubOwnerRepo(app.repository))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, APP_GITHUB_CAP);
  for (const app of newestGithubApps) {
    const spec = parseGithubOwnerRepo(app.repository);
    if (!spec) continue;
    githubSpecs.set(
      `${spec.owner.toLowerCase()}/${spec.repo.toLowerCase()}`,
      spec
    );
  }

  const githubStars = new Map<string, number | null>();
  await mapPool([...githubSpecs.entries()], 4, async ([key, spec]) => {
    githubStars.set(key, await fetchGithubStars(spec));
  });

  const repoOut: LauncherEnrichCache["repos"] = {};
  for (const repo of repos) {
    const key = repoKey(repo.entity, repo.repoName);
    const hit = announcements.get(key);
    const ghKey = hit?.github
      ? `${hit.github.owner.toLowerCase()}/${hit.github.repo.toLowerCase()}`
      : "";
    repoOut[key] = {
      description: hit?.description || "",
      nostrStars: hit ? starCounts.get(hit.id.toLowerCase()) ?? null : null,
      githubStars: ghKey ? githubStars.get(ghKey) ?? null : null,
    };
  }

  const appOut: LauncherEnrichCache["apps"] = {};
  for (const app of newestGithubApps) {
    const spec = parseGithubOwnerRepo(app.repository);
    if (!spec || !app.appId) continue;
    const ghKey = `${spec.owner.toLowerCase()}/${spec.repo.toLowerCase()}`;
    let nostrStars: number | null = null;
    if (app.gittrRepoPath) {
      const match = app.gittrRepoPath.match(/^\/(npub1[a-z0-9]+)\/([^/]+)$/i);
      if (match?.[1] && match[2]) {
        try {
          const decoded = nip19.decode(match[1]);
          if (decoded.type === "npub" && typeof decoded.data === "string") {
            const linked =
              repoOut[repoKey(decoded.data, decodeURIComponent(match[2]))];
            nostrStars = linked?.nostrStars ?? null;
          }
        } catch {
          /* not a gittr npub path */
        }
      }
    }
    appOut[app.appId] = {
      nostrStars,
      githubStars: githubStars.get(ghKey) ?? null,
    };
  }

  const cache: LauncherEnrichCache = {
    at: Date.now(),
    repos: repoOut,
    apps: appOut,
  };
  await saveLauncherEnrichCache(cache);
  return cache;
}
