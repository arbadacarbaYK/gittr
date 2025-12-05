import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gittr.app',
  appName: 'gittr',
  webDir: 'out', // Static assets directory (created during build)
  server: {
    androidScheme: 'https',
    // For development: uncomment to load from local server
    // url: 'http://localhost:3000',
    // cleartext: true,
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
