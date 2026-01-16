/**
 * Input validation and sanitization utilities
 * Prevents XSS, injection attacks, and invalid data
 */

/**
 * Sanitize HTML to prevent XSS attacks
 * Removes script tags and dangerous attributes
 */
export function sanitizeHTML(html: string): string {
  if (typeof window === "undefined") {
    // Server-side: Use DOMPurify or similar
    // For now, return escaped HTML
    return html
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#x27;");
  }

  // Client-side: Use DOMPurify if available, otherwise basic sanitization
  if (typeof (window as any).DOMPurify !== "undefined") {
    return (window as any).DOMPurify.sanitize(html);
  }

  // Basic sanitization: Remove script tags and dangerous attributes
  const div = document.createElement("div");
  div.textContent = html;
  return div.innerHTML;
}

/**
 * Validate and sanitize URL
 */
export function validateURL(url: string): string | null {
  if (!url || typeof url !== "string") return null;

  try {
    // Remove leading/trailing whitespace
    url = url.trim();

    // Add protocol if missing
    if (!url.match(/^https?:\/\//)) {
      url = `https://${url}`;
    }

    const urlObj = new URL(url);

    // Only allow http/https
    if (!["http:", "https:"].includes(urlObj.protocol)) {
      return null;
    }

    // Prevent javascript: and data: URLs
    if (urlObj.protocol === "javascript:" || urlObj.protocol === "data:") {
      return null;
    }

    return urlObj.toString();
  } catch {
    return null;
  }
}

/**
 * Validate GitHub URL specifically
 */
export function validateGitHubURL(url: string): string | null {
  const validated = validateURL(url);
  if (!validated) return null;

  try {
    const urlObj = new URL(validated);
    if (
      urlObj.hostname !== "github.com" &&
      !urlObj.hostname.endsWith(".github.com")
    ) {
      return null;
    }

    return validated;
  } catch {
    return null;
  }
}

/**
 * Validate payment amount (sats)
 */
export function validatePaymentAmount(amount: number | string): number | null {
  const num = typeof amount === "string" ? parseInt(amount, 10) : amount;

  // Must be a positive integer
  if (!Number.isInteger(num) || num < 1) {
    return null;
  }

  // Maximum: 21 million sats (1 Bitcoin) - adjust as needed
  const MAX_AMOUNT = 21000000;
  if (num > MAX_AMOUNT) {
    return null;
  }

  return num;
}

/**
 * Validate Nostr pubkey (hex or npub)
 */
export function validatePubkey(input: string): string | null {
  if (!input || typeof input !== "string") return null;

  input = input.trim();

  // Check if it's an npub
  if (input.startsWith("npub")) {
    try {
      // Will validate format when decoded
      return input;
    } catch {
      return null;
    }
  }

  // Check if it's a hex pubkey (64 chars)
  if (/^[a-f0-9]{64}$/i.test(input)) {
    return input.toLowerCase();
  }

  return null;
}

/**
 * Validate Nostr private key (nsec or hex)
 */
export function validatePrivateKey(input: string): string | null {
  if (!input || typeof input !== "string") return null;

  input = input.trim();

  // Check if it's an nsec
  if (input.startsWith("nsec")) {
    return input;
  }

  // Check if it's a hex private key (64 chars)
  if (/^[a-f0-9]{64}$/i.test(input)) {
    return input.toLowerCase();
  }

  return null;
}

/**
 * Sanitize repository name (slug)
 */
export function sanitizeRepoName(name: string): string {
  if (!name || typeof name !== "string") return "";

  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\-\_]/g, "") // Only alphanumeric, hyphens, underscores
    .replace(/[\-\_]+/g, "-") // Collapse multiple separators
    .replace(/^[\-\_]+|[\-\_]+$/g, "") // Remove leading/trailing
    .slice(0, 100); // Max length
}

/**
 * Sanitize username/entity name
 */
export function sanitizeUsername(name: string): string {
  if (!name || typeof name !== "string") return "";

  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\-\_]/g, "")
    .replace(/[\-\_]+/g, "-")
    .replace(/^[\-\_]+|[\-\_]+$/g, "")
    .slice(0, 39); // Max 39 chars (like GitHub)
}

/**
 * Validate and sanitize email-like input (for Lightning addresses)
 */
export function validateLightningAddress(input: string): string | null {
  if (!input || typeof input !== "string") return null;

  input = input.trim();

  // Format: name@domain
  const match = input.match(/^([a-z0-9_\-]+)@([a-z0-9.\-]+\.[a-z]{2,})$/i);
  if (!match || !match[1] || !match[2]) return null;

  const [, name, domain] = match;

  // Validate name (max 64 chars, alphanumeric + underscore + hyphen)
  if (!name || name.length > 64 || !/^[a-z0-9_\-]+$/i.test(name)) {
    return null;
  }

  // Validate domain (basic)
  if (domain.length > 253 || !/^[a-z0-9.\-]+\.[a-z]{2,}$/i.test(domain)) {
    return null;
  }

  return `${name}@${domain}`;
}

/**
 * Validate and sanitize LNURL
 */
export function validateLNURL(input: string): string | null {
  if (!input || typeof input !== "string") return null;

  input = input.trim();

  // LNURL can be:
  // 1. https://domain/.well-known/lnurlp/...
  // 2. lnurl1dp68gurn8ghj7...
  // 3. lightning:lnurl1dp68gurn8ghj7...

  if (input.startsWith("lnurl1")) {
    return input;
  }

  if (input.startsWith("lightning:lnurl1")) {
    return input.replace("lightning:", "");
  }

  if (input.startsWith("https://") || input.startsWith("http://")) {
    const validated = validateURL(input);
    if (validated && validated.includes(".well-known/lnurl")) {
      return validated;
    }
  }

  return null;
}

/**
 * Validate and sanitize NWC string
 */
export function validateNWC(input: string): string | null {
  if (!input || typeof input !== "string") return null;

  input = input.trim();

  // Format: nostr+walletconnect://<pubkey>?relay=wss://...&secret=...&lud16=...
  if (!input.startsWith("nostr+walletconnect://")) {
    return null;
  }

  try {
    const url = new URL(input);
    if (url.protocol !== "nostr+walletconnect:") {
      return null;
    }

    // Validate required parameters
    const relay = url.searchParams.get("relay");
    const secret = url.searchParams.get("secret");

    if (!relay || !secret) {
      return null;
    }

    // Validate relay is WebSocket URL
    if (!relay.startsWith("wss://") && !relay.startsWith("ws://")) {
      return null;
    }

    return input;
  } catch {
    return null;
  }
}

/**
 * Validate and sanitize text input (for descriptions, comments, etc.)
 */
export function sanitizeText(input: string, maxLength: number = 10000): string {
  if (!input || typeof input !== "string") return "";

  // Remove null bytes and control characters (except newlines and tabs)
  let sanitized = input
    .replace(/\0/g, "")
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "")
    .slice(0, maxLength);

  // Basic XSS prevention: escape HTML
  sanitized = sanitized
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");

  return sanitized;
}

/**
 * Validate JSON input and check for dangerous content
 */
export function validateJSON(input: string): any | null {
  if (!input || typeof input !== "string") return null;

  try {
    const parsed = JSON.parse(input);

    // Check for circular references and excessive depth
    const depth = getObjectDepth(parsed);
    if (depth > 10) {
      return null; // Too deep, might be DoS attempt
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Get maximum depth of nested object
 */
function getObjectDepth(obj: any, currentDepth: number = 0): number {
  if (currentDepth > 10) return currentDepth; // Safety limit
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return currentDepth;
  }

  let maxDepth = currentDepth;
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const depth = getObjectDepth(obj[key], currentDepth + 1);
      maxDepth = Math.max(maxDepth, depth);
    }
  }

  return maxDepth;
}

/**
 * Validate file path (prevent directory traversal)
 */
export function validateFilePath(path: string): string | null {
  if (!path || typeof path !== "string") return null;

  // Remove null bytes
  path = path.replace(/\0/g, "");

  // Prevent directory traversal
  if (path.includes("..") || path.includes("//")) {
    return null;
  }

  // Remove leading/trailing slashes
  path = path.replace(/^\/+|\/+$/g, "");

  // Check for valid characters (alphanumeric, dots, slashes, hyphens, underscores)
  if (!/^[a-z0-9.\/_\-\s]+$/i.test(path)) {
    return null;
  }

  // Maximum length
  if (path.length > 260) {
    return null;
  }

  return path;
}

/**
 * Rate limiting helper (client-side, for UI feedback)
 */
export class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests: number = 10, windowMs: number = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  check(key: string): boolean {
    const now = Date.now();
    const requests = this.requests.get(key) || [];

    // Remove old requests outside the window
    const recentRequests = requests.filter(
      (time) => now - time < this.windowMs
    );

    if (recentRequests.length >= this.maxRequests) {
      return false; // Rate limit exceeded
    }

    // Add current request
    recentRequests.push(now);
    this.requests.set(key, recentRequests);

    return true; // Within rate limit
  }

  reset(key: string): void {
    this.requests.delete(key);
  }
}
