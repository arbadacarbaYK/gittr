"use client";

import { useEffect } from "react";
import { Header } from "@/components/ui/header";
import { useIsMounted } from "@/lib/hooks/useIsMounted";
import NostrProvider from "@/lib/nostr/NostrContext";
import { migrateEntityUser } from "@/lib/migrations/migrate-entity-user";
import { migrateEntityToPubkey } from "@/lib/migrations/migrate-entity-to-pubkey";
import { migrateRepoName } from "@/lib/migrations/migrate-repo-name";
import { migrateLegacyLocalStorage } from "@/lib/migrations/migrate-storage";
import useSession from "@/lib/nostr/useSession";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { useKeyboardShortcuts, KeyboardShortcuts } from "@/components/ui/keyboard-shortcuts";
import "@/styles/globals.css";

function MigrationRunner() {
  const { name: userName, isLoggedIn } = useSession();
  const { pubkey } = useNostrContext();
  
  useEffect(() => {
    // Run migration when user is logged in and has a valid username
    if (isLoggedIn && userName && userName !== "Anonymous Nostrich") {
      migrateEntityUser(userName, isLoggedIn);
    }
    
    // CRITICAL: Always run migration to fix ALL repos with 8-char entities (not just current user's)
    // This ensures repos from all users get migrated, even if current user isn't logged in
    migrateEntityToPubkey(pubkey, userName);
    
    // Migrate repos to ensure name field is always set (runs on every page load)
    migrateRepoName();
  }, [userName, isLoggedIn, pubkey]);
  
  return null;
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isMounted = useIsMounted();
  const { showShortcuts, setShowShortcuts } = useKeyboardShortcuts();

  // Rename legacy ngit_* storage keys to gittr_* on first load
  useEffect(() => {
    migrateLegacyLocalStorage();
  }, []);

  // Suppress annoying relay connection errors from nostr-relaypool
  useEffect(() => {
    if (typeof window === "undefined") return;
    
    // Filter console.error
    const originalError = console.error;
    console.error = (...args: any[]) => {
      const message = args[0]?.toString() || "";
      if (
        message.includes("Error connecting relay") ||
        message.includes("WebSocket connection to") ||
        (message.includes("wss://") && message.includes("failed"))
      ) {
        return; // Suppress relay connection errors
      }
      originalError.apply(console, args);
    };
    
    // Also filter window.console.error (used by some libraries)
    const originalWindowError = window.console.error;
    window.console.error = (...args: any[]) => {
      const message = args[0]?.toString() || "";
      if (
        message.includes("Error connecting relay") ||
        message.includes("WebSocket connection to") ||
        (message.includes("wss://") && message.includes("failed"))
      ) {
        return; // Suppress relay connection errors
      }
      originalWindowError.apply(window.console, args);
    };
    
    return () => {
      console.error = originalError;
      window.console.error = originalWindowError;
    };
  }, []);

  // Apply saved theme early on mount and listen for changes
  useEffect(() => {
    try {
      const applyTheme = () => {
        const t = localStorage.getItem("gittr_theme") || "classic";
        document.documentElement.dataset.theme = t;
      };
      
      // Apply immediately
      applyTheme();
      
      // Listen for storage changes (when theme is changed in another tab)
      window.addEventListener("storage", applyTheme);
      
      // Also listen for custom theme change events
      window.addEventListener("theme-changed", applyTheme);
      
      return () => {
        window.removeEventListener("storage", applyTheme);
        window.removeEventListener("theme-changed", applyTheme);
      };
    } catch {}
  }, []);

  return (
    <html lang="en">
      <body className="dark">
        <NostrProvider>
          {isMounted && (
            <div className="dark min-h-screen theme-bg-primary theme-text-primary">
              <MigrationRunner />
              <Header />
              <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%]">
                {children}
              </div>
              {showShortcuts && <KeyboardShortcuts onClose={() => setShowShortcuts(false)} />}
            </div>
          )}
        </NostrProvider>
      </body>
    </html>
  );
}
