/**
 * Resolve icon URLs for cards on /stars.
 * Same owner path as Explore: getRepoOwnerPubkey + kind-0 picture (works for npub entities).
 */
import {
  getEntityPicture,
  getRepoOwnerPubkey,
} from "../utils/entity-resolver";

export type StarredRepoIconInput = {
  slug?: string;
  entity?: string;
  repo?: string;
  logoUrl?: string;
  ownerPubkey?: string;
  sourceUrl?: string;
  defaultBranch?: string;
  files?: Array<{ path?: string }>;
};

export function findMatchingLocalRepo(
  starred: StarredRepoIconInput,
  repos: any[]
): any | null {
  if (!Array.isArray(repos) || repos.length === 0) return null;
  return (
    repos.find(
      (r: any) =>
        (starred.slug && r.slug === starred.slug) ||
        (r.entity === starred.entity &&
          (r.repo === starred.repo || r.slug === starred.slug))
    ) || null
  );
}

/**
 * Collect owner pubkeys for kind-0 metadata (npub/hex/ownerPubkey/contributors).
 */
export function collectStarredOwnerPubkeys(
  starredRepos: StarredRepoIconInput[],
  localRepos: any[]
): string[] {
  const pubkeys = new Set<string>();
  for (const repo of starredRepos) {
    if (!repo.entity || repo.entity === "user") continue;
    const matching = findMatchingLocalRepo(repo, localRepos);
    const owner =
      getRepoOwnerPubkey(
        matching || {
          entity: repo.entity,
          ownerPubkey: repo.ownerPubkey,
        },
        repo.entity
      ) || null;
    if (owner) pubkeys.add(owner.toLowerCase());
  }
  return Array.from(pubkeys);
}

function forgeRawLogoUrl(
  matchingRepo: any,
  logoPath: string
): string | null {
  const sourceUrl =
    typeof matchingRepo?.sourceUrl === "string" ? matchingRepo.sourceUrl : "";
  if (!sourceUrl || !logoPath) return null;
  try {
    const url = new URL(sourceUrl);
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    const owner = parts[0];
    const repoName = parts[1].replace(/\.git$/, "");
    const branch = matchingRepo.defaultBranch || "main";
    const encodedPath = logoPath
      .split("/")
      .map((p: string) => encodeURIComponent(p))
      .join("/");

    if (host === "github.com") {
      return `https://raw.githubusercontent.com/${owner}/${repoName}/${encodeURIComponent(
        branch
      )}/${encodedPath}`;
    }
    if (host === "gitlab.com") {
      return `https://gitlab.com/${owner}/${repoName}/-/raw/${encodeURIComponent(
        branch
      )}/${encodedPath}`;
    }
    if (host === "codeberg.org") {
      return `https://codeberg.org/${owner}/${repoName}/raw/branch/${encodeURIComponent(
        branch
      )}/${encodedPath}`;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function pickLogoFilePath(matchingRepo: any): string | null {
  if (!matchingRepo?.files || !Array.isArray(matchingRepo.files)) return null;
  const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"];
  const logoFiles = matchingRepo.files
    .map((f: any) => f.path)
    .filter((p: string) => {
      if (!p || typeof p !== "string") return false;
      const fileName = p.split("/").pop() || "";
      const baseName = fileName.replace(/\.[^.]+$/, "").toLowerCase();
      const extension = fileName.split(".").pop()?.toLowerCase() || "";
      return (
        baseName.includes("logo") &&
        !baseName.includes("logo-alby") &&
        !baseName.includes("alby-logo") &&
        imageExts.includes(extension)
      );
    });
  return logoFiles[0] || null;
}

/**
 * Icon priority: stored logoUrl → owner kind-0 picture → forge raw logo file.
 */
export function resolveStarredRepoIcon(
  repo: StarredRepoIconInput,
  matchingRepo: any | null | undefined,
  ownerMetadata: Record<string, any>
): string | null {
  if (repo.logoUrl && repo.logoUrl.trim().length > 0) {
    return repo.logoUrl.trim();
  }

  const merged = matchingRepo
    ? {
        ...matchingRepo,
        ownerPubkey: matchingRepo.ownerPubkey || repo.ownerPubkey,
      }
    : {
        entity: repo.entity,
        ownerPubkey: repo.ownerPubkey,
      };

  const ownerPk = getRepoOwnerPubkey(merged, repo.entity);
  const picture = getEntityPicture(ownerPk, ownerMetadata);
  if (picture) return picture;

  if (matchingRepo) {
    const logoPath = pickLogoFilePath(matchingRepo);
    if (logoPath) {
      const raw = forgeRawLogoUrl(matchingRepo, logoPath);
      if (raw) return raw;
    }
  }

  return null;
}
