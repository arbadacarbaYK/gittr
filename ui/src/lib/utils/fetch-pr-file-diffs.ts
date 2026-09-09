import { nostrPrGitRef } from "../nostr/kind1618-pr-git-hints";
import { parseGitHubRepoSpec } from "../nostr/nip82-repository-links";
import { parseGiteaCompatibleRepo } from "../repos/gitea-forge";

import { isGithubStylePrId } from "./issue-pr-status";

export type PrFileDiff = {
  path: string;
  status: "added" | "modified" | "deleted";
  after?: string;
  before?: string;
  isBinary?: boolean;
  /** Unified patch in `after` — display only; do not apply as a full file body. */
  diffPreview?: boolean;
};

export function prDiffLooksLikeUnifiedPatch(text: string | undefined): boolean {
  const t = String(text || "").trimStart();
  if (!t) return false;
  if (t.startsWith("@@") || t.startsWith("diff --git")) return true;
  return t
    .split("\n")
    .slice(0, 8)
    .some((l) => l.startsWith("@@ "));
}

export function githubPullNumberFromPrRow(row: {
  id?: string;
  number?: string | number;
  html_url?: string;
}): number | null {
  if (isGithubStylePrId(row.id)) {
    const n = Number(String(row.id).replace(/^pr-/i, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const fromUrl = String(row.html_url || "").match(/\/pulls?\/(\d+)/i);
  if (fromUrl) {
    const n = Number(fromUrl[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

export function githubRepoSpecFromPrInput(input: {
  githubSourceUrl?: string;
  html_url?: string;
  githubOwner?: string;
  githubRepo?: string;
}): { owner: string; repo: string } | null {
  if (input.githubSourceUrl) {
    const spec = parseGitHubRepoSpec(input.githubSourceUrl);
    if (spec) return spec;
  }
  if (input.html_url) {
    const spec = parseGitHubRepoSpec(input.html_url);
    if (spec) return spec;
  }
  if (input.githubOwner && input.githubRepo) {
    return { owner: input.githubOwner, repo: input.githubRepo };
  }
  return null;
}

export function extraCloneUrlsFromPrHtml(
  htmlUrl: string | undefined
): string[] {
  const raw = String(htmlUrl || "").trim();
  if (!raw) return [];
  const gh = parseGitHubRepoSpec(raw);
  if (gh) return [`https://github.com/${gh.owner}/${gh.repo}.git`];
  const gitea = parseGiteaCompatibleRepo(raw);
  if (gitea) {
    return [`${gitea.origin}/${gitea.owner}/${gitea.repo}.git`];
  }
  return [];
}

function mapGithubFileStatus(
  status: string | undefined
): "added" | "modified" | "deleted" {
  const s = (status || "").toLowerCase();
  if (s === "added" || s === "copied") return "added";
  if (s === "removed") return "deleted";
  return "modified";
}

export function mapGithubPullFilesJson(data: unknown): PrFileDiff[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((f): f is { filename: string; status?: string; patch?: string } =>
      Boolean(
        f && typeof f === "object" && (f as { filename?: string }).filename
      )
    )
    .map((f) => ({
      path: f.filename,
      status: mapGithubFileStatus(f.status),
      after: f.patch,
      diffPreview: true,
    }));
}

export async function fetchGithubPullFiles(
  owner: string,
  repo: string,
  number: number
): Promise<PrFileDiff[]> {
  const endpoint = `/repos/${owner}/${repo}/pulls/${number}/files?per_page=100`;
  const res = await fetch(
    `/api/github/proxy?endpoint=${encodeURIComponent(endpoint)}`
  );
  if (!res.ok) return [];
  return mapGithubPullFilesJson(await res.json());
}

export async function fetchGithubPullCommits(
  owner: string,
  repo: string,
  number: number
): Promise<{ head?: string; base?: string }> {
  const endpoint = `/repos/${owner}/${repo}/pulls/${number}`;
  const res = await fetch(
    `/api/github/proxy?endpoint=${encodeURIComponent(endpoint)}`
  );
  if (!res.ok) return {};
  const data = (await res.json()) as {
    head?: { sha?: string };
    base?: { sha?: string };
  };
  return {
    head: data.head?.sha,
    base: data.base?.sha,
  };
}

export async function fetchGitRangeDiff(opts: {
  cloneUrl: string;
  head?: string;
  base?: string;
  extraRef?: string;
  pullNumber?: number;
}): Promise<PrFileDiff[]> {
  const params = new URLSearchParams({
    sourceUrl: opts.cloneUrl,
  });
  if (opts.head) params.set("head", opts.head);
  if (opts.base) params.set("base", opts.base);
  if (opts.extraRef) params.set("ref", opts.extraRef);
  if (opts.pullNumber) params.set("pullNumber", String(opts.pullNumber));
  const res = await fetch(`/api/git/diff?${params.toString()}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { files?: PrFileDiff[] };
  if (!Array.isArray(data.files)) return [];
  return data.files.map((f) => ({
    ...f,
    diffPreview:
      !f.before && prDiffLooksLikeUnifiedPatch(f.after) ? true : f.diffPreview,
  }));
}

export type FetchPrFileDiffsInput = {
  id?: string;
  number?: string | number;
  html_url?: string;
  cloneUrls?: string[];
  currentCommitId?: string;
  mergeBase?: string;
  nostrEventId?: string;
  githubOwner?: string;
  githubRepo?: string;
  githubSourceUrl?: string;
};

/** GitHub PR files, else git clone + c vs merge-base (NIP-34 / Gitea). */
export async function fetchPrFileDiffs(
  input: FetchPrFileDiffsInput
): Promise<PrFileDiff[]> {
  const ghNumber = githubPullNumberFromPrRow(input);
  const spec = githubRepoSpecFromPrInput(input);
  if (ghNumber && spec) {
    const files = await fetchGithubPullFiles(spec.owner, spec.repo, ghNumber);
    if (files.length) return files;
  }

  let head = String(input.currentCommitId || "").trim();
  let mergeBase = String(input.mergeBase || "").trim() || undefined;
  if (ghNumber && spec && !head) {
    const commits = await fetchGithubPullCommits(
      spec.owner,
      spec.repo,
      ghNumber
    );
    head = commits.head || "";
    mergeBase = mergeBase || commits.base;
  }
  const extraRef = nostrPrGitRef(input.nostrEventId || input.id);
  const urls = [
    ...new Set(
      [
        ...(input.cloneUrls || []),
        ...extraCloneUrlsFromPrHtml(input.html_url),
        input.githubSourceUrl || "",
      ]
        .map((u) => String(u).trim())
        .filter(Boolean)
    ),
  ];
  for (const cloneUrl of urls) {
    const pullNumber =
      !head && ghNumber && parseGiteaCompatibleRepo(cloneUrl)
        ? ghNumber
        : undefined;
    if (!head && !pullNumber) continue;
    const files = await fetchGitRangeDiff({
      cloneUrl,
      head: head || undefined,
      base: mergeBase,
      extraRef: extraRef || undefined,
      pullNumber,
    });
    if (files.length) return files;
  }
  return [];
}
