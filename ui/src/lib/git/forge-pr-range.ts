import {
  giteaApiRepoBase,
  parseGiteaCompatibleRepo,
} from "../repos/gitea-forge";
import { assertSafeOutboundGitUrl } from "../security/safe-remote-url";

import { sanitizeGitObjectId } from "./commit-range-diff";

export function sanitizePullNumber(raw: string | undefined): number | null {
  const n = Number(String(raw || "").trim());
  if (!Number.isInteger(n) || n < 1 || n > 10_000_000) return null;
  return n;
}

/**
 * Forgejo/Gitea/Codeberg PR metadata → commit range for `git diff`.
 * Browser CORS cannot be assumed; call this from the gittr API only.
 */
export async function resolveGiteaPullCommitRange(
  sourceUrl: string,
  pullNumber: number
): Promise<{ head: string; base?: string; cloneUrl: string } | null> {
  const parsed = parseGiteaCompatibleRepo(sourceUrl);
  if (!parsed) return null;
  const cloneUrl = `${parsed.origin}/${parsed.owner}/${parsed.repo}.git`;
  const safe = await assertSafeOutboundGitUrl(cloneUrl);
  if (!safe.ok) return null;

  try {
    const res = await fetch(`${giteaApiRepoBase(parsed)}/pulls/${pullNumber}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "gittr-space",
      },
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      merge_base?: string;
      head?: { sha?: string };
      base?: { sha?: string };
    };
    const head = sanitizeGitObjectId(data.head?.sha);
    if (!head) return null;
    const base =
      sanitizeGitObjectId(data.merge_base) ||
      sanitizeGitObjectId(data.base?.sha) ||
      undefined;
    return { head, base, cloneUrl };
  } catch {
    return null;
  }
}
