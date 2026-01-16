/**
 * CSRF Protection utilities
 * Generate and validate CSRF tokens for state-changing operations
 */

// Browser-compatible crypto (for client-side)
// For server-side, Node.js crypto is used
function getRandomBytes(length: number): Uint8Array {
  if (typeof window !== "undefined" && window.crypto) {
    return window.crypto.getRandomValues(new Uint8Array(length));
  }
  // Node.js fallback (shouldn't happen in browser context)
  throw new Error("Crypto API not available");
}

async function createHash(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// In production, use a secure secret from environment
const CSRF_SECRET = process.env.CSRF_SECRET || "change-me-in-production";

/**
 * Generate a CSRF token (async for browser crypto)
 */
export async function generateCSRFToken(): Promise<string> {
  const randomBytes = getRandomBytes(32);
  const token = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const timestamp = Date.now();
  const hmac = await createHash(`${token}${timestamp}${CSRF_SECRET}`);

  // Return token with HMAC for validation
  return `${token}.${timestamp}.${hmac}`;
}

/**
 * Validate a CSRF token (async for browser crypto)
 * @param token Token to validate
 * @param maxAge Maximum age in milliseconds (default: 1 hour)
 */
export async function validateCSRFToken(
  token: string,
  maxAge: number = 3600000
): Promise<{ valid: boolean; error?: string }> {
  if (!token || typeof token !== "string") {
    return { valid: false, error: "CSRF token is required" };
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false, error: "Invalid CSRF token format" };
  }

  const [tokenPart, timestampStr, hmac] = parts;
  const timestamp = Number(timestampStr);

  if (isNaN(timestamp)) {
    return { valid: false, error: "Invalid CSRF token timestamp" };
  }

  // Check token age
  const age = Date.now() - timestamp;
  if (age > maxAge) {
    return { valid: false, error: "CSRF token has expired" };
  }

  if (age < 0) {
    return { valid: false, error: "CSRF token timestamp is in the future" };
  }

  // Verify HMAC
  const expectedHmac = await createHash(
    `${tokenPart}${timestamp}${CSRF_SECRET}`
  );

  if (hmac !== expectedHmac) {
    return { valid: false, error: "CSRF token validation failed" };
  }

  return { valid: true };
}

/**
 * Get CSRF token from request (header or body)
 */
export function getCSRFTokenFromRequest(req: any): string | null {
  // Check X-CSRF-Token header first
  if (req.headers?.["x-csrf-token"]) {
    return req.headers["x-csrf-token"] as string;
  }

  // Check body
  if (req.body?.csrfToken) {
    return req.body.csrfToken;
  }

  return null;
}
