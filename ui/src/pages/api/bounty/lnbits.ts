import type { NextApiRequest, NextApiResponse } from "next";
import { createInvoiceFromLightningAddress, createInvoiceFromLNURL } from "@/lib/payments/lnurl";
import { validatePaymentAmount, validateTextContent, validatePubkey, validateLightningAddress, validateLNURL } from "@/lib/security/input-validation";
import { rateLimiters } from "@/app/api/middleware/rate-limit";
import { setCorsHeaders, handleOptionsRequest } from "@/lib/api/cors";
import { createPayment, type LNbitsConfig, type LNbitsPaymentRequest } from "@/lib/payments/lnbits-adapter";

// LNbits Zap endpoint - creates invoice from recipient, then pays with LNbits
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

  const { amount, recipient, comment, splits, lud16, lnurl } = req.body || {};

  if (!amount || !recipient) {
    return res.status(400).json({ status: "missing_params", message: "Missing required parameters" });
  }

  // Input validation using centralized validators
  const recipientValidation = validatePubkey(recipient);
  if (!recipientValidation.valid) {
    return res.status(400).json({ status: "invalid_recipient", message: recipientValidation.error });
  }

  const amountValidation = validatePaymentAmount(amount);
  if (!amountValidation.valid) {
    return res.status(400).json({ status: "invalid_amount", message: amountValidation.error });
  }
  const amountNum = Number(amount);

  if (comment) {
    const commentValidation = validateTextContent(comment, 500, "Comment");
    if (!commentValidation.valid) {
      return res.status(400).json({ status: "invalid_comment", message: commentValidation.error });
    }
  }

  // Validate splits if provided
  if (splits) {
    if (!Array.isArray(splits) || splits.length > 100) {
      return res.status(400).json({ status: "invalid_splits", message: "Splits must be an array with max 100 items" });
    }
    for (const split of splits) {
      if (typeof split !== "object" || !split.pubkey) {
        return res.status(400).json({ status: "invalid_splits", message: "Each split must have a pubkey" });
      }
      const pubkeyValidation = validatePubkey(split.pubkey);
      if (!pubkeyValidation.valid) {
        return res.status(400).json({ status: "invalid_splits", message: `Invalid pubkey in splits: ${pubkeyValidation.error}` });
      }
    }
  }

  // Validate LNbits URL format
  let lnbitsUrl = req.body?.lnbitsUrl || process.env.LNBITS_URL || "https://bitcoindelta.club";
  if (typeof lnbitsUrl !== "string" || (!lnbitsUrl.startsWith("http://") && !lnbitsUrl.startsWith("https://"))) {
    return res.status(400).json({ status: "invalid_lnbits_url", message: "Invalid LNbits URL format" });
  }
  // Normalize URL (remove trailing slash)
  lnbitsUrl = lnbitsUrl.replace(/\/$/, "");

  // Get LNbits admin key from request body (user config) or environment
  const lnbitsAdminKey = req.body?.lnbitsAdminKey || process.env.LNBITS_ADMIN_KEY || "239e3298fcd5477789155194e9a85678";
  
  // Validate admin key format (should be hex string)
  if (typeof lnbitsAdminKey !== "string" || lnbitsAdminKey.length < 20 || lnbitsAdminKey.length > 100) {
    return res.status(400).json({ status: "invalid_lnbits_key", message: "Invalid LNbits admin key format" });
  }

  try {
    if (splits && splits.length > 0) {
      // LNbits SplitPayments Extension flow:
      // 1. Split targets MUST be pre-configured MANUALLY in LNbits UI (Extensions → SplitPayments)
      // 2. We create invoice from SOURCE wallet (owner's LNbits wallet)
      // 3. When invoice is paid, LNbits automatically splits according to UI configuration
      // 
      // NOTE: We cannot configure splits via API - user must do it manually in LNbits UI
      
      console.log("LNbits Split: Creating invoice from source wallet for auto-split");
      console.log("Split info (for reference only):", splits.map((s: any) => ({ pubkey: s.pubkey, weight: s.weight + "%" })));
      
      // Create invoice from source wallet using LNbits adapter (handles both API versions)
      // This is the wallet with SplitPayments extension configured in UI
      const config: LNbitsConfig = {
        url: lnbitsUrl,
        adminKey: lnbitsAdminKey,
      };

      const paymentRequest: LNbitsPaymentRequest = {
        out: false, // Create invoice for receiving (source wallet receives, then splits automatically)
        amount: amountNum * 1000, // LNbits API expects millisats
        memo: comment || `Zap with splits: ${splits.length} recipients`,
      };

      const invoiceData = await createPayment(config, paymentRequest);
      const fullInvoice = invoiceData.payment_request || invoiceData.bolt11;
      
      if (!fullInvoice || fullInvoice.length < 50) {
        return res.status(500).json({
          status: "error",
          message: "Invalid invoice received from LNbits (too short or missing)",
        });
      }
      
      const cleanInvoice = fullInvoice.replace(/^lightning:/i, "");
      
      return res.status(200).json({
        paymentRequest: cleanInvoice,
        paymentHash: invoiceData.payment_hash || invoiceData.checking_id || "",
        status: "invoice_created",
        note: `Invoice created from source wallet. When paid, LNbits SplitPayments extension will automatically split to ${splits.length} targets (must be pre-configured in LNbits UI).`,
      });
    } else {
      // Single recipient zap - CORRECT FLOW: Get invoice from recipient
      if (!lud16 && !lnurl) {
        return res.status(400).json({
          status: "missing_lightning_address",
          message: "Recipient's Lightning address (lud16 or lnurl) is required. Please fetch from Nostr profile first."
        });
      }

                  // Create invoice from recipient's Lightning address
                  const amountMsat = amountNum * 1000; // Convert sats to millisats
                  
                  // Validate lightning address format using centralized validator
                  if (lud16) {
                    const lud16Validation = validateLightningAddress(lud16);
                    if (!lud16Validation.valid) {
                      return res.status(400).json({
                        status: "invalid_lud16",
                        message: lud16Validation.error
                      });
                    }
                  }

                  if (lnurl) {
                    const lnurlValidation = validateLNURL(lnurl);
                    if (!lnurlValidation.valid) {
                      return res.status(400).json({
                        status: "invalid_lnurl",
                        message: lnurlValidation.error
                      });
                    }
                  }
      let invoice: string;
      
      if (lud16) {
        console.log("LNbits Zap: Creating invoice from recipient LUD-16:", lud16);
        invoice = await createInvoiceFromLightningAddress(lud16, amountMsat, comment);
      } else if (lnurl) {
        console.log("LNbits Zap: Creating invoice from recipient LNURL:", lnurl);
        invoice = await createInvoiceFromLNURL(lnurl, amountMsat, comment);
      } else {
        throw new Error("No Lightning address provided");
      }

      console.log("LNbits Zap: Invoice created from recipient:", invoice.substring(0, 50) + "...");

      // Now pay the invoice using LNbits adapter (handles both API versions)
      const config: LNbitsConfig = {
        url: lnbitsUrl,
        adminKey: lnbitsAdminKey,
      };

      const paymentRequest: LNbitsPaymentRequest = {
        out: true, // Paying invoice (sending payment)
        bolt11: invoice,
        memo: comment || `Zap: ${amountNum} sats to ${recipient.slice(0, 8)}...`,
        extra: {
          comment: comment || `Zap: ${amountNum} sats to ${recipient.slice(0, 8)}...`,
          recipient,
        },
      };

      let payData;
      try {
        payData = await createPayment(config, paymentRequest);
      } catch (paymentError: any) {
        console.error("LNbits payment failed:", paymentError);
        // Return the invoice anyway so user can pay it manually
        return res.status(200).json({
          paymentRequest: invoice,
          paymentHash: "",
          status: "invoice_created",
          note: "Invoice created from recipient. LNbits payment attempt failed - you can pay manually.",
        });
      }
      
      return res.status(200).json({
        paymentRequest: invoice,
        paymentHash: payData.payment_hash || payData.checking_id || "",
        status: "paid", // Successfully paid via LNbits
      });
    }
  } catch (error: any) {
    console.error("LNbits zap error:", error);
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to create zap",
    });
  }
}

