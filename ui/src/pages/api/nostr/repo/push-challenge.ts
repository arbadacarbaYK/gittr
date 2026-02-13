import type { NextApiRequest, NextApiResponse } from "next";
import { generateChallenge } from "./push-auth";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Nostr-Pubkey, X-Nostr-Signature");
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // For GET, we just return a static challenge that clients can sign
  // In production, you might want this to be dynamic per-session
  const challenge = {
    challenge: "gittr:push:" + Date.now(),
    instructions: [
      "Sign this challenge with your Nostr private key",
      "Include the signature in Authorization header: Nostr <base64-encoded-{pubkey, sig, created_at}>",
      "Or use X-Nostr-Pubkey and X-Nostr-Signature headers directly"
    ]
  };

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(challenge);
}
