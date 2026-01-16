/**
 * Security headers configuration for Next.js
 * Prevents XSS, clickjacking, and other attacks
 */

export const securityHeaders = [
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN", // Prevent clickjacking
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff", // Prevent MIME sniffing
  },
  {
    key: "X-XSS-Protection",
    value: "1; mode=block",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), compute-pressure=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'", // unsafe-eval for Next.js, unsafe-inline for inline scripts
      "style-src 'self' 'unsafe-inline'", // unsafe-inline for Tailwind
      "img-src 'self' data: https: blob:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.github.com wss://* https://*", // Nostr relays, GitHub API, etc.
      "frame-src 'self' https://www.youtube.com https://youtube.com https://youtu.be",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
];

/**
 * Get security headers as an object (for API routes)
 */
export function getSecurityHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};

  securityHeaders.forEach((header) => {
    headers[header.key] = header.value;
  });

  return headers;
}
