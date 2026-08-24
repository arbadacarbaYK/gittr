/**
 * Where Fork / nostr-only Import should clone from.
 *
 * Fork used to empty-create and copy deprecated `repo.files`. Trees live in
 * `gittr_files__*` and on git remotes (forge `source` or GRASP `clone[]`).
 */
import {
  detectGitForge,
  isCloneableUpstreamSourceUrl,
  normalizeGitCloneUrl,
} from "../utils/detect-git-forge";
import { GRASP_SERVERS_FOR_PUSHING } from "../utils/grasp-servers";

export type ForkImportVia = "forge-source" | "clone" | "inferred-grasp";

export type ForkImportCandidate = {
  url: string;
  via: ForkImportVia;
};

export type GittrRepoPointer = {
  entity: string;
  repo: string;
};

function usableGitRemote(url: string): boolean {
  const u = url.trim();
  if (!u) return false;
  if (
    u.includes("localhost") ||
    u.includes("127.0.0.1") ||
    u.includes("0.0.0.0")
  ) {
    return false;
  }
  return (
    u.startsWith("https://") ||
    u.startsWith("http://") ||
    u.startsWith("git@") ||
    u.startsWith("git://") ||
    /^[^@\s]+@[^:]+:.+$/.test(u)
  );
}

function candidateKey(url: string): string {
  return url
    .trim()
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
}

/** `/npub1…/repo` pointer stored on gittr Fork. */
export function gittrForkPointer(entity: string, repo: string): string {
  const e = String(entity || "")
    .trim()
    .replace(/^\/+/, "");
  const r = String(repo || "")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/i, "");
  if (!e || !r) return "";
  return `/${e}/${r}`;
}

/**
 * Parse a gittr repo pointer: `npub/repo`, `/npub/repo`, or
 * `https://gittr.space/npub/repo`.
 */
export function parseGittrRepoPointer(
  raw: string | null | undefined
): GittrRepoPointer | null {
  let u = String(raw || "").trim();
  if (!u) return null;

  const web = rewriteGittrWebUrlToGitRemote(u);
  if (web) {
    const fromClone = parseNpubRepoFromCloneUrl(web);
    if (fromClone) return fromClone;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^https?:\/\//i.test(u)) {
    return null;
  }

  u = u.replace(/^https?:\/\/(www\.)?gittr\.space\/+/i, "");
  u = u.replace(/^\/+/, "");
  const noQuery = u.split(/[?#]/)[0] || "";
  const parts = noQuery.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const entity = parts[0]!;
  const repo = parts[1]!.replace(/\.git$/i, "");
  if (!entity || !repo) return null;
  if (!/^npub1[a-z0-9]+$/i.test(entity) && !/^[0-9a-f]{64}$/i.test(entity)) {
    return null;
  }
  return { entity, repo };
}

function parseNpubRepoFromCloneUrl(url: string): GittrRepoPointer | null {
  try {
    const normalized = normalizeGitCloneUrl(url);
    const httpsUrl = normalized.startsWith("git@")
      ? normalized.replace(/^git@([^:]+):/, "https://$1/")
      : normalized;
    const parsed = new URL(
      /^https?:\/\//i.test(httpsUrl) ? httpsUrl : `https://${httpsUrl}`
    );
    const parts = parsed.pathname
      .replace(/\.git$/i, "")
      .split("/")
      .filter(Boolean);
    if (parts.length < 2) return null;
    const entity = parts[0]!;
    const repo = parts[1]!;
    if (!/^npub1[a-z0-9]+$/i.test(entity) && !/^[0-9a-f]{64}$/i.test(entity)) {
      return null;
    }
    return { entity, repo };
  } catch {
    return null;
  }
}

/**
 * `https://gittr.space/npub…/repo` is the web UI, not a git remote.
 * Map it to the gittr GRASP clone URL so import-git can clone.
 */
export function rewriteGittrWebUrlToGitRemote(
  raw: string | null | undefined
): string | null {
  const t = String(raw || "").trim();
  if (!t) return null;
  try {
    const withProto = /^https?:\/\//i.test(t)
      ? t
      : t.toLowerCase().startsWith("gittr.space/")
      ? `https://${t}`
      : t.toLowerCase().startsWith("www.gittr.space/")
      ? `https://${t}`
      : null;
    if (!withProto) return null;
    const u = new URL(withProto);
    const host = u.hostname.toLowerCase();
    if (host !== "gittr.space" && host !== "www.gittr.space") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const entity = parts[0]!;
    const repo = parts[1]!.replace(/\.git$/i, "");
    if (!/^npub1[a-z0-9]+$/i.test(entity) && !/^[0-9a-f]{64}$/i.test(entity)) {
      return null;
    }
    if (!repo) return null;
    return `https://git.gittr.space/${entity}/${repo}.git`;
  } catch {
    return null;
  }
}

export function pickForkImportUrls(opts: {
  sourceUrl?: string | null;
  clone?: Array<string | null | undefined> | null;
  forkEntity?: string | null;
  forkRepo?: string | null;
}): ForkImportCandidate[] {
  const out: ForkImportCandidate[] = [];
  const seen = new Set<string>();
  const add = (url: string, via: ForkImportVia) => {
    const n = url.trim().replace(/\/+$/, "");
    if (!n || !usableGitRemote(n)) return;
    const key = candidateKey(n);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ url: n, via });
  };

  const source = (opts.sourceUrl || "").trim();
  if (source) {
    const rewritten = rewriteGittrWebUrlToGitRemote(source);
    if (rewritten) {
      add(rewritten, "clone");
    } else if (isCloneableUpstreamSourceUrl(source)) {
      add(normalizeGitCloneUrl(source) || source, "forge-source");
    } else if (usableGitRemote(source)) {
      add(source, "clone");
    }
  }

  for (const c of opts.clone || []) {
    if (typeof c !== "string") continue;
    const rewritten = rewriteGittrWebUrlToGitRemote(c);
    add(rewritten || c, "clone");
  }

  if (out.length === 0 && opts.forkEntity && opts.forkRepo) {
    const entity = String(opts.forkEntity).trim();
    const repo = String(opts.forkRepo).trim();
    const seenHosts = new Set<string>();
    for (const domain of GRASP_SERVERS_FOR_PUSHING.slice(0, 4)) {
      const host = domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
      if (!host || seenHosts.has(host)) continue;
      seenHosts.add(host);
      add(`https://${host}/${entity}/${repo}.git`, "inferred-grasp");
    }
  }

  return out;
}

/** GitHub REST import vs generic `git clone` (`/api/import-git`). */
export function importApiForUrl(url: string): "github" | "git" {
  return detectGitForge(url).useGithubApi ? "github" : "git";
}

export function isGithubOwnerRepoShorthand(raw: string): boolean {
  const u = raw.trim();
  if (!u || u.includes("://") || u.includes("@")) return false;
  if (parseGittrRepoPointer(u)) return false;
  return /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(u);
}
