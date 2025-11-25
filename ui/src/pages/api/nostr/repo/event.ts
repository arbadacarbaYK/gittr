import type { NextApiRequest, NextApiResponse } from "next";
import { setCorsHeaders, handleOptionsRequest } from "@/lib/api/cors";

/**
 * Proxy Nostr events directly to git-nostr-bridge HTTP API
 * This allows immediate processing without waiting for relay propagation
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "OPTIONS") {
    return handleOptionsRequest(res);
  }

  setCorsHeaders(res);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const event = req.body;

  if (!event || !event.id || !event.kind) {
    return res.status(400).json({ error: "Invalid event: missing id or kind" });
  }

  // Validate event has required fields for signature verification
  if (!event.pubkey || !event.sig || !event.created_at) {
    console.error(`❌ [Bridge Event API] Event missing required fields:`, {
      hasPubkey: !!event.pubkey,
      hasSig: !!event.sig,
      hasCreatedAt: !!event.created_at,
      eventId: event.id,
      eventKeys: Object.keys(event),
    });
    return res.status(400).json({ 
      error: "Invalid event: missing pubkey, sig, or created_at",
      details: {
        hasPubkey: !!event.pubkey,
        hasSig: !!event.sig,
        hasCreatedAt: !!event.created_at,
      }
    });
  }

  // CRITICAL: Log event structure before sending to bridge for debugging
  console.log(`🔍 [Bridge Event API] Event structure:`, {
    id: event.id?.slice(0, 16) + "...",
    kind: event.kind,
    pubkey: event.pubkey ? `${event.pubkey.slice(0, 8)}...` : "missing",
    sig: event.sig ? `${event.sig.slice(0, 16)}...` : "missing",
    created_at: event.created_at,
    tagsCount: Array.isArray(event.tags) ? event.tags.length : 0,
    contentLength: typeof event.content === "string" ? event.content.length : 0,
    allKeys: Object.keys(event),
  });

  // Bridge HTTP server runs on localhost (same server) or via env var
  const bridgePort = process.env.BRIDGE_HTTP_PORT || "8080";
  const bridgeHost = process.env.BRIDGE_HTTP_HOST || "localhost";
  const bridgeUrl = `http://${bridgeHost}:${bridgePort}/api/event`;

  try {
    const response = await fetch(bridgeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [Bridge Event API] Bridge returned error: ${response.status} ${errorText}`);
      return res.status(response.status).json({
        error: `Bridge error: ${errorText}`,
        status: response.status,
      });
    }

    const result = await response.json();
    console.log(`✅ [Bridge Event API] Event sent to bridge: ${event.id.slice(0, 16)}...`);
    return res.status(200).json(result);
  } catch (error: any) {
    console.error(`❌ [Bridge Event API] Failed to send event to bridge:`, error);
    // Don't fail the request - event was published to relays, bridge will get it eventually
    return res.status(200).json({
      status: "relay_only",
      message: "Event published to relays, bridge will receive it via relay subscription",
      error: error?.message || "Bridge not available",
    });
  }
}

