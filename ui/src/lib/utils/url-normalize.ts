/**
 * Automatically adds https:// prefix to URLs if missing
 * Only applies to URLs that look like web addresses (not lightning addresses, NWC, etc.)
 */
export function normalizeUrl(input: string): string {
  if (!input || typeof input !== "string") return input;

  const trimmed = input.trim();

  // If already has protocol, return as-is
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  // If starts with special protocols (nostr:, lightning:, data:, etc.), return as-is
  if (trimmed.includes(":") && !trimmed.includes("/")) {
    // Check if it's a protocol-like string (nostr+walletconnect, lightning:lnurl, etc.)
    const protocolMatch = trimmed.match(/^([a-z+]+):/i);
    if (protocolMatch) {
      return trimmed;
    }
  }

  // If it's a data URL, return as-is
  if (trimmed.startsWith("data:")) {
    return trimmed;
  }

  // If it's a relative path (starts with /), return as-is
  if (trimmed.startsWith("/")) {
    return trimmed;
  }

  // If it looks like a lightning address (name@domain), return as-is
  if (/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmed)) {
    return trimmed;
  }

  // If it looks like an NWC string (nostr+walletconnect://), return as-is
  if (
    trimmed.startsWith("nostr+walletconnect://") ||
    trimmed.startsWith("nostr+walletconnect:")
  ) {
    return trimmed;
  }

  // If it looks like an lnurl1... string, return as-is
  if (trimmed.startsWith("lnurl1") || trimmed.startsWith("LNURL1")) {
    return trimmed;
  }

  // If it contains a domain-like pattern (has dots and looks like a domain), add https://
  // Pattern: has at least one dot, and looks like a domain (not just a filename)
  if (
    trimmed.includes(".") &&
    !trimmed.startsWith(".") &&
    !trimmed.endsWith(".")
  ) {
    // Check if it looks like a domain (has TLD-like pattern)
    const domainPattern = /^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}/;
    const firstPart = trimmed.split("/")[0]?.split("?")[0];
    if (firstPart && domainPattern.test(firstPart)) {
      return `https://${trimmed}`;
    }
  }

  // If it looks like a GitHub URL pattern (github.com/...), add https://
  if (trimmed.includes("github.com")) {
    return `https://${trimmed}`;
  }

  // If it's just a domain name (no slashes, no special chars), add https://
  if (/^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/.test(trimmed)) {
    return `https://${trimmed}`;
  }

  // Otherwise, return as-is (might be a relative path, filename, etc.)
  return trimmed;
}

/**
 * Normalize URL on blur (when user finishes typing)
 * This is less aggressive and only applies when user is done
 */
export function normalizeUrlOnBlur(input: string): string {
  if (!input || typeof input !== "string") return input;

  const trimmed = input.trim();

  // If already has protocol, return as-is
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  // Don't modify if it's clearly not a URL (lightning address, NWC, relative path, etc.)
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("nostr+walletconnect://") ||
    trimmed.startsWith("nostr+walletconnect:") ||
    trimmed.startsWith("lnurl1") ||
    trimmed.startsWith("LNURL1") ||
    /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmed)
  ) {
    return trimmed;
  }

  // If it looks like a domain/URL, add https://
  if (
    trimmed.includes(".") &&
    /^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}/.test(trimmed)
  ) {
    return `https://${trimmed}`;
  }

  return trimmed;
}
