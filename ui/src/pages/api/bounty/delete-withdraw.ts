import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Delete/cancel an LNbits withdraw link
 * Used when an issue with a bounty is closed without a PR
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Handle OPTIONS request for CORS (GRASP requirement)
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res);
    return;
  }

  // Set CORS headers (GRASP requirement)
  setCorsHeaders(res);

  if (req.method !== "DELETE" && req.method !== "POST") {
    return res.status(405).json({ status: "method_not_allowed" });
  }

  const { withdrawId, lnbitsUrl, lnbitsAdminKey } = req.body || req.query || {};

  if (!withdrawId) {
    return res.status(400).json({
      status: "missing_params",
      message: "Missing withdrawId",
    });
  }

  const finalLnbitsAdminKey =
    lnbitsAdminKey || process.env.LNBITS_ADMIN_KEY || "";
  const finalLnbitsUrl = (
    lnbitsUrl ||
    process.env.LNBITS_URL ||
    "https://bitcoindelta.club"
  ).replace(/\/$/, "");

  if (!finalLnbitsAdminKey) {
    return res.status(400).json({
      status: "error",
      message: "LNbits admin key required",
    });
  }

  try {
    // LNbits withdraw extension API: DELETE /withdraw/api/v1/links/{id}
    // Note: Some LNbits versions may not support DELETE, so we try both DELETE and POST
    let deleteResponse: Response;

    try {
      // Try DELETE first (standard REST)
      deleteResponse = await fetch(
        `${finalLnbitsUrl}/withdraw/api/v1/links/${withdrawId}`,
        {
          method: "DELETE",
          headers: {
            "X-Api-Key": finalLnbitsAdminKey,
            "Content-Type": "application/json",
          },
        }
      );
    } catch (deleteError) {
      // If DELETE fails, try POST with delete action (some LNbits versions)
      deleteResponse = await fetch(
        `${finalLnbitsUrl}/withdraw/api/v1/links/${withdrawId}`,
        {
          method: "POST",
          headers: {
            "X-Api-Key": finalLnbitsAdminKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "delete" }),
        }
      );
    }

    if (!deleteResponse.ok) {
      // If delete fails, check if link is already used (can't delete used links)
      const checkResponse = await fetch(
        `${finalLnbitsUrl}/withdraw/api/v1/links/${withdrawId}`,
        {
          method: "GET",
          headers: {
            "X-Api-Key": finalLnbitsAdminKey,
          },
        }
      );

      if (checkResponse.ok) {
        const linkData = await checkResponse.json();
        if (linkData.used > 0) {
          return res.status(400).json({
            status: "error",
            message: "Cannot delete withdraw link that has already been used",
          });
        }
      }

      const errorText = await deleteResponse.text();
      throw new Error(`Failed to delete withdraw link: ${errorText}`);
    }

    return res.status(200).json({
      status: "ok",
      message: "Withdraw link deleted successfully",
      withdrawId,
    });
  } catch (error: any) {
    console.error("Failed to delete withdraw link:", error);
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to delete withdraw link",
    });
  }
}
