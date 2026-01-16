/**
 * Secrets management utilities
 * Ensures secrets are never exposed in errors or logs
 */

/**
 * Mask secret in string (for logging/debugging)
 */
export function maskSecret(
  secret: string | null | undefined,
  visibleChars: number = 4
): string {
  if (!secret || secret.length === 0) return "***";

  if (secret.length <= visibleChars * 2) {
    return "*".repeat(secret.length);
  }

  return (
    secret.slice(0, visibleChars) +
    "*".repeat(secret.length - visibleChars * 2) +
    secret.slice(-visibleChars)
  );
}

/**
 * Check if string looks like a secret (should be masked)
 */
export function isSecret(str: string): boolean {
  if (!str || str.length < 10) return false;

  // Patterns that indicate secrets
  const secretPatterns = [
    /^nsec/i, // Nostr private key
    /^[a-f0-9]{64}$/i, // Hex private key
    /^sk_/, // Stripe secret key pattern
    /^Bearer /, // Auth token
    /^[A-Za-z0-9]{32,}$/, // Long alphanumeric (likely API key)
  ];

  return secretPatterns.some((pattern) => pattern.test(str));
}

/**
 * Sanitize error message to remove secrets
 */
export function sanitizeErrorMessage(error: any): string {
  if (!error) return "Unknown error";

  let message = error.message || String(error);

  // Mask common secret patterns
  message = message.replace(/nsec[a-z0-9]+/gi, (match: string) =>
    maskSecret(match)
  );
  message = message.replace(/[a-f0-9]{64}/gi, (match: string) =>
    isSecret(match) ? maskSecret(match) : match
  );
  message = message.replace(/sk_[a-zA-Z0-9_]+/g, maskSecret);
  message = message.replace(/Bearer [A-Za-z0-9._-]+/g, (match: string) => {
    const parts = match.split(" ");
    return parts[0] + " " + maskSecret(parts[1]);
  });

  // Remove URLs that might contain tokens
  message = message.replace(/https?:\/\/[^\s]+\?[^\s]+/g, (match: string) => {
    try {
      const url = new URL(match);
      // Keep only the base URL
      return url.origin + url.pathname + "?***";
    } catch {
      return match.replace(/\?[^\s]+/, "?***");
    }
  });

  return message;
}

/**
 * Safe logging function that never logs secrets
 */
export function safeLog(level: "log" | "warn" | "error", ...args: any[]): void {
  if (typeof console === "undefined") return;

  const sanitized = args.map((arg) => {
    if (typeof arg === "string" && isSecret(arg)) {
      return maskSecret(arg);
    }
    if (typeof arg === "object" && arg !== null) {
      return sanitizeObject(arg);
    }
    return arg;
  });

  console[level](...sanitized);
}

/**
 * Sanitize object by masking secret fields
 */
function sanitizeObject(obj: any): any {
  if (obj === null || typeof obj !== "object") return obj;

  const secretFields = [
    "privateKey",
    "privkey",
    "secret",
    "token",
    "password",
    "apiKey",
    "adminKey",
    "nsec",
    "key",
  ];

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item));
  }

  const sanitized: any = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];

      if (
        secretFields.some((field) =>
          key.toLowerCase().includes(field.toLowerCase())
        )
      ) {
        sanitized[key] = maskSecret(String(value));
      } else if (typeof value === "object" && value !== null) {
        sanitized[key] = sanitizeObject(value);
      } else {
        sanitized[key] = value;
      }
    }
  }

  return sanitized;
}

/**
 * Validate that error handling doesn't expose secrets
 */
export function validateErrorResponse(error: any): {
  message: string;
  code?: string;
} {
  return {
    message: sanitizeErrorMessage(error),
    code: error.code || "INTERNAL_ERROR",
  };
}
