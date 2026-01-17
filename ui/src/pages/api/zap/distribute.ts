import { rateLimiters } from "@/app/api/middleware/rate-limit";
import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";

import type { NextApiRequest, NextApiResponse } from "next";

interface Recipient {
  pubkey?: string;
  lud16?: string;
  lnurl?: string;
  amount: number; // sats
  comment?: string;
}

interface DistributeRequest {
  recipients: Recipient[];
  feeMode?: "gross" | "cap"; // currently informational; LNbits handles fees
  lnbitsUrl?: string;
  lnbitsAdminKey?: string;
}

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
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { recipients, feeMode, lnbitsUrl, lnbitsAdminKey } = (req.body ||
    {}) as DistributeRequest;

  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: "no_recipients" });
  }
  if (!lnbitsUrl || !lnbitsAdminKey) {
    return res.status(400).json({ error: "missing_lnbits_config" });
  }

  const results: Array<{
    idx: number;
    status: string;
    error?: string;
    checking_id?: string;
  }> = [];

  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    if (!r) continue;
    try {
      const destination = r.lud16 || r.lnurl;
      if (!destination) {
        results.push({ idx: i, status: "skipped", error: "no_destination" });
        continue;
      }

      // Pay via lnurl endpoint
      const payResp = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/pay/lnurl`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            destination,
            amount: r.amount,
            comment: r.comment,
            lnbitsUrl,
            lnbitsAdminKey,
          }),
        }
      );

      const payJson = await payResp.json();
      if (!payResp.ok || payJson.error) {
        results.push({
          idx: i,
          status: "failed",
          error: payJson.error || "payment_failed",
        });
      } else {
        results.push({
          idx: i,
          status: "ok",
          checking_id: payJson.checking_id,
        });
      }
    } catch (e: any) {
      results.push({
        idx: i,
        status: "failed",
        error: e.message || "payment_failed",
      });
    }
  }

  return res.status(200).json({ status: "ok", results });
}
