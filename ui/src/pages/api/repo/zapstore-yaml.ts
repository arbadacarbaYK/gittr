import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import { fetchZapstoreYamlFromForge } from "@/lib/repo/zapstore-yaml-fetch";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * GET /api/repo/zapstore-yaml?sourceUrl=…&branch=…
 *
 * Reads repo-root `zapstore.yaml` / `zapstore.yml` from the linked forge
 * (icon + images only). Relative screenshot paths become public raw HTTPS
 * URLs. Missing file → 200 `{ ok:true, found:false }`.
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

  const branch = String(req.query.branch || "").trim();
  if (branch.length > 128) {
    return res.status(400).json({
      ok: false,
      code: "invalid_request",
      message: "branch is too long",
    });
  }

  const result = await fetchZapstoreYamlFromForge({
    sourceUrl,
    defaultBranch: branch || null,
  });
  if (!result.ok) {
    const status =
      result.code === "missing_source"
        ? 400
        : result.code === "unsupported_forge"
        ? 422
        : 502;
    return res.status(status).json(result);
  }
  return res.status(200).json(result);
}
