// server component wrapper that exports metadata
// and imports the client layout component

import { Metadata } from 'next';
import ClientLayout from './layout-client';

export const metadata: Metadata = {
  title: {
    default: 'gittr - Decentralized Git Hosting on Nostr',
    template: '%s | gittr',
  },
  description: 'A truly censorship-resistant alternative to GitHub built on Nostr. Host your repositories on a decentralized network.',
  keywords: ['git', 'nostr', 'decentralized', 'censorship-resistant', 'github alternative', 'git hosting', 'nostr git'],
  authors: [{ name: 'gittr' }],
  creator: 'gittr',
  publisher: 'gittr',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://gittr.space'),
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: process.env.NEXT_PUBLIC_SITE_URL || 'https://gittr.space',
    siteName: 'gittr',
    title: 'gittr - Decentralized Git Hosting on Nostr',
    description: 'A truly censorship-resistant alternative to GitHub built on Nostr.',
    images: [
      {
        url: '/logo.svg',
        width: 1200,
        height: 630,
        alt: 'gittr logo',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'gittr - Decentralized Git Hosting on Nostr',
    description: 'A truly censorship-resistant alternative to GitHub built on Nostr.',
    images: ['/logo.svg'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  alternates: {
    canonical: process.env.NEXT_PUBLIC_SITE_URL || 'https://gittr.space',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply theme before React hydrates to prevent flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  // CRITICAL: Always default to arcade80s, migrate classic if present
                  // This MUST run before any React rendering to prevent flash
                  let theme = localStorage.getItem('gittr_theme');
                  if (!theme || theme === 'classic' || theme === 'null' || theme === 'undefined') {
                    theme = 'arcade80s';
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
                  // If anything fails, force arcade80s
                  try {
                    document.documentElement.setAttribute('data-theme', 'arcade80s');
                    document.documentElement.classList.add('dark');
                  } catch (e2) {}
                }
                
                // Suppress console errors early (before Next.js dev tools interceptor)
                if (typeof console !== 'undefined' && console.error) {
                  const originalError = console.error;
                  console.error = function(...args) {
                    // Check all arguments more thoroughly
                    const allMessages = args.map(arg => {
                      if (typeof arg === 'string') return arg;
                      if (arg && typeof arg === 'object') {
                        if (arg.message) return arg.message.toString();
                        if (arg.toString) return arg.toString();
                        // Check for React error objects
                        if (arg.name && arg.stack) return arg.name + ' ' + arg.stack;
                      }
                      return '';
                    }).join(' ');
                    const stackTrace = args.find(arg => arg && arg.stack)?.stack?.toString() || '';
                    const fullMessage = (allMessages + ' ' + stackTrace).toLowerCase();
                    
                    // Check for suppressed error patterns (case-insensitive)
                    if (
                      fullMessage.includes('error connecting relay') ||
                      fullMessage.includes('websocket connection to') ||
                      (fullMessage.includes('wss://') && (fullMessage.includes('failed') || fullMessage.includes('error') || fullMessage.includes('502'))) ||
                      fullMessage.includes('accessing element.ref was removed in react 19') ||
                      fullMessage.includes('ref is now a regular prop') ||
                      fullMessage.includes('element.ref was removed') ||
                      fullMessage.includes('will be removed from the jsx element type') ||
                      fullMessage.includes('[file fetch] api error: 404') ||
                      (fullMessage.includes('api error') && fullMessage.includes('404')) ||
                      fullMessage.includes('element.ref') && fullMessage.includes('react 19')
                    ) {
                      return;
                    }
                    originalError.apply(console, args);
                  };
                  
                  // Also intercept window.console.error
                  if (typeof window !== 'undefined' && window.console && window.console.error !== console.error) {
                    window.console.error = console.error;
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

