import type { NextApiRequest, NextApiResponse } from "next";
import { setCorsHeaders, handleOptionsRequest } from "@/lib/api/cors";

// NWC Balance endpoint - fetches wallet balance via Nostr Wallet Connect
// This is done client-side for security (secret key must not leave the browser)
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
  // Handle OPTIONS request for CORS (GRASP requirement)
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res);
    return;
  }

  // Set CORS headers (GRASP requirement)
  setCorsHeaders(res);
    return res.status(405).json({ status: "method_not_allowed" });
  }

  const { nwcString } = req.body || {};

  if (!nwcString) {
    return res.status(400).json({ 
      status: "missing_params", 
      message: "Missing NWC connection string" 
    });
  }

  // Note: Balance check should be done client-side for security
  // This endpoint just validates the NWC string format
  try {
    // Parse NWC connection string
    const normalizedUri = nwcString.replace(/^nostr\+walletconnect:/, "http:");
    const nwcUrl = new URL(normalizedUri);
    const walletPubkey = nwcUrl.hostname || nwcUrl.pathname.replace(/^\/+/, "").replace(/\/$/, "");
    const relay = nwcUrl.searchParams.get("relay");
    const secret = nwcUrl.searchParams.get("secret");
    
    if (!walletPubkey || !relay || !secret) {
      return res.status(400).json({
        status: "invalid_nwc",
        message: "Invalid NWC connection string format",
      });
    }

    // Return success - actual balance fetch happens client-side
    return res.status(200).json({
      status: "ok",
      message: "NWC string is valid. Balance check should be done client-side.",
      relay,
      walletPubkey,
      connected: true,
    });
  } catch (error: any) {
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to verify NWC connection",
    });
  }
}

