import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import { listForgeReleasesForDisplay } from "@/lib/repo/forge-releases";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * GET /api/repo/forge-release-list?sourceUrl=…
 *
 * Full release list + all assets for the repo Releases tab.
 * No announceable-binary gate (unlike /api/repo/forge-releases used for NIP-82 announce).
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === "OPTIONS") {
    return handleOptionsRequest(res, req);
  }
  setCorsHeaders(res, req);

  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      code: "invalid_request",
      message: "Method not allowed",
    });
  }

  const sourceUrl = String(req.query.sourceUrl || "").trim();
  if (!sourceUrl) {
    return res.status(400).json({
      ok: false,
      code: "missing_source",
      message: "sourceUrl is required",
    });
  }
  if (sourceUrl.length > 2048) {
    return res.status(400).json({
      ok: false,
      code: "invalid_request",
      message: "sourceUrl is too long",
    });
  }

  const result = await listForgeReleasesForDisplay({ sourceUrl });
  if (!result.ok) {
    const status =
      result.code === "missing_source" || result.code === "invalid_request"
        ? 400
        : result.code === "unsupported_forge"
        ? 422
        : 502;
    return res.status(status).json(result);
  }

  return res.status(200).json(result);
}
