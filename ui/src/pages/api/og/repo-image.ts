/**
 * Crawler-safe repository preview image.
 * Returns raw image bytes (not JSON) so Telegram/X/WhatsApp can render og:image.
 *
 * Fallback: 302 redirect to /opengraph-image when no repo logo exists.
 */
import { readRepoLogoFromBridge } from "@/lib/og-repo-image";
import { assertRepoReadAccess } from "@/lib/repo-read-access";
import { getPublicSiteUrl } from "@/lib/utils/public-site-url";

import type { NextApiRequest, NextApiResponse } from "next";
import { nip19 } from "nostr-tools";

function toHexPubkey(input: string): string | null {
  const trimmed = (input || "").trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (trimmed.startsWith("npub")) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === "npub" && typeof decoded.data === "string") {
        return decoded.data.toLowerCase();
      }
    } catch {
      return null;
    }
  }
  return null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).end();
  }

  const ownerRaw = req.query.ownerPubkey;
  const repoRaw = req.query.repo;
  if (
    typeof ownerRaw !== "string" ||
    typeof repoRaw !== "string" ||
    !ownerRaw ||
    !repoRaw
  ) {
    return res.status(400).end();
  }

  const ownerHex = toHexPubkey(ownerRaw);
  if (!ownerHex) {
    return res.status(400).end();
  }

  let repoName = repoRaw;
  try {
    repoName = decodeURIComponent(repoRaw);
  } catch {
    repoName = repoRaw;
  }

  // Private repos: crawlers have no auth — never serve git objects; use default card.
  const access = await assertRepoReadAccess(req, ownerHex, repoName);
  if (!access.ok) {
    const fallback = `${getPublicSiteUrl()}/opengraph-image`;
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.redirect(302, fallback);
  }

  const logo = await readRepoLogoFromBridge(ownerHex, repoName);
  if (!logo) {
    const fallback = `${getPublicSiteUrl()}/opengraph-image`;
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.redirect(302, fallback);
  }

  // SVG previews are unreliable on Telegram/X — redirect to default card.
  if (logo.contentType === "image/svg+xml") {
    const fallback = `${getPublicSiteUrl()}/opengraph-image`;
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.redirect(302, fallback);
  }

  res.setHeader("Content-Type", logo.contentType);
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
  if (req.method === "HEAD") {
    res.setHeader("Content-Length", String(logo.buffer.length));
    return res.status(200).end();
  }
  return res.status(200).send(logo.buffer);
}
