/**
 * Mention Detection Utilities
 * 
 * Detects @mentions in text and resolves them to pubkeys for notifications.
 * Supports:
 * - @npub[bech32] - Standard Nostr npub format
 * - @[64-char-hex] - Full pubkey (64 hex characters)
 */

import { nip19 } from "nostr-tools";

export interface Mention {
  text: string; // The full @mention text (e.g., "@npub1...")
  pubkey: string; // Resolved 64-char pubkey
  npub?: string; // npub format if original was npub
  startIndex: number; // Start position in text
  endIndex: number; // End position in text
}

/**
 * Detects @mentions in text and resolves them to pubkeys
 * 
 * @param text - Text to search for mentions
 * @returns Array of detected mentions with resolved pubkeys
 */
export function detectMentions(text: string): Mention[] {
  if (!text || typeof text !== "string") {
    return [];
  }

  const mentions: Mention[] = [];
  
  // Pattern 1: @npub[bech32-encoded] (standard Nostr format)
  // Matches @npub followed by bech32 characters (a-z, 0-9)
  const npubPattern = /@(npub[0-3][qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58})/gi;
  let match: RegExpExecArray | null;
  
  while ((match = npubPattern.exec(text)) !== null) {
    const npub = match[1];
    if (!npub) continue;
    try {
      const decoded = nip19.decode(npub);
      if (decoded.type === "npub") {
        const pubkey = decoded.data as string;
        mentions.push({
          text: match[0] || `@${npub}`, // Full match including @
          pubkey: pubkey.toLowerCase(),
          npub: npub,
          startIndex: match.index ?? -1,
          endIndex: (match.index ?? -1) + (match[0]?.length ?? 0),
        });
      }
    } catch {
      // Invalid npub, skip
    }
  }
  
  // Pattern 2: @[64-char-hex-pubkey]
  // Matches @ followed by exactly 64 hex characters
  // Use word boundary to avoid matching partial pubkeys in longer strings
  const pubkeyPattern = /@([0-9a-f]{64})\b/gi;
  
  // Reset regex lastIndex
  pubkeyPattern.lastIndex = 0;
  
  while ((match = pubkeyPattern.exec(text)) !== null) {
    if (!match) continue;
    const pubkey = match[1];
    if (!pubkey) continue;
    // Validate it's a valid hex string
    if (/^[0-9a-f]{64}$/i.test(pubkey)) {
      const matchIndex = match.index ?? -1;
      const matchText = match[0] || `@${pubkey}`;
      // Check if this mention was already captured as an npub
      const alreadyFound = mentions.some(m => 
        m.pubkey.toLowerCase() === pubkey.toLowerCase() &&
        m.startIndex === matchIndex
      );
      
      if (!alreadyFound) {
        mentions.push({
          text: matchText, // Full match including @
          pubkey: pubkey.toLowerCase(),
          startIndex: matchIndex,
          endIndex: matchIndex + matchText.length,
        });
      }
    }
  }
  
  // Remove duplicates (same pubkey at same position)
  const uniqueMentions = mentions.filter((mention, index, self) => 
    index === self.findIndex(m => 
      m.pubkey === mention.pubkey && 
      m.startIndex === mention.startIndex
    )
  );
  
  return uniqueMentions;
}

/**
 * Extracts unique pubkeys from mentions
 * 
 * @param text - Text to search for mentions
 * @returns Array of unique pubkeys (64-char hex)
 */
export function extractMentionedPubkeys(text: string): string[] {
  const mentions = detectMentions(text);
  const pubkeys = new Set<string>();
  
  mentions.forEach(mention => {
    if (mention.pubkey && /^[0-9a-f]{64}$/i.test(mention.pubkey)) {
      pubkeys.add(mention.pubkey.toLowerCase());
    }
  });
  
  return Array.from(pubkeys);
}

/**
 * Highlights mentions in text (for display purposes)
 * 
 * @param text - Text containing mentions
 * @returns Text with mentions wrapped in spans (for React rendering)
 */
export function highlightMentions(text: string): (string | JSX.Element)[] {
  const mentions = detectMentions(text);
  
  if (mentions.length === 0) {
    return [text];
  }
  
  // Sort mentions by start index (descending) to replace from end to start
  const sortedMentions = [...mentions].sort((a, b) => b.startIndex - a.startIndex);
  
  const parts: (string | JSX.Element)[] = [];
  let lastIndex = text.length;
  
  sortedMentions.forEach((mention, index) => {
    // Add text after mention
    if (mention.endIndex < lastIndex) {
      parts.unshift(text.substring(mention.endIndex, lastIndex));
    }
    
    // Add highlighted mention
    parts.unshift(
      <span key={`mention-${index}`} className="text-purple-400 font-semibold">
        {mention.text}
      </span>
    );
    
    // Add text before mention
    if (mention.startIndex > 0) {
      const beforeText = text.substring(0, mention.startIndex);
      if (beforeText) {
        parts.unshift(beforeText);
      }
    }
    
    lastIndex = mention.startIndex;
  });
  
  // Add any remaining text at the beginning
  if (lastIndex > 0) {
    parts.unshift(text.substring(0, lastIndex));
  }
  
  return parts;
}

