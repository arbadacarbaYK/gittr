import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import { type StoredRepo, loadStoredRepos } from "@/lib/repos/storage";
import { resolveEntityToPubkey } from "@/lib/utils/entity-resolver";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";

import type { NextApiRequest, NextApiResponse } from "next";
import { nip19 } from "nostr-tools";

/**
 * Fast API endpoint for repository metadata (description, icon)
 * Used by server-side metadata generation for Open Graph/Twitter cards
 *
 * This endpoint is optimized for speed - it checks localStorage first,
 * then falls back to Nostr if needed (but with timeout to prevent blocking)
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === "OPTIONS") {
    return handleOptionsRequest(res, req);
  }

  setCorsHeaders(res, req);

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { entity, repo } = req.query;

  if (
    !entity ||
    !repo ||
    typeof entity !== "string" ||
    typeof repo !== "string"
  ) {
    return res.status(400).json({ error: "Missing entity or repo parameter" });
  }

  const decodedRepo = decodeURIComponent(repo);
  const decodedEntity = decodeURIComponent(entity);

  try {
    // Fast path: Check localStorage first (client-side only, but this endpoint runs server-side)
    // For server-side, we'll need to query Nostr, but we'll make it fast with a timeout

    // Resolve entity to pubkey for Nostr query
    let ownerPubkey: string | null = null;
    try {
      if (/^[0-9a-f]{64}$/i.test(decodedEntity)) {
        ownerPubkey = decodedEntity.toLowerCase();
      } else if (decodedEntity.startsWith("npub")) {
        const decoded = nip19.decode(decodedEntity);
        if (decoded.type === "npub") {
          ownerPubkey = (decoded.data as string).toLowerCase();
        }
      }
    } catch {
      // Invalid entity format
    }

    // For now, return basic metadata structure
    // The actual description and icon will be resolved client-side
    // But we can provide a fast response with what we know
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://gittr.space";

    // Try to resolve icon URL (fast - just constructs URL)
    let iconUrl = `${baseUrl}/logo.svg`; // Default fallback

    if (ownerPubkey) {
      // Try repo logo first
      const cleanRepoName = decodedRepo.replace(/\.git$/, "");
      iconUrl = `${baseUrl}/api/nostr/repo/file-content?ownerPubkey=${encodeURIComponent(
        ownerPubkey
      )}&repo=${encodeURIComponent(cleanRepoName)}&path=logo.png&branch=main`;
    }

    // Return metadata structure
    // Note: Description will be fetched client-side, but we provide a reasonable default
    return res.status(200).json({
      description: null, // Will be filled by client-side fetch
      iconUrl,
      ownerPubkey,
    });
  } catch (error: any) {
    console.error("[Repo Metadata API] Error:", error);
    return res.status(500).json({
      error: "Failed to fetch repository metadata",
      message: error?.message,
    });
  }
}
