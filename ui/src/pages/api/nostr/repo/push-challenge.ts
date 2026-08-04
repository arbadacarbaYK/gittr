import { rateLimiters } from "@/app/api/middleware/rate-limit";
import {
  issuePushChallenge,
  pushChallengeTtlSeconds,
} from "@/lib/nostr/push-challenge-store";

import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const rateLimitResult = await rateLimiters.pushChallenge(req as any);
  if (rateLimitResult) {
    const body = await rateLimitResult.json();
    res.setHeader(
      "Retry-After",
      rateLimitResult.headers.get("Retry-After") ?? "60"
    );
    return res.status(429).json(body);
  }

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Nostr-Pubkey, X-Nostr-Signature, X-Nostr-Auth-Event"
    );
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const challenge = issuePushChallenge();

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    challenge,
    expires_in: pushChallengeTtlSeconds(),
    instructions: [
      "Sign a kind-24242 event with tags: [[\"challenge\", \"<challenge>\"]]",
      "Send header X-Nostr-Auth-Event: base64(JSON.stringify(signedEvent))",
      "Challenge is multi-use until expiry (chunked pushes / Amber cache).",
    ],
  });
}
