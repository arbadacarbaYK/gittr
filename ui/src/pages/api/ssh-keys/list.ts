import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";

import type { NextApiRequest, NextApiResponse } from "next";

// Note: SSH keys are stored in Nostr relays as KIND_SSH_KEY events
// This endpoint would need to query Nostr relays, but for MVP we'll return
// keys stored locally (from user's published events)
// In production, this should query Nostr relays directly

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

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Get user's pubkey from session (if available)
    // For now, return empty list - client-side will fetch from Nostr
    return res.status(200).json({
      keys: [],
      message:
        "SSH keys are stored in Nostr. Use client-side Nostr queries to fetch them.",
    });
  } catch (error: any) {
    console.error("Error listing SSH keys:", error);
    return res.status(500).json({
      error: error.message || "Failed to list SSH keys",
    });
  }
}
