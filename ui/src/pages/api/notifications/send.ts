import {
  handlePaymentOptionsRequest,
  setPaymentCorsHeaders,
} from "@/lib/api/cors";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Closed. This route used to send platform Nostr DMs with the server key
 * for whatever recipient and text the caller sent.
 * Delivery goes through POST /api/notifications/deliver.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === "OPTIONS") {
    handlePaymentOptionsRequest(res, req);
    return;
  }

  setPaymentCorsHeaders(res, req);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  return res.status(401).json({ error: "unauthorized" });
}
