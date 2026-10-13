import { rateLimiters } from "@/app/api/middleware/rate-limit";
import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import { listRemoteHeadRefs } from "@/lib/git/remote-has-git-refs";
import { assertSafeOutboundGitUrl } from "@/lib/security/safe-remote-url";
import { normalizeGithubSourceUrl } from "@/lib/utils/normalize-github-source-url";

import type { NextApiRequest, NextApiResponse } from "next";

type Head = { ref: string; commit: string };

type Data = {
  ok?: boolean;
  heads?: Head[];
  message?: string;
};

/**
 * Branch tips on a public git address. Read-only. Does not fetch into gittr.
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

  if (req.method !== "POST") {
    return res.status(405).json({ message: "method_not_allowed" });
  }

  const body = (req.body || {}) as { url?: string };
  let url = normalizeGithubSourceUrl(String(body.url || "").trim());
  if (!url) {
    return res.status(400).json({ message: "url required" });
  }
  if (url.length > 2000) {
    return res.status(400).json({ message: "url too long" });
  }
  if (!(await assertSafeOutboundGitUrl(url)).ok) {
    return res.status(400).json({ message: "invalid or blocked remote URL" });
  }

  try {
    const heads = await listRemoteHeadRefs(url);
    return res.status(200).json({ ok: true, heads });
  } catch (error) {
    console.error("[remote-heads] error:", error);
    return res.status(200).json({ ok: true, heads: [] });
  }
}
