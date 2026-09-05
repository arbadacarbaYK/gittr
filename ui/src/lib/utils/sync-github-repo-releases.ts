/**
 * Soft-refresh forge Releases (GitHub / Codeberg / GitLab) into gittr_releases__*.
 * All release assets are listed — independent of App announce (NIP-82 MIME gate).
 */
import { parseGitHubRepoSpec } from "@/lib/nostr/nip82-repository-links";
import { resolveForgeFromSourceUrl } from "@/lib/repo/forge-releases";
import {
  type StoredRepo,
  loadStoredRepos,
  saveStoredRepos,
} from "@/lib/repos/storage";
import {
  getRepoStorageKey,
  readRepoReleasesFromLocalStorage,
} from "@/lib/utils/entity-normalizer";
import {
  type SyncedReleaseAsset,
  inferReleaseAssetPlatform,
  mapGithubReleaseAssets,
} from "@/lib/utils/map-github-release-assets";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";

export type SyncedGithubRelease = {
  name: string;
  tag_name: string;
  body?: string;
  published_at?: string;
  html_url?: string;
  author?: { login: string; avatar_url?: string };
  prerelease?: boolean;
  source?: "github" | "codeberg" | "gitlab" | "git-tag" | "mixed";
  assets?: SyncedReleaseAsset[];
};

export type { SyncedReleaseAsset };

function mergeAssets(
  local: SyncedReleaseAsset[] | undefined,
  remote: SyncedReleaseAsset[] | undefined
): SyncedReleaseAsset[] | undefined {
  if (remote && remote.length > 0) {
    const byUrl = new Map<string, SyncedReleaseAsset>();
    for (const a of remote) {
      if (a.url) byUrl.set(a.url, a);
    }
    // Keep local-only URLs (e.g. future Blossom uploads) that forge sync doesn't know.
    for (const a of local || []) {
      if (a.url && !byUrl.has(a.url)) byUrl.set(a.url, a);
    }
    return Array.from(byUrl.values());
  }
  return local || remote;
}

function mergeReleasesByTag(
  local: SyncedGithubRelease[],
  fromForge: SyncedGithubRelease[]
): SyncedGithubRelease[] {
  const byTag = new Map<string, SyncedGithubRelease>();
  for (const r of local) {
    const tag = (r.tag_name || "").trim();
    if (!tag) continue;
    byTag.set(tag.toLowerCase(), r);
  }
  for (const r of fromForge) {
    const tag = (r.tag_name || "").trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    const prev = byTag.get(key);
    byTag.set(key, {
      ...prev,
      ...r,
      assets: mergeAssets(prev?.assets, r.assets),
      source: r.source || prev?.source || "mixed",
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
    if (localStorage.getItem(key) === payload) return;
  } catch {
    /* fall through */
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

function mapForgeListPayload(data: {
  forge?: string;
  releases?: Array<{
    tag?: string;
    name?: string;
    body?: string;
    publishedAt?: string;
    htmlUrl?: string;
    prerelease?: boolean;
    assets?: Array<{
      name: string;
      size: number;
      contentType: string;
      downloadUrl: string;
    }>;
  }>;
}): SyncedGithubRelease[] {
  const forge = (data.forge || "github") as SyncedGithubRelease["source"];
  return (data.releases || [])
    .map((r) => {
      const tag = String(r.tag || "").trim();
      const assets: SyncedReleaseAsset[] = (r.assets || [])
        .filter((a) => a?.name && a?.downloadUrl)
        .map((a) => ({
          name: a.name,
          url: a.downloadUrl,
          platform: inferReleaseAssetPlatform(a.name, a.contentType),
          size: typeof a.size === "number" ? a.size : undefined,
          contentType: a.contentType,
        }));
      return {
        name: String(r.name || tag),
        tag_name: tag,
        body: typeof r.body === "string" ? r.body : undefined,
        published_at:
          typeof r.publishedAt === "string" ? r.publishedAt : undefined,
        html_url: typeof r.htmlUrl === "string" ? r.htmlUrl : undefined,
        prerelease: Boolean(r.prerelease),
        source: forge,
        assets,
      };
    })
    .filter((r) => r.tag_name);
}

/** @deprecated Prefer syncForgeRepoReleases — kept for call-site compatibility. */
export async function syncGithubReleasesForRepo(
  entity: string,
  repoSlug: string,
  sourceUrl: string
): Promise<SyncedGithubRelease[] | null> {
  return syncForgeRepoReleases(entity, repoSlug, sourceUrl);
}

export async function syncForgeRepoReleases(
  entity: string,
  repoSlug: string,
  sourceUrl: string
): Promise<SyncedGithubRelease[] | null> {
  const resolved = resolveForgeFromSourceUrl(sourceUrl);
  if (!resolved.ok) {
    // Legacy GitHub-only path via proxy if parse still works
    const spec = parseGitHubRepoSpec(sourceUrl);
    if (!spec) return null;
  }

  try {
    const res = await fetch(
      `/api/repo/forge-release-list?sourceUrl=${encodeURIComponent(sourceUrl)}`
    );
    if (!res.ok) {
      // Fallback: old GitHub proxy path
      if (sourceUrl.includes("github.com")) {
        return syncViaGithubProxy(entity, repoSlug, sourceUrl);
      }
      return null;
    }
    const data = (await res.json()) as {
      ok?: boolean;
      forge?: string;
      releases?: unknown[];
    };
    if (!data.ok) return null;

    const fromForge = mapForgeListPayload(data as any);
    if (fromForge.length === 0) return [];

    const local = readRepoReleasesFromLocalStorage(
      entity,
      repoSlug
    ) as SyncedGithubRelease[];
    const merged = mergeReleasesByTag(local, fromForge);
    persistMergedReleases(entity, repoSlug, merged);
    return merged;
  } catch (e) {
    console.warn("[Releases] Forge sync failed:", e);
    if (sourceUrl.includes("github.com")) {
      return syncViaGithubProxy(entity, repoSlug, sourceUrl);
    }
    return null;
  }
}

async function syncViaGithubProxy(
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
          assets: mapGithubReleaseAssets(r.assets),
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
    console.warn("[Releases] GitHub proxy sync failed:", e);
    return null;
  }
}
