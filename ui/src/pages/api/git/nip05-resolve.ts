import type { NextApiRequest, NextApiResponse } from "next";
import { nip05, nip19 } from "nostr-tools";

/**
 * API endpoint to resolve NIP-05 identifiers to npub format for git.gittr.space URLs
 *
 * This endpoint is used by nginx to resolve NIP-05 format URLs like:
 * https://git.gittr.space/geek@primal.net/nostr-hypermedia.git
 *
 * It resolves the NIP-05 to an npub and redirects to:
 * https://git.gittr.space/npub1.../nostr-hypermedia.git
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Extract entity and repo from query params or path
  // Format: ?entity=geek@primal.net&repo=nostr-hypermedia.git
  // Or from path: /api/git/nip05-resolve/geek@primal.net/nostr-hypermedia.git
  const { entity, repo } = req.query;

  let entityStr = typeof entity === "string" ? entity : "";
  let repoStr = typeof repo === "string" ? repo : "";

  // If not in query params, try to extract from URL path
  if (!entityStr && req.url) {
    const pathMatch = req.url.match(
      /\/api\/git\/nip05-resolve\/([^\/]+)\/(.+)$/
    );
    if (pathMatch && pathMatch[1] && pathMatch[2]) {
      entityStr = pathMatch[1];
      repoStr = pathMatch[2];
    }
  }

  if (!entityStr) {
    return res
      .status(400)
      .json({ error: "Entity (NIP-05 or npub) is required" });
  }

  if (!repoStr) {
    return res.status(400).json({ error: "Repository name is required" });
  }

  // If already npub or hex, encode to npub and redirect
  if (entityStr.startsWith("npub")) {
    // Already npub format, redirect as-is
    const redirectUrl = `https://git.gittr.space/${entityStr}/${repoStr}`;
    console.log(
      `✅ [NIP-05 Resolve] Already npub format, redirecting to: ${redirectUrl}`
    );
    return res.redirect(301, redirectUrl);
  }

  if (/^[0-9a-f]{64}$/i.test(entityStr)) {
    // Hex pubkey, encode to npub
    try {
      const npub = nip19.npubEncode(entityStr);
      const redirectUrl = `https://git.gittr.space/${npub}/${repoStr}`;
      console.log(
        `✅ [NIP-05 Resolve] Encoded hex to npub, redirecting to: ${redirectUrl}`
      );
      return res.redirect(301, redirectUrl);
    } catch (error: any) {
      return res
        .status(400)
        .json({ error: `Failed to encode pubkey to npub: ${error?.message}` });
    }
  }

  // If NIP-05 format (contains @), resolve it
  if (entityStr.includes("@")) {
    try {
      const profile = await nip05.queryProfile(entityStr);
      if (profile?.pubkey && /^[0-9a-f]{64}$/i.test(profile.pubkey)) {
        // Encode to npub format
        const npub = nip19.npubEncode(profile.pubkey);
        // Ensure repo name ends with .git for git URLs
        const repoWithGit = repoStr.endsWith(".git")
          ? repoStr
          : `${repoStr}.git`;
        const redirectUrl = `https://git.gittr.space/${npub}/${repoWithGit}`;
        console.log(
          `✅ [NIP-05 Resolve] Resolved ${entityStr} to npub ${npub.slice(
            0,
            16
          )}..., redirecting to: ${redirectUrl}`
        );
        return res.redirect(301, redirectUrl);
      }
      return res
        .status(404)
        .json({ error: `NIP-05 ${entityStr} did not return a valid pubkey` });
    } catch (error: any) {
      return res.status(500).json({
        error: `Failed to resolve NIP-05 ${entityStr}: ${
          error?.message || "unknown error"
        }`,
      });
    }
  }

  return res.status(400).json({
    error: `Invalid entity format: must be npub, hex pubkey, or NIP-05 (received: ${entityStr})`,
  });
}
