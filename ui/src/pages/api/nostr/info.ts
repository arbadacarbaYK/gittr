import type { NextApiRequest, NextApiResponse } from "next";
import { setCorsHeaders, handleOptionsRequest } from "@/lib/api/cors";

/**
 * NIP-11 Relay Information Document
 * GRASP protocol requires this endpoint to list supported GRASP versions
 * 
 * Endpoint: GET /api/nostr/info
 * Returns: JSON document with relay information including supported_grasps
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handle OPTIONS request for CORS (GRASP requirement)
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res);
    return;
  }

  // Set CORS headers (GRASP requirement)
  setCorsHeaders(res);

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Get domain from environment or request
  const domain = process.env.NEXT_PUBLIC_DOMAIN || 
    (typeof req.headers.host !== 'undefined' ? req.headers.host : 'localhost:3000');
  
  const protocol = process.env.NEXT_PUBLIC_PROTOCOL || 
    (req.headers['x-forwarded-proto'] || (req.headers.host?.includes('localhost') ? 'http' : 'https'));
  
  const baseUrl = `${protocol}://${domain}`;
  
  // Get git server URL from environment
  const gitServerUrl = process.env.NEXT_PUBLIC_GIT_SERVER_URL || baseUrl;
  
  // Get default relays from environment
  const defaultRelays = process.env.NEXT_PUBLIC_NOSTR_RELAYS?.split(',').map(r => r.trim()).filter(Boolean) || 
    ['wss://relay.damus.io'];

  // NIP-11 document with GRASP protocol support
  const nip11Document = {
    name: "gittr Relay",
    description: "Gittr client with GRASP protocol support for distributed Git hosting",
    pubkey: null, // This is a client, not a relay - no pubkey
    contact: process.env.NEXT_PUBLIC_CONTACT_EMAIL || "",
    software: "gittr",
    version: "1.0.0",
    // GRASP protocol: List supported GRASP versions
    supported_grasps: [
      "GRASP-01", // Core Service Requirements (client-side)
      // Note: GRASP-02 (Proactive Sync) and GRASP-05 (Archive) require server-side implementation
      // Full GRASP compliance requires gittr-relay setup (see docs/GRASP_RELAY_SETUP.md)
    ],
    // GRASP protocol: Repository acceptance criteria
    repo_acceptance_criteria: "Accepts all public repository announcements (kind 51) that list this instance in clone or relays tags. For GRASP-05 archive mode, also accepts repos not listing this instance.",
    // Git server information
    git_server_url: gitServerUrl,
    // Relay information (if this instance also runs a relay)
    relay_url: process.env.NEXT_PUBLIC_RELAY_URL || null,
    // Supported event kinds
    supported_nips: [1, 11, 19, 33, 57, 96], // NIP-01 (Notes), NIP-11 (Relay Info), NIP-19 (bech32), NIP-33 (replaceable events), NIP-57 (Zaps), NIP-96 (Blossom)
    // Custom event kinds for gittr
    custom_kinds: {
      50: "Repository Permissions",
      51: "Repository Announcements",
      52: "SSH Keys",
      9803: "Issues",
      9804: "Pull Requests",
    },
  };

  return res.status(200).json(nip11Document);
}

