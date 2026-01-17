"use client";

import { useEffect, useRef } from "react";

import { Header } from "@/components/ui/header";
import {
  KeyboardShortcuts,
  useKeyboardShortcuts,
} from "@/components/ui/keyboard-shortcuts";
import { migrateEntityToPubkey } from "@/lib/migrations/migrate-entity-to-pubkey";
import { migrateEntityUser } from "@/lib/migrations/migrate-entity-user";
import { migrateRepoName } from "@/lib/migrations/migrate-repo-name";
import { migrateLegacyLocalStorage } from "@/lib/migrations/migrate-storage";
import NostrProvider from "@/lib/nostr/NostrContext";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import useSession from "@/lib/nostr/useSession";
import { clearNonLocalReposFromStorage } from "@/lib/repos/storage";
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

function AnonymousCleanupRunner() {
  const { isLoggedIn } = useSession();
  const hasRunRef = useRef(false);

  useEffect(() => {
    if (isLoggedIn || hasRunRef.current) return;
    const result = clearNonLocalReposFromStorage({
      preserveWithMetadata: true,
    });
    if (result.clearedKeys > 0) {
      console.log(
        `🧹 [Storage] Cleared ${result.clearedRepos} repo caches and ${result.clearedKeys} keys for anonymous session`
      );
    }
    hasRunRef.current = true;
  }, [isLoggedIn]);

  return null;
}

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { showShortcuts, setShowShortcuts } = useKeyboardShortcuts();

  // Rename legacy ngit_* storage keys to gittr_* on first load
  useEffect(() => {
    migrateLegacyLocalStorage();

    // Migrate classic theme to arcade80s (new default)
    // CRITICAL: This runs after React hydration, so we need to be aggressive
    try {
      const currentTheme = localStorage.getItem("gittr_theme");
      // Check for classic, null, undefined, empty string, or invalid values
      if (
        !currentTheme ||
        currentTheme === "classic" ||
        currentTheme === "null" ||
        currentTheme === "undefined" ||
        currentTheme.trim() === ""
      ) {
        localStorage.setItem("gittr_theme", "arcade80s");
        document.documentElement.setAttribute("data-theme", "arcade80s");
        document.documentElement.classList.add("dark");
        // Also set on body as fallback
        if (document.body) {
          document.body.setAttribute("data-theme", "arcade80s");
        }
        console.log("✅ [Theme] Migrated to arcade80s default");
      } else {
        // Ensure theme is applied even if it's already set
        document.documentElement.setAttribute("data-theme", currentTheme);
        document.documentElement.classList.add("dark");
      }
    } catch (e) {
      // If anything fails, force arcade80s
      try {
        document.documentElement.setAttribute("data-theme", "arcade80s");
        document.documentElement.classList.add("dark");
        if (document.body) {
          document.body.setAttribute("data-theme", "arcade80s");
        }
      } catch (e2) {}
    }
  }, []);

  // Suppress annoying relay connection errors/warnings from nostr-relaypool and React 19 ref warnings from Radix UI
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Helper function to check if message should be suppressed
    const shouldSuppress = (fullMessage: string): boolean => {
      return (
        fullMessage.includes("Error connecting relay") ||
        fullMessage.includes("WebSocket connection to") ||
        fullMessage.includes("websocket") ||
        fullMessage.includes("WebSocket") ||
        fullMessage.includes("reconnecting after") ||
        fullMessage.includes("reconnecting") ||
        (fullMessage.includes("wss://") &&
          (fullMessage.includes("failed") ||
            fullMessage.includes("Error") ||
            fullMessage.includes("502") ||
            fullMessage.includes("reconnecting"))) ||
        fullMessage.includes("Accessing element.ref was removed in React 19") ||
        fullMessage.includes("ref is now a regular prop") ||
        fullMessage.includes("element.ref was removed") ||
        fullMessage.includes("will be removed from the JSX Element type") ||
        fullMessage.includes("[File Fetch] API error: 404") ||
        (fullMessage.includes("API error") && fullMessage.includes("404")) ||
        fullMessage.includes("Each child in a list should have a unique") ||
        fullMessage.includes("warning-keys")
      );
    };

    // Helper function to extract full message from args
    const extractMessage = (args: any[]): string => {
      const allMessages = args
        .map((arg) => {
          if (typeof arg === "string") return arg;
          if (arg?.message) return arg.message.toString();
          if (arg?.toString) return arg.toString();
          return "";
        })
        .join(" ");
      const stackTrace =
        args.find((arg) => arg?.stack)?.stack?.toString() || "";
      return allMessages + " " + stackTrace;
    };

    const originalError = console.error;
    const originalWarn = console.warn;
    const originalWindowError = window.console.error;
    const originalWindowWarn = window.console.warn;

    // Filter console.error - must run early to catch errors before Next.js interceptor
    console.error = (...args: any[]) => {
      const fullMessage = extractMessage(args);
      if (shouldSuppress(fullMessage)) {
        return; // Suppress relay connection errors, React 19 ref warnings from Radix UI, expected 404 API errors, and React key warnings
      }
      originalError.apply(console, args);
    };

    // Filter console.warn - WebSocket reconnection warnings come through here
    console.warn = (...args: any[]) => {
      const fullMessage = extractMessage(args);
      if (shouldSuppress(fullMessage)) {
        return; // Suppress relay connection warnings, WebSocket reconnection messages, etc.
      }
      originalWarn.apply(console, args);
    };

    // Also filter window.console.error (used by some libraries)
    window.console.error = (...args: any[]) => {
      const fullMessage = extractMessage(args);
      if (shouldSuppress(fullMessage)) {
        return; // Suppress relay connection errors, React 19 ref warnings from Radix UI, expected 404 API errors, and React key warnings
      }
      originalWindowError.apply(window.console, args);
    };

    // Also filter window.console.warn (used by some libraries)
    window.console.warn = (...args: any[]) => {
      const fullMessage = extractMessage(args);
      if (shouldSuppress(fullMessage)) {
        return; // Suppress relay connection warnings, WebSocket reconnection messages, etc.
      }
      originalWindowWarn.apply(window.console, args);
    };

    return () => {
      console.error = originalError;
      console.warn = originalWarn;
      window.console.error = originalWindowError;
      window.console.warn = originalWindowWarn;
    };
  }, []);

  // Apply saved theme early on mount and listen for changes
  useEffect(() => {
    try {
      const applyTheme = () => {
        const t = localStorage.getItem("gittr_theme") || "arcade80s";
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

  // Register service worker for PWA support
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .catch((error) =>
          console.warn("Service worker registration failed", error)
        );
    };

    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  return (
    <NostrProvider>
      <div className="dark min-h-screen theme-bg-primary theme-text-primary">
        <MigrationRunner />
        <AnonymousCleanupRunner />
        <Header />
        <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%]">
          {children}
        </div>
        {showShortcuts && (
          <KeyboardShortcuts onClose={() => setShowShortcuts(false)} />
        )}
      </div>
    </NostrProvider>
  );
}
