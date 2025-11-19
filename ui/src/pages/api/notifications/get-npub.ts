import type { NextApiRequest, NextApiResponse } from "next";
import { setCorsHeaders, handleOptionsRequest } from "@/lib/api/cors";

/**
 * Get current user's npub from notification preferences
 * This is a client-side helper - returns instructions for getting npub
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handle OPTIONS request for CORS
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res);
    return;
  }

  // Set CORS headers
  setCorsHeaders(res);

  if (req.method !== "GET") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  // Server-side can't access localStorage, so we return instructions
  return res.status(200).json({ 
    message: "Get npub from client-side",
    instructions: [
      "1. Open browser console on http://localhost:3000/settings/notifications",
      "2. Run: JSON.parse(localStorage.getItem('gittr_notifications'))?.channels?.nostr?.npub",
      "3. Or check the notifications settings page - it auto-populates if you're logged in"
    ],
    hint: "The npub field in notification preferences is auto-populated when you're logged in"
  });
}

