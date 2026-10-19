import {
  handlePaymentOptionsRequest,
  setPaymentCorsHeaders,
} from "@/lib/api/cors";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Closed. This route used to post to the public Telegram channel with the
 * server bot token and caller-supplied text, with no login check.
 * Channel posts now happen only after a bounty payment succeeds on the server.
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
