import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import { createSSHKeyEvent } from "@/lib/nostr/events";

import type { NextApiRequest, NextApiResponse } from "next";

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

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { publicKey, title, privateKey } = req.body;

    if (!publicKey) {
      return res.status(400).json({ error: "publicKey is required" });
    }

    if (!privateKey) {
      return res
        .status(400)
        .json({ error: "privateKey is required for signing" });
    }

    const sshKeyEvent = createSSHKeyEvent({ publicKey, title }, privateKey);

    // Return the event for client to publish
    // Client should publish to Nostr relays
    return res.status(200).json({
      event: sshKeyEvent,
      keyId: sshKeyEvent.id,
      message: "SSH key event created. Publish to Nostr relays to activate.",
    });
  } catch (error: any) {
    const message = error.message || "Failed to create SSH key event";
    if (/Invalid (SSH key|key type)/.test(message)) {
      return res.status(400).json({ error: message });
    }
    console.error("Error creating SSH key event:", error);
    return res.status(500).json({ error: message });
  }
}
