import { rateLimiters } from "@/app/api/middleware/rate-limit";
import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import {
  gitDiffBetweenCommitsSafe,
  sanitizeGitObjectId,
  sanitizeNostrPrRef,
} from "@/lib/git/commit-range-diff";
import {
  resolveGiteaPullCommitRange,
  sanitizePullNumber,
} from "@/lib/git/forge-pr-range";
import { assertSafeOutboundGitUrl } from "@/lib/security/safe-remote-url";
import { normalizeGithubSourceUrl } from "@/lib/utils/normalize-github-source-url";

import type { NextApiRequest, NextApiResponse } from "next";

type Data = {
  ok?: boolean;
  files?: Array<{
    path: string;
    status: "added" | "modified" | "deleted";
    before?: string;
    after?: string;
    isBinary?: boolean;
  }>;
  base?: string;
  head?: string;
  message?: string;
};

function queryString(q: string | string[] | undefined): string {
  if (typeof q === "string") return q;
  if (Array.isArray(q) && q[0]) return q[0];
  return "";
}

/**
 * GET /api/git/diff?sourceUrl=&head=&base=&ref=&pullNumber=
 * Temp-fetch a clone and return unified patches for head vs merge-base (or parent).
 * `pullNumber` loads head/base from Forgejo/Gitea/Codeberg when SHAs are missing.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res, req);
    return;
  }
  setCorsHeaders(res, req);

  const rateLimitResult = await rateLimiters.gitFetch(req as any);
  if (rateLimitResult) {
    return res.status(429).json(JSON.parse(await rateLimitResult.text()));
  }

  if (req.method !== "GET") {
    return res.status(405).json({ message: "method_not_allowed" });
  }

  const sourceUrl = normalizeGithubSourceUrl(queryString(req.query.sourceUrl));
  let head = sanitizeGitObjectId(queryString(req.query.head));
  let base = sanitizeGitObjectId(queryString(req.query.base)) || undefined;
  const extraRef = sanitizeNostrPrRef(queryString(req.query.ref)) || undefined;
  const pullNumber = sanitizePullNumber(queryString(req.query.pullNumber));

  if (!sourceUrl) {
    return res.status(400).json({ message: "sourceUrl required" });
  }

  let cloneUrl = sourceUrl;
  if (!head && pullNumber) {
    const gitea = await resolveGiteaPullCommitRange(sourceUrl, pullNumber);
    if (gitea) {
      head = gitea.head;
      base = base || gitea.base;
      cloneUrl = gitea.cloneUrl;
    }
  }

  if (!head) {
    return res.status(400).json({ message: "sourceUrl and head required" });
  }

  const safe = await assertSafeOutboundGitUrl(cloneUrl);
  if (!safe.ok) {
    return res.status(400).json({ message: safe.error });
  }

  const files = await gitDiffBetweenCommitsSafe({
    cloneUrl,
    head,
    base,
    extraRef,
  });

  return res.status(200).json({
    ok: true,
    files,
    head,
    base,
  });
}
