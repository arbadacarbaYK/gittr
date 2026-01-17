import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * NIP-11 Relay Information Document
 * GRASP protocol requires this endpoint to list supported GRASP versions
 *
 * Endpoint: GET /api/nostr/info
 * Returns: JSON document with relay information including supported_grasps
 */
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

  // Get domain from environment or request
  const domain =
    process.env.NEXT_PUBLIC_DOMAIN ||
    (typeof req.headers.host !== "undefined"
      ? req.headers.host
      : "localhost:3000");

  const protocol =
    process.env.NEXT_PUBLIC_PROTOCOL ||
    req.headers["x-forwarded-proto"] ||
    (req.headers.host?.includes("localhost") ? "http" : "https");

  const baseUrl = `${protocol}://${domain}`;

  // Get git server URL from environment
  const gitServerUrl = process.env.NEXT_PUBLIC_GIT_SERVER_URL || baseUrl;

  // Get default relays from environment
  const defaultRelays = process.env.NEXT_PUBLIC_NOSTR_RELAYS?.split(",")
    .map((r) => r.trim())
    .filter(Boolean) || ["wss://relay.damus.io"];

  // Get platform pubkey for NIP-05 verification (optional)
  const platformPubkey = process.env.NEXT_PUBLIC_PLATFORM_PUBKEY || null;

  // NIP-11 document with GRASP protocol support
  const nip11Document = {
    name: "gittr Relay",
    description:
      "Gittr client with GRASP protocol support for distributed Git hosting",
    pubkey: platformPubkey, // Platform pubkey for NIP-05 verification (e.g., _@gittr.space)
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
    repo_acceptance_criteria:
      "Accepts all public repository announcements (kind 30617, NIP-34 replaceable events) that list this instance in clone or relays tags. Also reads legacy kind 51 for backwards compatibility. For GRASP-05 archive mode, also accepts repos not listing this instance.",
    // Git server information
    git_server_url: gitServerUrl,
    // Relay information (if this instance also runs a relay)
    relay_url: process.env.NEXT_PUBLIC_RELAY_URL || null,
    // Supported event kinds
    supported_nips: [1, 11, 19, 22, 33, 34, 57, 96], // NIP-01 (Notes), NIP-11 (Relay Info), NIP-19 (bech32), NIP-22 (Comments), NIP-33 (replaceable events), NIP-34 (Git Repositories), NIP-57 (Zaps), NIP-96 (Blossom)
    // Custom event kinds for gittr
    custom_kinds: {
      50: "Repository Permissions",
      51: "Repository Announcements (legacy, read-only)",
      52: "SSH Keys",
      1337: "Code Snippets (NIP-C0)",
      1111: "Comments (NIP-22)",
      1617: "Patches (NIP-34)",
      1618: "Pull Requests (NIP-34)",
      1619: "Pull Request Updates (NIP-34)",
      1621: "Issues (NIP-34)",
      1630: "Status: Open (NIP-34)",
      1631: "Status: Applied/Merged (NIP-34)",
      1632: "Status: Closed (NIP-34)",
      1633: "Status: Draft (NIP-34)",
      10317: "User GRASP List (NIP-34)",
      30617: "Repository Metadata (NIP-34, primary publishing method)",
      30618: "Repository State (NIP-34, required for ngit clients)",
      9735: "Zaps (NIP-57)",
      9803: "Issues (legacy, deprecated)",
      9804: "Pull Requests (legacy, deprecated)",
    },
  };

  return res.status(200).json(nip11Document);
}
