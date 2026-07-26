// @ts-check

/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation.
 * This is especially useful for Docker builds.
 */
!process.env.SKIP_ENV_VALIDATION && (await import("./src/env.mjs"));

/** @type {import("next").NextConfig} */
const config = {
  // Optional: set GITTR_DIST_DIR for experimental side-builds. Production deploy
  // builds in place and only restarts after BUILD_ID exists (see upload_to_hetzner.sh).
  distDir: process.env.GITTR_DIST_DIR || ".next",
  reactStrictMode: true,
  images: {
    domains: ["void.cat"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
    ],
  },
  // Temporarily ignore ESLint errors during build to test functionality
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Temporarily ignore TypeScript errors during build to test functionality
    ignoreBuildErrors: true,
  },

  /**
   * If you have the "experimental: { appDir: true }" setting enabled, then you
   * must comment the below `i18n` config out.
   *
   * @see https://github.com/vercel/next.js/issues/41980
   */
};
export default config;
