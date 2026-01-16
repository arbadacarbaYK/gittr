/**
 * Payment message utilities
 * Formats payment messages for zaps, bounties, and other payments
 */

/**
 * Format a payment message with username, platform attribution, and bolt emojis
 * Format: "{username} via gittr.space ⚡⚡"
 * Max length: 160 characters
 *
 * @param username - The sender's display name (from Nostr metadata or session)
 * @param maxLength - Maximum message length (default: 160)
 * @returns Formatted payment message
 */
export function formatPaymentMessage(
  username?: string | null,
  maxLength: number = 160
): string {
  // Default username if not provided
  const displayName = username || "Anonymous";

  // Base message: "{username} via gittr.space ⚡⚡"
  const baseMessage = `${displayName} via gittr.space ⚡⚡`;

  // If message exceeds max length, truncate username
  if (baseMessage.length > maxLength) {
    const platformPart = " via gittr.space ⚡⚡"; // 23 chars
    const maxUsernameLength = maxLength - platformPart.length;
    const truncatedUsername = displayName.substring(
      0,
      Math.max(1, maxUsernameLength)
    );
    return `${truncatedUsername}${platformPart}`;
  }

  return baseMessage;
}

/**
 * Get the current user's display name for payment messages
 * Uses Nostr metadata if available, otherwise falls back to npub or pubkey prefix
 *
 * @param pubkey - User's pubkey
 * @param metadataMap - Nostr metadata map from useContributorMetadata hook
 * @returns Display name for payment message
 */
export function getPaymentSenderName(
  pubkey: string | null | undefined,
  metadataMap: Record<string, any>
): string | null {
  if (!pubkey) return null;

  // Normalize pubkey to lowercase for metadata lookup
  const normalizedPubkey = pubkey.toLowerCase();
  const meta = metadataMap[normalizedPubkey] || metadataMap[pubkey];

  if (meta) {
    // Prefer name, then display_name, but avoid "Anonymous Nostrich"
    const name = meta.name || meta.display_name;
    if (name && name.trim().length > 0 && name !== "Anonymous Nostrich") {
      return name;
    }
  }

  // Fallback: try to encode as npub and show shortened version
  if (pubkey && /^[0-9a-f]{64}$/i.test(pubkey)) {
    try {
      // Dynamic import of nip19 to avoid SSR issues
      if (typeof window !== "undefined") {
        const { nip19 } = require("nostr-tools");
        const npub = nip19.npubEncode(pubkey);
        return npub.substring(0, 12) + "...";
      }
    } catch {
      // If encoding fails, use pubkey prefix
    }
  }

  // Last resort: use pubkey prefix (8 chars)
  return pubkey ? pubkey.slice(0, 8) : null;
}
