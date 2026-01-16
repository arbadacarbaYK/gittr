import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Check if a withdraw link has been used/redeemed
 * Uses the LNbits invoice key to read withdraw link status
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

  if (req.method !== "GET") {
    return res.status(405).json({ status: "method_not_allowed" });
  }

  const { withdrawId } = req.query;
  const { lnbitsUrl, lnbitsInvoiceKey } = req.query;

  if (!withdrawId || typeof withdrawId !== "string") {
    return res
      .status(400)
      .json({ status: "missing_withdraw_id", message: "Missing withdrawId" });
  }

  const finalLnbitsUrl =
    (lnbitsUrl as string) ||
    process.env.LNBITS_URL ||
    "https://bitcoindelta.club";
  const finalLnbitsInvoiceKey =
    (lnbitsInvoiceKey as string) || process.env.LNBITS_INVOICE_KEY || "";

  // If invoice key not provided, try to get from request body (for POST) or return error
  // For GET requests, we need it in query params
  if (!finalLnbitsInvoiceKey) {
    return res.status(400).json({
      status: "missing_invoice_key",
      message:
        "LNbits invoice key required to check withdraw status. Please provide it in query params or set it in Settings → Account.",
    });
  }

  try {
    // Get withdraw link details
    const linkResponse = await fetch(
      `${finalLnbitsUrl}/withdraw/api/v1/links/${withdrawId}`,
      {
        method: "GET",
        headers: {
          "X-Api-Key": finalLnbitsInvoiceKey,
        },
      }
    );

    if (!linkResponse.ok) {
      if (linkResponse.status === 404) {
        return res.status(200).json({ used: true, status: "not_found" });
      }
      const errorText = await linkResponse.text();
      throw new Error(`Failed to get withdraw link: ${errorText}`);
    }

    const linkData = await linkResponse.json();

    // Check if link is used (used > 0 means it's been claimed)
    const isUsed = linkData.used > 0 || linkData.usescsv !== "0";

    return res.status(200).json({
      used: isUsed,
      status: isUsed ? "redeemed" : "unredeemed",
      withdrawId: linkData.id,
      amount: linkData.max_withdrawable ? linkData.max_withdrawable / 1000 : 0, // Convert from millisats
    });
  } catch (error: any) {
    console.error("Failed to check withdraw status:", error);
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to check withdraw status",
    });
  }
}
