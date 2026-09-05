import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import { pinForgeReleaseAssetToNgitBlossom } from "@/lib/repo/pin-forge-asset-to-ngit-blossom";

import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  api: {
    bodyParser: { sizeLimit: "1mb" },
    responseLimit: false,
  },
  maxDuration: 180,
};

/**
 * POST /api/repo/forge-release-blossom-pin
 *
 * Streams a forge Release asset to public Blossom hosts (primal / ditto / haven).
 * Does not persist bytes on gittr and never uploads to blossom.gittr.space.
 * Kind 3063 still defaults to the forge URL unless the client uses the returned URL.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === "OPTIONS") {
    return handleOptionsRequest(res, req);
  }
  setCorsHeaders(res, req);

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      code: "invalid_request",
      error: "Method not allowed",
    });
  }

  const body = (req.body || {}) as {
    sourceUrl?: unknown;
    tag?: unknown;
    downloadUrl?: unknown;
    sha256?: unknown;
    authEvent?: unknown;
  };

  const sourceUrl = String(body.sourceUrl || "").trim();
  const downloadUrl = String(body.downloadUrl || "").trim();
  const sha256 = String(body.sha256 || "").trim();
  const tag = String(body.tag || "").trim();

  if (!sourceUrl || sourceUrl.length > 2048) {
    return res.status(400).json({
      ok: false,
      code: "invalid_request",
      error: "sourceUrl required",
    });
  }
  if (!downloadUrl || downloadUrl.length > 4096) {
    return res.status(400).json({
      ok: false,
      code: "invalid_request",
      error: "downloadUrl required",
    });
  }
  if (tag.length > 128) {
    return res.status(400).json({
      ok: false,
      code: "invalid_request",
      error: "tag is too long",
    });
  }

  const result = await pinForgeReleaseAssetToNgitBlossom({
    sourceUrl,
    tag: tag || null,
    downloadUrl,
    sha256,
    authEvent: body.authEvent,
  });

  if (!result.ok) {
    const status =
      result.code === "invalid_auth"
        ? 401
        : result.code === "too_large"
        ? 413
        : result.code === "invalid_request"
        ? 400
        : 502;
    return res.status(status).json(result);
  }

  return res.status(200).json(result);
}
