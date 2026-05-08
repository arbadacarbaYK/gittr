import { rateLimiters } from "@/app/api/middleware/rate-limit";
import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import { resolveLnbitsUrl } from "@/lib/payments/lnbits-url";
import {
  validatePaymentAmount,
  validateTextContent,
  validateUrl,
} from "@/lib/security/input-validation";

import type { NextApiRequest, NextApiResponse } from "next";

// Create bounty invoice for an issue
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

  const { amount, issueId, description, lnbitsUrl, lnbitsAdminKey } =
    req.body || {};

  if (!amount || !issueId) {
    return res.status(400).json({
      status: "missing_params",
      message: "Missing required parameters",
    });
  }

  // Input validation
  const amountValidation = validatePaymentAmount(amount);
  if (!amountValidation.valid) {
    return res
      .status(400)
      .json({ status: "invalid_amount", message: amountValidation.error });
  }

  if (typeof issueId !== "string" || issueId.length > 200) {
    return res
      .status(400)
      .json({ status: "invalid_issue_id", message: "Invalid issue ID format" });
  }

  if (description) {
    const descValidation = validateTextContent(
      description,
      1000,
      "Description"
    );
    if (!descValidation.valid) {
      return res
        .status(400)
        .json({ status: "invalid_description", message: descValidation.error });
    }
  }

  // Get LNbits admin key from request body (user config) or environment
  const finalLnbitsAdminKey =
    lnbitsAdminKey || process.env.LNBITS_ADMIN_KEY || "";
  const finalLnbitsUrl = resolveLnbitsUrl(lnbitsUrl);

  if (!finalLnbitsUrl) {
    return res.status(400).json({
      status: "missing_lnbits_url",
      message:
        "LNbits URL required in request or set LNBITS_URL for the server.",
    });
  }

  if (!finalLnbitsAdminKey) {
    return res.status(400).json({
      status: "missing_lnbits_key",
      message: "LNbits admin key required",
    });
  }

  try {
    // Create invoice via LNbits
    const invoiceResponse = await fetch(`${finalLnbitsUrl}/api/v1/payments`, {
      method: "POST",
      headers: {
        "X-Api-Key": finalLnbitsAdminKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        out: false,
        amount: amount,
        memo: `Bounty for issue ${issueId}: ${description || ""}`,
        extra: {
          issueId,
          type: "bounty",
        },
      }),
    });

    if (!invoiceResponse.ok) {
      throw new Error("Failed to create bounty invoice");
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const invoiceData = await invoiceResponse.json();

    // Note: Bounty events are published to Nostr relays from the frontend (kind 9806)
    // See: ui/src/app/[entity]/[repo]/issues/[id]/page.tsx handleBountyCreated()

    return res.status(200).json({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      invoice: invoiceData.payment_request,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      paymentHash: invoiceData.payment_hash,
      status: "ok",
    });
  } catch (error: any) {
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to create bounty",
    });
  }
}
