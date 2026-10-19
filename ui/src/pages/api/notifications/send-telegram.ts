import {
  handlePaymentOptionsRequest,
  setPaymentCorsHeaders,
} from "@/lib/api/cors";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Closed. This route used to send a Telegram DM with the server bot token
 * and a caller-supplied chat id, with no login check.
 * Real DMs go through POST /api/notifications/deliver, which uses the
 * recipient's saved Telegram id.
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
