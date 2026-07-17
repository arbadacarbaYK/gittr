/**
 * Server-side utility for resolving repository icons and user profile pictures
 * for Open Graph metadata generation.
 *
 * Social crawlers (Telegram, X) require HTTPS URLs that return raw image bytes.
 * Never use /api/nostr/repo/file-content here — it returns JSON.
 */
import {
  fetchRepoLogoUrlFromNostr,
  readRepoLogoFromBridge,
} from "@/lib/og-repo-image";

import { nip19 } from "nostr-tools";

function resolveEntityToPubkey(entity: string): string | null {
  if (!entity) return null;

  if (/^[0-9a-f]{64}$/i.test(entity)) {
    return entity.toLowerCase();
  }

  if (entity.startsWith("npub")) {
    try {
      const decoded = nip19.decode(entity);
      if (decoded.type === "npub") {
        return decoded.data as string;
      }
    } catch {
      // Invalid npub
    }
  }

  return null;
}

function cleanRepoName(repoName: string): string {
  let decodedRepo = repoName;
  try {
    if (repoName.includes("%")) {
      decodedRepo = decodeURIComponent(repoName);
    }
  } catch {
    decodedRepo = repoName;
  }
  if (decodedRepo.includes("/")) {
    const parts = decodedRepo.split("/");
    decodedRepo = parts[parts.length - 1] || decodedRepo;
  }
  return decodedRepo.replace(/\.git$/, "");
}

/**
 * Resolve a crawler-safe repository icon URL.
 *
 * Priority:
 * 1. HTTPS logo from kind 30617 `web` tags (announcement)
 * 2. `/api/og/repo-image` when logo.png (etc.) exists on the bridge
 * 3. Platform default card — caller should try owner profile picture next
 */
export async function resolveRepoIconForMetadata(
  entity: string,
  repoName: string,
  baseUrl: string
): Promise<string> {
  const defaultCard = `${baseUrl}/opengraph-image`;
  const ownerPubkey = resolveEntityToPubkey(entity);
  if (!ownerPubkey) return defaultCard;

  const cleanedRepo = cleanRepoName(repoName);

  // 1) Logo URL published on the Nostr announcement (external HTTPS image)
  try {
    const announcedLogo = await fetchRepoLogoUrlFromNostr(
      ownerPubkey,
      cleanedRepo,
      1000
    );
    if (announcedLogo && announcedLogo.startsWith("https://")) {
      return announcedLogo;
    }
  } catch {
    // fall through
  }

  // 2) Logo file in the bridge bare repo — dedicated binary OG endpoint
  try {
    const onDisk = await readRepoLogoFromBridge(ownerPubkey, cleanedRepo);
    if (onDisk) {
      return `${baseUrl}/api/og/repo-image?ownerPubkey=${encodeURIComponent(
        ownerPubkey
      )}&repo=${encodeURIComponent(cleanedRepo)}`;
    }
  } catch {
    // fall through
  }

  return defaultCard;
}

/**
 * Resolves user profile picture URL for Open Graph metadata.
 * Returns platform default when no HTTPS profile picture is available.
 */
export async function resolveUserIconForMetadata(
  entity: string,
  baseUrl: string,
  timeoutMs = 1000
): Promise<string> {
  const defaultCard = `${baseUrl}/opengraph-image`;
  const ownerPubkey = resolveEntityToPubkey(entity);

  if (!ownerPubkey) {
    return defaultCard;
  }

  try {
    const { fetchUserMetadata } = await import(
      "@/lib/nostr/fetch-metadata-server"
    );
    const ownerMetadata = await Promise.race([
      fetchUserMetadata(ownerPubkey),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), timeoutMs)
      ),
    ]);

    const picture = ownerMetadata?.picture;
    if (typeof picture === "string" && picture.startsWith("https://")) {
      return picture;
    }
  } catch (error) {
    console.warn(
      "[Metadata Icon Resolver] Failed to fetch user metadata:",
      error
    );
  }

  return defaultCard;
}
