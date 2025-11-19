import type { NextApiRequest, NextApiResponse } from "next";
import { validatePaymentAmount, validateTextContent, validatePubkey, validateUrl } from "@/lib/security/input-validation";
import { rateLimiters } from "@/app/api/middleware/rate-limit";
import { setCorsHeaders, handleOptionsRequest } from "@/lib/api/cors";

// NWC Zap endpoint - creates zap invoice via Nostr Wallet Connect
// For now, if NWC is not fully implemented, fall back to LNbits
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Rate limiting
  // Handle OPTIONS request for CORS (GRASP requirement)
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res);
    return;
  }

  // Set CORS headers (GRASP requirement)
  setCorsHeaders(res);
  const rateLimitResult = await rateLimiters.payment(req as any);
  if (rateLimitResult) {
    return res.status(429).json(JSON.parse(await rateLimitResult.text()));
  }

  if (req.method !== "POST") {
    return res.status(405).json({ status: "method_not_allowed" });
  }

  const { relay, secret, amount, recipient, comment, splits, lnbitsUrl, lnbitsAdminKey } = req.body || {};

  if (!amount || !recipient) {
    return res.status(400).json({ status: "missing_params", message: "Missing required parameters" });
  }

  // Input validation
  const amountValidation = validatePaymentAmount(amount);
  if (!amountValidation.valid) {
    return res.status(400).json({ status: "invalid_amount", message: amountValidation.error });
  }

  const recipientValidation = validatePubkey(recipient);
  if (!recipientValidation.valid) {
    return res.status(400).json({ status: "invalid_recipient", message: recipientValidation.error });
  }

  if (comment) {
    const commentValidation = validateTextContent(comment, 500, "Comment");
    if (!commentValidation.valid) {
      return res.status(400).json({ status: "invalid_comment", message: commentValidation.error });
    }
  }

  // If LNbits credentials are provided, use LNbits instead of NWC
  // This is a fallback until NWC is fully implemented
  if (lnbitsUrl && lnbitsAdminKey) {
    try {
      // Validate LNbits URL
      let finalUrl = lnbitsUrl.trim();
      if (!finalUrl.startsWith("http://") && !finalUrl.startsWith("https://")) {
        finalUrl = `https://${finalUrl}`;
      }
      const urlValidation = validateUrl(finalUrl);
      if (!urlValidation.valid) {
        return res.status(400).json({ status: "invalid_lnbits_url", message: urlValidation.error });
      }
      
      // Validate admin key format
      if (typeof lnbitsAdminKey !== "string" || lnbitsAdminKey.length < 20 || lnbitsAdminKey.length > 100) {
        return res.status(400).json({ status: "invalid_lnbits_key", message: "Invalid LNbits admin key format" });
      }
      
      // Remove trailing slash and build API URL
      finalUrl = finalUrl.replace(/\/+$/, "");
      const apiUrl = `${finalUrl}/api/v1/payments`;
      
      console.log("NWC fallback - Creating LNbits invoice:", { apiUrl, amount });
      
      const invoiceResponse = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "X-Api-Key": lnbitsAdminKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          out: false, // Create invoice for receiving
          amount: amount * 1000, // LNbits API expects millisats
          memo: comment || `Zap to ${recipient.slice(0, 8)}...`,
        }),
      });

      if (!invoiceResponse.ok) {
        const errorText = await invoiceResponse.text();
        console.error("LNbits invoice creation failed:", { status: invoiceResponse.status, errorText });
        throw new Error(`Failed to create LNbits invoice: ${errorText}`);
      }

      const invoiceData = await invoiceResponse.json();
      const fullInvoice = invoiceData.payment_request || invoiceData.bolt11;
      
      console.log("LNbits invoice received:", { 
        hasInvoice: !!fullInvoice, 
        length: fullInvoice?.length,
        startsWith: fullInvoice?.substring(0, 20)
      });
      
      if (!fullInvoice || fullInvoice.length < 50) {
        throw new Error(`Invalid invoice received from LNbits (length: ${fullInvoice?.length || 0})`);
      }

      return res.status(200).json({
        paymentRequest: fullInvoice, // Full invoice, not truncated
        paymentHash: invoiceData.payment_hash || invoiceData.checking_id,
        status: "ok",
      });
    } catch (error: any) {
      console.error("NWC fallback error:", error);
      return res.status(500).json({
        status: "error",
        message: error.message || "Failed to create invoice via LNbits fallback",
      });
    }
  }

  // Note: Direct NWC relay connection not implemented, but the flow works via:
  // 1. Client calls createNWCZap() which fetches invoice from recipient's Lightning address
  // 2. Invoice is created via /api/zap/create-invoice (uses recipient's lud16/lnurl)
  // 3. Payment is made via NWC client (if configured) or falls back to LNbits
  // This endpoint is only called if LNbits credentials are not provided in the request
  // For full NWC support, would need to implement NWC relay connection here
  return res.status(400).json({
    status: "not_implemented",
    message: "NWC relay connection not implemented. Please configure LNbits in Settings → Account, or use the client-side NWC flow via createNWCZap()",
  });
}

