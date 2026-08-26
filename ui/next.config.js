/** @type {import('next').NextConfig} */
const nextConfig = {
  // Optional: GITTR_DIST_DIR for a side-build while `yarn dev` owns `.next`.
  // This file is the config Next loads (not next.config.mjs).
  distDir: process.env.GITTR_DIST_DIR || ".next",
  reactStrictMode: true,
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors. Only use this if you need to.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Warning: This allows production builds to successfully complete even if
    // your project has type errors. Only use this if you need to.
    ignoreBuildErrors: false,
  },
  
  // Legacy parallel preview → real Code URL (query string preserved)
  async redirects() {
    return [
      {
        source: "/:entity/:repo/next",
        destination: "/:entity/:repo",
        permanent: false,
      },
    ];
  },

  // Security headers
  async headers() {
    return [
      {
        // Social card tools (X/LinkedIn) cache robots.txt; keep it fresh after Allow changes.
        source: "/robots.txt",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },
      {
        // Service worker must update immediately after deploys — a cached
        // (stale) SW kept serving old page data for hours (React #418 /
        // webpack chunk errors until hard refresh).
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },
      {
        // NIP-05: browsers on other origins (clients, nostr.watch) must be able to fetch this.
        source: "/.well-known/nostr.json",
        headers: [
          {
            key: "Access-Control-Allow-Origin",
            value: "*",
          },
          {
            key: "Access-Control-Allow-Methods",
            value: "GET, OPTIONS",
          },
          {
            key: "Cache-Control",
            value: "public, max-age=60, must-revalidate",
          },
        ],
      },
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload'
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block'
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin'
          },
          {
            key: 'Permissions-Policy',
            // Allow QR scanning for NIP-46 pairing on /login while keeping
            // microphone/geolocation denied site-wide.
            value: 'camera=(self), microphone=(), geolocation=()'
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https: blob:",
              "font-src 'self' data:",
              "connect-src 'self' https://*.github.com wss://* https://*",
              "frame-src 'self' https://www.youtube.com https://youtube.com https://youtu.be",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'self'",
              "upgrade-insecure-requests"
            ].join('; ')
          }
        ]
      }
    ]
  }
};

module.exports = nextConfig;

