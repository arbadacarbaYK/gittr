import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gittr.app',
  appName: 'gittr',
  webDir: 'out', // Static assets directory (created during build)
  server: {
    androidScheme: 'https',
    // Load from production server (Next.js App Router requires server)
    // For offline support, would need Next.js standalone mode
    url: 'https://gittr.space',
    cleartext: false,
  },
  // Allow navigation to external URLs (for API calls, Nostr relays, etc.)
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
    },
  },
};

export default config;
