import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import {
  type LNbitsConfig,
  getWalletBalance,
} from "@/lib/payments/lnbits-adapter";

import type { NextApiRequest, NextApiResponse } from "next";

// LNbits Balance endpoint - fetches wallet balance
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Handle OPTIONS request for CORS (GRASP requirement)
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res, req);
    return;
  }

  // Set CORS headers (GRASP requirement)
  setCorsHeaders(res, req);

  if (req.method !== "POST") {
    return res.status(405).json({ status: "method_not_allowed" });
  }

  const { lnbitsUrl, lnbitsAdminKey } = req.body || {};

  if (!lnbitsUrl || !lnbitsAdminKey) {
    return res.status(400).json({
      status: "missing_params",
      message: "Missing LNbits URL or Admin Key",
    });
  }

  try {
    const config: LNbitsConfig = {
      url: lnbitsUrl,
      adminKey: lnbitsAdminKey,
    };

    // Use adapter to get balance (handles both API versions)
    const balance = await getWalletBalance(config);

    return res.status(200).json({
      status: "ok",
      balance: balance.balance, // Raw balance in millisats
      balanceSats: balance.balanceSats, // Balance in sats
      currency: "sats",
    });
  } catch (error: any) {
    // Handle network errors, JSON parse errors, etc.
    let errorMessage = error.message || "Failed to connect to LNbits API";

    // Try to extract more detailed error message
    if (error.message && error.message.includes("Failed to fetch")) {
      errorMessage =
        "Failed to connect to LNbits instance. Please check your LNbits URL and network connection.";
    } else if (error.message && error.message.includes("No wallets")) {
      errorMessage =
        "No wallets found for this admin key. Please check your LNbits admin key.";
    }

    return res.status(500).json({
      status: "error",
      message: errorMessage,
      errorType: error.name || "UnknownError",
    });
  }
}
