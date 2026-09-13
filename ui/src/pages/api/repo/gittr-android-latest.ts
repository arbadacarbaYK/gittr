import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import { fetchGittrAndroidLatestFromGitHub } from "@/lib/repo/gittr-android-latest";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * GET /api/repo/gittr-android-latest
 *
 * Latest GitHub Release APK for `space.gittr.app` (official gittr wrapper).
 * Used by the Android user-menu updater. Prefer GitHub download URLs so the
 * WebView can hand the file to the system browser.
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

  const result = await fetchGittrAndroidLatestFromGitHub();
  const status = result.ok ? 200 : result.code === "github_error" ? 502 : 200;
  return res.status(status).json(result);
}
