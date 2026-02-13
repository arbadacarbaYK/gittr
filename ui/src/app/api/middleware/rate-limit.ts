/**
 * Rate limiting middleware for API routes
 * Prevents abuse and DoS attacks
 */

// Simple in-memory rate limiter (for development)
// For production, use Redis or similar distributed store

interface RateLimitStore {
  [key: string]: number[];
}

const stores: Map<string, RateLimitStore> = new Map();

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  keyGenerator?: (req: Request | any) => string;
}

// Helper to extract IP from either App Router Request or Pages Router NextApiRequest
function getClientIP(req: Request | any): string {
  if (!req || !req.headers) {
    return "unknown";
  }

  // Check if it's a Next.js API Request (Pages Router)
  if (typeof req.headers === "object" && !req.headers.get) {
    // Pages Router: headers is an object
    try {
      const headers = req.headers as Record<
        string,
        string | string[] | undefined
      >;
      let ip: string | undefined;

      // Try x-forwarded-for first
      const forwardedFor = headers["x-forwarded-for"];
      if (forwardedFor) {
        if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
          ip = forwardedFor[0];
        } else if (typeof forwardedFor === "string") {
          ip = forwardedFor;
        }
      }

      // Fallback to x-real-ip
      if (!ip) {
        const realIP = headers["x-real-ip"];
        if (realIP) {
          if (Array.isArray(realIP) && realIP.length > 0) {
            ip = realIP[0];
          } else if (typeof realIP === "string") {
            ip = realIP;
          }
        }
      }

      // Clean up IP (remove port, handle multiple IPs)
      if (ip && typeof ip === "string" && ip.length > 0) {
        const parts = ip.split(",");
        if (parts.length > 0 && parts[0]) {
          const cleaned = parts[0].trim();
          if (cleaned.includes(":")) {
            const portParts = cleaned.split(":");
            return portParts.length > 0 && portParts[0]
              ? portParts[0]
              : cleaned;
          }
          return cleaned;
        }
      }
    } catch (error) {
      console.error("Error extracting IP from headers:", error);
    }
  }

  // App Router: headers is a Headers object with .get() method
  if (typeof req.headers.get === "function") {
    try {
      const ip =
        req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip");
      if (ip && typeof ip === "string") {
        const parts = ip.split(",");
        if (parts.length > 0 && parts[0]) {
          const cleaned = parts[0].trim();
          if (cleaned.includes(":")) {
            const portParts = cleaned.split(":");
            return portParts.length > 0 && portParts[0]
              ? portParts[0]
              : cleaned;
          }
          return cleaned;
        }
      }
    } catch (error) {
      console.error("Error extracting IP from Headers object:", error);
    }
  }

  return "unknown";
}

const defaultConfig: RateLimitConfig = {
  maxRequests: 100, // requests
  windowMs: 60000, // 1 minute
  keyGenerator: (req: Request | any) => {
    return getClientIP(req);
  },
};

/**
 * Rate limiting middleware
 */
export function rateLimit(config: Partial<RateLimitConfig> = {}) {
  const { maxRequests, windowMs, keyGenerator } = {
    ...defaultConfig,
    ...config,
  };

  const storeName = `rate_limit_${maxRequests}_${windowMs}`;
  let store = stores.get(storeName);

  if (!store) {
    store = {};
    stores.set(storeName, store);
  }

  return async (req: Request | any): Promise<Response | null> => {
    const key = keyGenerator
      ? keyGenerator(req)
      : defaultConfig.keyGenerator!(req);
    const now = Date.now();

    // Get store (guaranteed to exist due to initialization above)
    const currentStore = stores.get(storeName);
    if (!currentStore) {
      // This should never happen, but TypeScript requires the check
      return null;
    }

    // Get or initialize request history for this key
    let requests = currentStore[key] || [];

    // Remove old requests outside the window
    requests = requests.filter((time) => now - time < windowMs);

    // Check if rate limit exceeded
    if (requests.length >= maxRequests) {
      return new Response(
        JSON.stringify({
          error: "Rate limit exceeded",
          retryAfter: Math.ceil(windowMs / 1000),
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(Math.ceil(windowMs / 1000)),
            "X-RateLimit-Limit": String(maxRequests),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(now + windowMs),
          },
        }
      );
    }

    // Add current request
    requests.push(now);
    currentStore[key] = requests;

    // Clean up old entries periodically (every 10 minutes)
    if (Math.random() < 0.01) {
      // 1% chance
      const cutoff = now - windowMs;
      for (const k in currentStore) {
        const entry = currentStore[k];
        if (entry) {
          currentStore[k] = entry.filter((time) => time > cutoff);
          if (currentStore[k]!.length === 0) {
            delete currentStore[k];
          }
        }
      }
    }

    // Return null to continue (not rate limited)
    return null;
  };
}

/**
 * Per-endpoint rate limiters with different limits
 */
export const rateLimiters = {
  // Strict limits for payment endpoints
  payment: rateLimit({
    maxRequests: 10,
    windowMs: 60000, // 1 minute
  }),

  // Medium limits for API endpoints
  api: rateLimit({
    maxRequests: 100,
    windowMs: 60000, // 1 minute
  }),

  // Tight limits for bridge push (prevent repo spam & disk abuse)
  push: rateLimit({
    maxRequests: 10,
    windowMs: 60000, // 1 minute
  }),

  // Loose limits for general endpoints
  general: rateLimit({
    maxRequests: 200,
    windowMs: 60000, // 1 minute
  }),

  // Very strict for authentication
  auth: rateLimit({
    maxRequests: 5,
    windowMs: 900000, // 15 minutes
  }),

  // Strict for Nostr publishing (prevent spam)
  nostrPublish: rateLimit({
    maxRequests: 20,
    windowMs: 60000, // 1 minute
  }),
};
