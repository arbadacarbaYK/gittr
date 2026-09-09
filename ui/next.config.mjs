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
  // Stale twin of next.config.js — Next loads the .js file. Keep this
  // typecheck-clean so a future switch does not reintroduce Next 16-removed keys.
  images: {
    formats: ["image/webp"],
    domains: ["void.cat"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
    ],
  },
  typescript: {
    ignoreBuildErrors: false,
  },

  /**
   * If you have the "experimental: { appDir: true }" setting enabled, then you
   * must comment the below `i18n` config out.
   *
   * @see https://github.com/vercel/next.js/issues/41980
   */
};
export default config;
