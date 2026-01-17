import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";

import type { NextApiRequest, NextApiResponse } from "next";

// Release bounty to recipient (on PR merge)
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

  const {
    bountyId,
    recipientPubkey,
    bountyAmount,
    recipientLud16,
    recipientLnurl,
    lnbitsUrl,
    lnbitsAdminKey,
  } = req.body || {};

  if (!bountyId || !recipientPubkey) {
    return res.status(400).json({
      status: "missing_params",
      message: "Missing required parameters",
    });
  }

  if (!bountyAmount || bountyAmount <= 0) {
    return res
      .status(400)
      .json({ status: "invalid_amount", message: "Invalid bounty amount" });
  }

  // SECURITY: Validate amount is reasonable (prevent manipulation)
  // Amount should come from issue record, not user input
  // Additional safety check: max 1 million sats (~$400 at $40k/BTC)
  if (bountyAmount > 1000000) {
    return res.status(400).json({
      status: "amount_too_large",
      message: "Bounty amount exceeds maximum allowed (1,000,000 sats)",
    });
  }

  // Log for security audit (amount should match issue record)
  console.log("Bounty release request:", {
    bountyId,
    recipientPubkey: recipientPubkey.slice(0, 8) + "...",
    bountyAmount,
  });

  // Get LNbits admin key from request body (user config) or environment
  const finalLnbitsAdminKey =
    lnbitsAdminKey ||
    process.env.LNBITS_ADMIN_KEY ||
    "239e3298fcd5477789155194e9a85678";
  const finalLnbitsUrl = (
    lnbitsUrl ||
    process.env.LNBITS_URL ||
    "https://bitcoindelta.club"
  ).replace(/\/$/, "");

  try {
    // Validate LNbits config
    if (!finalLnbitsAdminKey || !finalLnbitsUrl) {
      return res.status(400).json({
        status: "error",
        message:
          "LNbits not configured. Please set LNbits URL and admin key in Settings → Account",
      });
    }

    // Step 1: Get invoice from recipient's Lightning address
    // The client should fetch recipient's lud16/lnurl from Nostr and pass it here
    if (!recipientLud16 && !recipientLnurl) {
      return res.status(400).json({
        status: "missing_lightning_address",
        message:
          "Recipient's Lightning address not found. The recipient needs to set a lud16, lnurl, or nwcRecv in their Nostr profile.",
      });
    }

    let invoice: string;

    // Import invoice creation functions
    const { createInvoiceFromLightningAddress, createInvoiceFromLNURL } =
      await import("@/lib/payments/lnurl");

    if (recipientLud16) {
      invoice = await createInvoiceFromLightningAddress(
        recipientLud16,
        bountyAmount * 1000,
        `Bounty release for issue ${bountyId}`
      );
    } else if (recipientLnurl) {
      invoice = await createInvoiceFromLNURL(
        recipientLnurl,
        bountyAmount * 1000,
        `Bounty release for issue ${bountyId}`
      );
    } else {
      throw new Error("No Lightning address provided");
    }

    // Step 2: Pay the invoice using LNbits
    const payResponse = await fetch(`${finalLnbitsUrl}/api/v1/payments`, {
      method: "POST",
      headers: {
        "X-Api-Key": finalLnbitsAdminKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        out: true, // Paying invoice (sending payment)
        bolt11: invoice,
        extra: {
          comment: `Bounty release: ${bountyAmount} sats to ${recipientPubkey.slice(
            0,
            8
          )}...`,
          bountyId,
          recipientPubkey,
        },
      }),
    });

    if (!payResponse.ok) {
      const errorText = await payResponse.text();
      console.error("LNbits bounty payment failed:", {
        status: payResponse.status,
        errorText,
      });

      // Return error but don't mark as released
      return res.status(500).json({
        status: "payment_failed",
        message: `Failed to send bounty payment: ${errorText}`,
      });
    }

    const paymentResult = await payResponse.json();
    const paymentHash =
      paymentResult.payment_hash || paymentResult.checking_id || "";

    // Payment succeeded - return success
    return res.status(200).json({
      status: "ok",
      message: "Bounty released successfully",
      paymentHash,
    });
  } catch (error: any) {
    console.error("Bounty release error:", error);
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to release bounty",
    });
  }
}
