// server component wrapper that exports metadata
// and imports the client layout component
import { websiteJsonLd } from "@/lib/seo/json-ld";
import { JsonLd } from "@/lib/seo/json-ld-script";
import { buildRootSiteMetadata } from "@/lib/seo/site-metadata";
import { gittrConsoleBootScript } from "@/lib/ui/early-console-script";
import { gittrThemeBootScript } from "@/lib/ui/theme-preference";
import { getPublicSiteUrl } from "@/lib/utils/public-site-url";

import { type Viewport } from "next";

import ClientLayout from "./layout-client";

const DEV_CACHE_BUST = "dev-2026-01-15-01";

export const metadata = buildRootSiteMetadata();

/** `cover` so notched phones can read `env(safe-area-inset-*)`. Android APK/PWA often still report 0 — see status-bar-inset.ts. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#06182e",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning data-theme="tokyo">
      <head>
        <JsonLd data={websiteJsonLd(getPublicSiteUrl())} />
        <meta name="gittr-build" content={DEV_CACHE_BUST} />
        {/* Keep in sync with ui/src/lib/ui/status-bar-inset.ts — must run before first paint. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var ua = navigator.userAgent || '';
                  var q = location.search || '';
                  var standalone = false;
                  try {
                    standalone = !!(window.matchMedia && (
                      window.matchMedia('(display-mode: standalone)').matches ||
                      window.matchMedia('(display-mode: fullscreen)').matches ||
                      window.matchMedia('(display-mode: minimal-ui)').matches
                    )) || !!navigator.standalone;
                  } catch (e1) {}
                  var apk = /GittrApp\\/\\d/i.test(ua) || /(?:^|[?&])source=apk(?:&|$)/.test(q);
                  if (!apk) {
                    try { apk = sessionStorage.getItem('gittr_android_shell') === '1'; } catch (e2) {}
                  }
                  if (apk || standalone) {
                    document.documentElement.classList.add('gittr-needs-status-bar-gap');
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
        {/* Theme and console filters are separate tags. One broken script used to
            fail the whole tag (`Missing catch or finally after try`) and skip theme. */}
        <script
          dangerouslySetInnerHTML={{
            __html: gittrThemeBootScript(),
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: gittrConsoleBootScript(),
          }}
        />
      </head>
      <body className="dark" suppressHydrationWarning>
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
