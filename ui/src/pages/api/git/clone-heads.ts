import { rateLimiters } from "@/app/api/middleware/rate-limit";
import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import { remoteHasGitRefs } from "@/lib/git/remote-has-git-refs";
import { assertSafeOutboundGitUrl } from "@/lib/security/safe-remote-url";
import { normalizeGithubSourceUrl } from "@/lib/utils/normalize-github-source-url";

import type { NextApiRequest, NextApiResponse } from "next";

type Data = {
  ok?: boolean;
  hasRefs?: boolean;
  message?: string;
};

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

  const raw = req.query.url;
  let url =
    typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] || "" : "";
  url = normalizeGithubSourceUrl(String(url || "").trim());
  if (!url) {
    return res.status(400).json({ message: "url required" });
  }
  if (!(await assertSafeOutboundGitUrl(url)).ok) {
    return res.status(400).json({ message: "invalid or blocked remote URL" });
  }

  try {
    const hasRefs = await remoteHasGitRefs(url);
    return res.status(200).json({ ok: true, hasRefs });
  } catch (e: any) {
    console.error("[clone-heads] error:", e);
    return res.status(200).json({ ok: true, hasRefs: false });
  }
}
