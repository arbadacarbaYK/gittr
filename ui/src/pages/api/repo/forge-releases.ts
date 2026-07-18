import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import { fetchForgeReleasesForAnnounce } from "@/lib/repo/forge-releases";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * GET /api/repo/forge-releases?sourceUrl=…&hash=1
 *
 * Returns the latest non-draft forge Release with APK assets for Zapstore announce.
 * Hard errors when missing forge / no releases / no APK.
 * Optional hash=1 streams each APK to compute sha256 (not stored).
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
      message:
        "Link a forge remote first (GitHub, Codeberg, or GitLab) on this repository’s source URL.",
    });
  }
  if (sourceUrl.length > 2048) {
    return res.status(400).json({
      ok: false,
      code: "invalid_request",
      message: "sourceUrl is too long",
    });
  }

  const includeHash =
    req.query.hash === "1" ||
    req.query.hash === "true" ||
    req.query.includeHash === "1";

  const result = await fetchForgeReleasesForAnnounce({
    sourceUrl,
    includeHash,
  });

  if (!result.ok) {
    const status =
      result.code === "missing_source" || result.code === "invalid_request"
        ? 400
        : result.code === "unsupported_forge"
        ? 422
        : result.code === "no_releases" || result.code === "no_apk"
        ? 404
        : 502;
    return res.status(status).json(result);
  }

  return res.status(200).json(result);
}
