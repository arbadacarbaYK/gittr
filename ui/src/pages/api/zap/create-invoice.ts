import { rateLimiters } from "@/app/api/middleware/rate-limit";
import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import { fetchUserMetadata } from "@/lib/nostr/fetch-metadata-server";
import {
  createInvoiceFromLNURL,
  createInvoiceFromLightningAddress,
  decodeLNURL,
} from "@/lib/payments/lnurl";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * API endpoint to create an invoice from recipient's Lightning address
 * This is the CORRECT way: get invoice from recipient, not from sender
 */
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

  // Rate limiting for payment endpoints
  const rateLimitResult = await rateLimiters.payment(req as any);
  if (rateLimitResult) {
    return res.status(429).json(JSON.parse(await rateLimitResult.text()));
  }

  if (req.method !== "POST") {
    return res.status(405).json({ status: "method_not_allowed" });
  }

  const { recipient, amount, comment } = req.body || {};

  if (!recipient || !amount) {
    return res.status(400).json({
      status: "missing_params",
      message: "Missing recipient or amount",
    });
  }

  // Input validation
  if (typeof recipient !== "string" || recipient.length > 100) {
    return res.status(400).json({
      status: "invalid_recipient",
      message: "Invalid recipient format",
    });
  }

  // Validate amount: must be positive integer, reasonable max (10M sats = ~$4000)
  const amountNum = Number(amount);
  if (!Number.isInteger(amountNum) || amountNum <= 0 || amountNum > 10000000) {
    return res.status(400).json({
      status: "invalid_amount",
      message:
        "Amount must be a positive integer between 1 and 10,000,000 sats",
    });
  }

  // Validate comment length
  if (comment && (typeof comment !== "string" || comment.length > 500)) {
    return res.status(400).json({
      status: "invalid_comment",
      message: "Comment must be a string with max 500 characters",
    });
  }

  try {
    // Try to fetch recipient's Nostr profile to get lud16/lnurl automatically
    const { recipient, lud16, lnurl } = req.body || {};

    let finalLud16 = lud16;
    let finalLnurl = lnurl;

    // If recipient is provided but no lud16/lnurl, try to fetch from Nostr
    if (recipient && !finalLud16 && !finalLnurl) {
      try {
        const metadata = await fetchUserMetadata(recipient);
        if (metadata) {
          finalLud16 = metadata.lud16;
          finalLnurl = metadata.lnurl;
        }
      } catch (error) {
        console.warn("Failed to fetch recipient metadata from Nostr:", error);
        // Continue - user can still provide lud16/lnurl directly
      }
    }

    if (!finalLud16 && !finalLnurl) {
      return res.status(400).json({
        status: "missing_lightning_address",
        message:
          "Recipient's Lightning address (lud16 or lnurl) is required. Provide either: (1) recipient pubkey/npub to auto-fetch, or (2) lud16/lnurl directly.",
      });
    }

    // Validate lightning address format
    if (
      finalLud16 &&
      (typeof finalLud16 !== "string" ||
        !/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(finalLud16))
    ) {
      return res.status(400).json({
        status: "invalid_lud16",
        message: "Invalid Lightning address format (expected: name@domain.com)",
      });
    }

    if (
      finalLnurl &&
      (typeof finalLnurl !== "string" ||
        (!finalLnurl.startsWith("http://") &&
          !finalLnurl.startsWith("https://") &&
          !finalLnurl.toLowerCase().startsWith("lnurl")))
    ) {
      return res.status(400).json({
        status: "invalid_lnurl",
        message: "Invalid LNURL format",
      });
    }

    const amountMsat = amountNum * 1000; // Convert sats to millisats

    let invoice: string;

    // Prioritize LUD-16 over LNURL (LUD-16 is more reliable)
    if (finalLud16) {
      try {
        invoice = await createInvoiceFromLightningAddress(
          finalLud16,
          amountMsat,
          comment
        );
      } catch (lud16Error: any) {
        // If LUD-16 fails and we have LNURL, try LNURL as fallback
        if (finalLnurl) {
          console.warn(
            "LUD-16 failed, falling back to LNURL:",
            lud16Error.message
          );
          try {
            invoice = await createInvoiceFromLNURL(
              finalLnurl,
              amountMsat,
              comment
            );
          } catch (lnurlError: any) {
            throw new Error(
              `Both LUD-16 and LNURL failed. LUD-16: ${lud16Error.message}, LNURL: ${lnurlError.message}`
            );
          }
        } else {
          throw lud16Error;
        }
      }
    } else if (finalLnurl) {
      invoice = await createInvoiceFromLNURL(finalLnurl, amountMsat, comment);
    } else {
      throw new Error("No Lightning address provided");
    }

    return res.status(200).json({
      paymentRequest: invoice,
      status: "ok",
    });
  } catch (error: any) {
    console.error("Failed to create invoice:", error.message);
    return res.status(500).json({
      status: "error",
      message:
        error.message ||
        "Failed to create invoice from recipient's Lightning address",
    });
  }
}
