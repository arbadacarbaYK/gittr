// server component wrapper that exports metadata
// and imports the client layout component
import { buildRootSiteMetadata } from "@/lib/seo/site-metadata";

import ClientLayout from "./layout-client";

const DEV_CACHE_BUST = "dev-2026-01-15-01";

export const metadata = buildRootSiteMetadata();

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning data-theme="midnight">
      <head>
        <meta name="gittr-build" content={DEV_CACHE_BUST} />
        {/* Apply theme before React hydrates to prevent flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  // CRITICAL: Default to midnight, migrate classic/bitcoin-if-empty if present
                  // This MUST run before any React rendering to prevent flash
                  let theme = localStorage.getItem('gittr_theme');
                  if (!theme || theme === 'classic' || theme === 'null' || theme === 'undefined') {
                    theme = 'midnight';
                    try {
                      localStorage.setItem('gittr_theme', theme);
                    } catch (e) {
                      // Ignore localStorage write errors (private browsing, etc.)
                    }
                  }
                  // CRITICAL: Set theme attribute immediately, before React hydration
                  document.documentElement.setAttribute('data-theme', theme);
                  document.documentElement.classList.add('dark');
                  // Also set it on document.body as fallback
                  if (document.body) {
                    document.body.setAttribute('data-theme', theme);
                  }
                } catch (e) {
                  // If anything fails, force midnight
                  try {
                    document.documentElement.setAttribute('data-theme', 'midnight');
                    document.documentElement.classList.add('dark');
                    if (document.body) {
                      document.body.setAttribute('data-theme', 'midnight');
                    }
                  } catch (e2) {}
                }
                
                // CRITICAL: Double-check theme is set correctly (in case localStorage was empty/null)
                // This ensures midnight is always the default for first-time visitors
                const currentThemeAttr = document.documentElement.getAttribute('data-theme');
                if (!currentThemeAttr || currentThemeAttr === 'classic' || currentThemeAttr === 'null' || currentThemeAttr === 'undefined') {
                  document.documentElement.setAttribute('data-theme', 'midnight');
                  document.documentElement.classList.add('dark');
                  if (document.body) {
                    document.body.setAttribute('data-theme', 'midnight');
                  }
                  // Also update localStorage to persist
                  try {
                    localStorage.setItem('gittr_theme', 'midnight');
                } catch (e) {}
                }
                
                // Suppress console errors early (before Next.js dev tools interceptor)
                if (typeof console !== 'undefined') {
                  const buildFullMessage = (args) => {
                    const allMessages = args.map(arg => {
                      if (typeof arg === 'string') return arg;
                      if (arg && typeof arg === 'object') {
                        if (arg.message) return arg.message.toString();
                        if (arg.toString) return arg.toString();
                        if (arg.name && arg.stack) return arg.name + ' ' + arg.stack;
                      }
                      return '';
                    }).join(' ');
                    const stackTrace = args.find(arg => arg && arg.stack)?.stack?.toString() || '';
                    return (allMessages + ' ' + stackTrace).toLowerCase();
                  };
                  const shouldSuppress = (fullMessage) => (
                    fullMessage.includes('error connecting relay') ||
                    fullMessage.includes('websocket connection to') ||
                    fullMessage.includes('websocket') ||
                    fullMessage.includes('reconnecting after') ||
                    (fullMessage.includes('wss://') &&
                      (fullMessage.includes('failed') ||
                        fullMessage.includes('error') ||
                        fullMessage.includes('502') ||
                        fullMessage.includes('reconnect'))) ||
                    fullMessage.includes('accessing element.ref was removed in react 19') ||
                    fullMessage.includes('ref is now a regular prop') ||
                    fullMessage.includes('element.ref was removed') ||
                    fullMessage.includes('will be removed from the jsx element type') ||
                    fullMessage.includes('[file fetch] api error: 404') ||
                    (fullMessage.includes('api error') && fullMessage.includes('404')) ||
                    (fullMessage.includes('element.ref') && fullMessage.includes('react 19'))
                  );

                  if (console.error) {
                    const originalError = console.error;
                    console.error = function(...args) {
                      const fullMessage = buildFullMessage(args);
                      if (shouldSuppress(fullMessage)) return;
                      originalError.apply(console, args);
                    };
                    if (typeof window !== 'undefined' && window.console && window.console.error !== console.error) {
                      window.console.error = console.error;
                    }
                  }

                  if (console.warn) {
                    const originalWarn = console.warn;
                    console.warn = function(...args) {
                      const fullMessage = buildFullMessage(args);
                      if (shouldSuppress(fullMessage)) return;
                      originalWarn.apply(console, args);
                    };
                    if (typeof window !== 'undefined' && window.console && window.console.warn !== console.warn) {
                      window.console.warn = console.warn;
                    }
                  }

                  // nostr-relaypool uses console.log for "wss://… reconnecting after Ns" (not .warn)
                  if (console.log) {
                    const shouldSuppressRelayLog = (fullMessage) =>
                      fullMessage.includes('reconnecting after');
                    const originalLog = console.log;
                    console.log = function(...args) {
                      const fullMessage = buildFullMessage(args);
                      if (shouldSuppressRelayLog(fullMessage)) return;
                      originalLog.apply(console, args);
                    };
                    if (typeof window !== 'undefined' && window.console && window.console.log !== console.log) {
                      window.console.log = console.log;
                    }
                  }
                }
              })();
            `,
          }}
        />
      </head>
      <body className="dark" suppressHydrationWarning>
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
