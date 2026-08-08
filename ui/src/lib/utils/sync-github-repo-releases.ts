/**
 * Soft-refresh GitHub Releases into gittr_releases__* (and StoredRepo when present).
 * Releases tab previously only updated StoredRepo — visitors with no Code visit got nothing.
 */
import { parseGitHubRepoSpec } from "@/lib/nostr/nip82-repository-links";
import {
  type StoredRepo,
  loadStoredRepos,
  saveStoredRepos,
} from "@/lib/repos/storage";
import {
  getRepoStorageKey,
  readRepoReleasesFromLocalStorage,
} from "@/lib/utils/entity-normalizer";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";

export type SyncedGithubRelease = {
  name: string;
  tag_name: string;
  body?: string;
  published_at?: string;
  html_url?: string;
  author?: { login: string; avatar_url?: string };
  prerelease?: boolean;
  source?: "github" | "git-tag";
};

function mergeReleasesByTag(
  local: SyncedGithubRelease[],
  fromGithub: SyncedGithubRelease[]
): SyncedGithubRelease[] {
  const byTag = new Map<string, SyncedGithubRelease>();
  for (const r of local) {
    const tag = (r.tag_name || "").trim();
    if (!tag) continue;
    byTag.set(tag.toLowerCase(), r);
  }
  for (const r of fromGithub) {
    const tag = (r.tag_name || "").trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    const prev = byTag.get(key);
    byTag.set(key, {
      ...prev,
      ...r,
      source: r.source || "github",
    });
  }
  return Array.from(byTag.values()).sort((a, b) => {
    const ta = a.published_at ? Date.parse(a.published_at) : 0;
    const tb = b.published_at ? Date.parse(b.published_at) : 0;
    return tb - ta;
  });
}

function persistMergedReleases(
  entity: string,
  repoSlug: string,
  merged: SyncedGithubRelease[]
): void {
  const key = getRepoStorageKey("gittr_releases", entity, repoSlug);
  const payload = JSON.stringify(merged);
  try {
    // No change → no write and no repo-updated dispatch. Hydrate runs this on
    // every repo visit; dispatching unchanged data re-rendered the whole repo
    // page (image flicker) and could re-trigger hydrate listeners.
    if (localStorage.getItem(key) === payload) return;
  } catch {
    /* fall through to write */
  }
  try {
    localStorage.setItem(key, payload);
  } catch (e) {
    console.warn("[Releases] Failed to write gittr_releases__*:", e);
  }

  const repos = loadStoredRepos();
  const idx = repos.findIndex(
    (r) => findRepoByEntityAndName([r], entity, repoSlug) !== undefined
  );
  if (idx >= 0 && repos[idx]) {
    repos[idx] = {
      ...repos[idx]!,
      releases: merged,
    } as StoredRepo;
    saveStoredRepos(repos);
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("gittr:releases-updated"));
    window.dispatchEvent(new Event("gittr:repo-updated"));
  }
}

export async function syncGithubReleasesForRepo(
  entity: string,
  repoSlug: string,
  sourceUrl: string
): Promise<SyncedGithubRelease[] | null> {
  const spec = parseGitHubRepoSpec(sourceUrl);
  if (!spec) return null;

  try {
    const endpoint = `/repos/${spec.owner}/${spec.repo}/releases?per_page=50`;
    const res = await fetch(
      `/api/github/proxy?endpoint=${encodeURIComponent(endpoint)}`
    );
    if (!res.ok) return null;
    const list = (await res.json()) as unknown[];
    if (!Array.isArray(list)) return null;

    const fromGithub: SyncedGithubRelease[] = list
      .map((item) => {
        const r = item as Record<string, unknown>;
        const author = r.author as
          | { login?: string; avatar_url?: string }
          | undefined;
        return {
          name: String(r.name || r.tag_name || ""),
          tag_name: String(r.tag_name || ""),
          body: typeof r.body === "string" ? r.body : undefined,
          published_at:
            typeof r.published_at === "string" ? r.published_at : undefined,
          html_url: typeof r.html_url === "string" ? r.html_url : undefined,
          author: author?.login
            ? { login: author.login, avatar_url: author.avatar_url }
            : undefined,
          prerelease: Boolean(r.prerelease),
          source: "github" as const,
        };
      })
      .filter((r) => r.tag_name);

    if (fromGithub.length === 0) return [];

    const local = readRepoReleasesFromLocalStorage(
      entity,
      repoSlug
    ) as SyncedGithubRelease[];
    const merged = mergeReleasesByTag(local, fromGithub);
    persistMergedReleases(entity, repoSlug, merged);
    return merged;
  } catch (e) {
    console.warn("[Releases] GitHub sync failed:", e);
    return null;
  }
}
