import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import { signGittrCiIdentityProof } from "@/lib/repo/gittr-android-identity-proof";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * POST /api/repo/gittr-android-identity-proof
 *
 * Certificate signature for gittr's own Zapstore ownership proof.
 * Only the official publisher pubkey is signed. The browser still has the
 * owner sign the kind 30509 event.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === "OPTIONS") {
    return handleOptionsRequest(res, req);
  }
  setCorsHeaders(res, req);

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      message: "Method not allowed",
    });
  }

  const pubkey = String(req.body?.pubkey || "");
  const createdAt = Number(req.body?.createdAt);
  try {
    const proof = signGittrCiIdentityProof({
      pubkeyHex: pubkey,
      createdAt,
    });
    return res.status(200).json({ ok: true, ...proof });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not sign the ownership proof.";
    return res.status(400).json({ ok: false, message });
  }
}
