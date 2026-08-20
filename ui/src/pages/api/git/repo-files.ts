import { rateLimiters } from "@/app/api/middleware/rate-limit";
import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import { cloneShallowAndListFiles } from "@/lib/git/shallow-clone-remote";
import { assertSafeOutboundGitUrl } from "@/lib/security/safe-remote-url";
import { normalizeGithubSourceUrl } from "@/lib/utils/normalize-github-source-url";

import type { NextApiRequest, NextApiResponse } from "next";

type Data = {
  ok?: boolean;
  files?: Array<{ type: string; path: string; size?: number }>;
  defaultBranch?: string;
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

  const sourceUrlRaw = req.query.sourceUrl;
  let sourceUrl =
    typeof sourceUrlRaw === "string"
      ? sourceUrlRaw
      : Array.isArray(sourceUrlRaw)
      ? sourceUrlRaw[0]
      : "";

  const branchRaw = req.query.branch;
  const branch =
    typeof branchRaw === "string"
      ? branchRaw
      : Array.isArray(branchRaw)
      ? branchRaw[0] ?? "main"
      : "main";

  if (!sourceUrl || typeof sourceUrl !== "string") {
    return res.status(400).json({ message: "sourceUrl required" });
  }

  sourceUrl = normalizeGithubSourceUrl(sourceUrl.trim());

  if (!(await assertSafeOutboundGitUrl(sourceUrl)).ok) {
    return res.status(400).json({ message: "invalid or blocked remote URL" });
  }

  try {
    const result = await cloneShallowAndListFiles(sourceUrl, branch);
    if (!result || !result.files) {
      return res.status(502).json({
        ok: false,
        message: "clone_or_list_failed",
      });
    }
    return res.status(200).json({
      ok: true,
      files: result.files,
      defaultBranch: result.defaultBranch,
    });
  } catch (e: any) {
    console.error("[repo-files] error:", e);
    return res.status(500).json({
      message: e?.message || "error",
    });
  }
}
