/**
 * Soft-refresh GitHub Releases into StoredRepo.releases (merge by tag_name).
 * Releases tab previously only showed the import-time snapshot.
 */
import { parseGitHubRepoSpec } from "@/lib/nostr/nip82-repository-links";
import {
  type StoredRepo,
  loadStoredRepos,
  saveStoredRepos,
} from "@/lib/repos/storage";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";

export type SyncedGithubRelease = {
  name: string;
  tag_name: string;
  body?: string;
  published_at?: string;
  html_url?: string;
  author?: { login: string; avatar_url?: string };
  prerelease?: boolean;
  source?: "github";
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
    // Prefer GitHub row for mirrored tags; keep local-only releases (no GH match)
    byTag.set(key, {
      ...prev,
      ...r,
      source: "github",
    });
  }
  return Array.from(byTag.values()).sort((a, b) => {
    const ta = a.published_at ? Date.parse(a.published_at) : 0;
    const tb = b.published_at ? Date.parse(b.published_at) : 0;
    return tb - ta;
  });
}

export async function syncGithubReleasesForRepo(
  entity: string,
  repoSlug: string,
  sourceUrl: string
): Promise<boolean> {
  const spec = parseGitHubRepoSpec(sourceUrl);
  if (!spec) return false;

  try {
    const endpoint = `/repos/${spec.owner}/${spec.repo}/releases?per_page=50`;
    const res = await fetch(
      `/api/github/proxy?endpoint=${encodeURIComponent(endpoint)}`
    );
    if (!res.ok) return false;
    const list = (await res.json()) as unknown[];
    if (!Array.isArray(list)) return false;

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

    if (fromGithub.length === 0) return false;

    const repos = loadStoredRepos();
    const idx = repos.findIndex(
      (r) => findRepoByEntityAndName([r], entity, repoSlug) !== undefined
    );
    if (idx < 0 || !repos[idx]) return false;

    const prev = (repos[idx] as StoredRepo & { releases?: SyncedGithubRelease[] })
      .releases;
    const local = Array.isArray(prev) ? prev : [];
    const merged = mergeReleasesByTag(local, fromGithub);

    repos[idx] = {
      ...repos[idx]!,
      releases: merged,
    } as StoredRepo;
    saveStoredRepos(repos);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("gittr:repo-updated"));
    }
    return true;
  } catch (e) {
    console.warn("[Releases] GitHub sync failed:", e);
    return false;
  }
}
