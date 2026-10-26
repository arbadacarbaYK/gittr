"use client";

import { useEffect, useRef } from "react";

import { Header } from "@/components/ui/header";
import {
  KeyboardShortcuts,
  useKeyboardShortcuts,
} from "@/components/ui/keyboard-shortcuts";
import { SiteFooter } from "@/components/ui/site-footer";
import { migrateEntityToPubkey } from "@/lib/migrations/migrate-entity-to-pubkey";
import { migrateEntityUser } from "@/lib/migrations/migrate-entity-user";
import { migrateRepoName } from "@/lib/migrations/migrate-repo-name";
import { migrateLegacyLocalStorage } from "@/lib/migrations/migrate-storage";
import NostrProvider from "@/lib/nostr/NostrContext";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import useSession from "@/lib/nostr/useSession";
import { rememberGittrAndroidShellFromLocation } from "@/lib/repo/gittr-android-shell";
import { clearNonLocalReposFromStorage } from "@/lib/repos/storage";
import { applyGittrStatusBarGapClass } from "@/lib/ui/status-bar-inset";
import {
  DEFAULT_GITTR_THEME,
  GITTR_THEME_EXPLICIT_KEY,
  GITTR_THEME_STORAGE_KEY,
  resolveGittrTheme,
} from "@/lib/ui/theme-preference";
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
    rememberGittrAndroidShellFromLocation();
    applyGittrStatusBarGapClass(document.documentElement);
    migrateLegacyLocalStorage();

    // Tokyo until the visitor picks a theme. The old app saved midnight for
    // everyone, so that value is not treated as a choice.
    try {
      const theme = resolveGittrTheme(
        localStorage.getItem(GITTR_THEME_STORAGE_KEY),
        localStorage.getItem(GITTR_THEME_EXPLICIT_KEY)
      );
      const stored = (
        localStorage.getItem(GITTR_THEME_STORAGE_KEY) || ""
      ).trim();
      if (
        theme !== DEFAULT_GITTR_THEME &&
        stored === theme &&
        localStorage.getItem(GITTR_THEME_EXPLICIT_KEY) !== "1"
      ) {
        localStorage.setItem(GITTR_THEME_EXPLICIT_KEY, "1");
      }
      document.documentElement.setAttribute("data-theme", theme);
      document.documentElement.classList.add("dark");
      if (document.body) {
        document.body.setAttribute("data-theme", theme);
      }
    } catch (e) {
      try {
        document.documentElement.setAttribute(
          "data-theme",
          DEFAULT_GITTR_THEME
        );
        document.documentElement.classList.add("dark");
        if (document.body) {
          document.body.setAttribute("data-theme", DEFAULT_GITTR_THEME);
        }
      } catch (e2) {}
    }
  }, []);

  // Suppress annoying relay connection errors/warnings from nostr-relaypool and React 19 ref warnings from Radix UI
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Helper function to check if message should be suppressed
    const shouldSuppress = (raw: string): boolean => {
      const fullMessage = raw.toLowerCase();
      if (fullMessage.includes("[remotesigner]")) return false;
      return (
        fullMessage.includes("error connecting relay") ||
        fullMessage.includes("websocket connection to") ||
        fullMessage.includes("websocket") ||
        fullMessage.includes("reconnecting after") ||
        (fullMessage.includes("wss://") &&
          (fullMessage.includes("failed") ||
            fullMessage.includes("error") ||
            fullMessage.includes("502") ||
            fullMessage.includes("reconnect"))) ||
        fullMessage.includes("accessing element.ref was removed in react 19") ||
        fullMessage.includes("ref is now a regular prop") ||
        fullMessage.includes("element.ref was removed") ||
        fullMessage.includes("will be removed from the jsx element type") ||
        fullMessage.includes("[file fetch] api error: 404") ||
        (fullMessage.includes("api error") && fullMessage.includes("404")) ||
        fullMessage.includes("each child in a list should have a unique") ||
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

    const shouldSuppressRelayLog = (raw: string): boolean => {
      const m = raw.toLowerCase();
      return m.includes("reconnecting after");
    };

    const originalError = console.error;
    const originalWarn = console.warn;
    const originalLog = console.log;
    const originalWindowError = window.console.error;
    const originalWindowWarn = window.console.warn;
    const originalWindowLog = window.console.log;

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

    console.log = (...args: any[]) => {
      const fullMessage = extractMessage(args);
      if (shouldSuppressRelayLog(fullMessage)) {
        return;
      }
      originalLog.apply(console, args);
    };

    window.console.log = (...args: any[]) => {
      const fullMessage = extractMessage(args);
      if (shouldSuppressRelayLog(fullMessage)) {
        return;
      }
      originalWindowLog.apply(window.console, args);
    };

    return () => {
      console.error = originalError;
      console.warn = originalWarn;
      console.log = originalLog;
      window.console.error = originalWindowError;
      window.console.warn = originalWindowWarn;
      window.console.log = originalWindowLog;
    };
  }, []);

  // Apply saved theme early on mount and listen for changes
  useEffect(() => {
    try {
      const applyTheme = () => {
        const t = resolveGittrTheme(
          localStorage.getItem(GITTR_THEME_STORAGE_KEY),
          localStorage.getItem(GITTR_THEME_EXPLICIT_KEY)
        );
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

    const registerServiceWorker = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .catch((error) =>
          console.warn("Service worker registration failed", error)
        );
    };

    if (document.readyState === "complete") {
      registerServiceWorker();
      return;
    }

    window.addEventListener("load", registerServiceWorker);
    return () => window.removeEventListener("load", registerServiceWorker);
  }, []);

  // After deploy, stale lazy-loaded chunks 404 / webpack "undefined.call" —
  // one hard reload fixes it (same symptom users see on soft-nav to new repos).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const maybeReload = (msg: string) => {
      if (
        !/loading chunk|chunkloaderror|reading ['"]call['"]/i.test(msg) &&
        !/Cannot read properties of undefined \(reading ['"]call['"]\)/i.test(
          msg
        )
      ) {
        return;
      }
      const key = "gittr_chunk_reload";
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
      window.location.reload();
    };
    const onChunkError = (event: ErrorEvent) => {
      maybeReload(event.message || "");
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const msg =
        typeof reason === "string"
          ? reason
          : reason instanceof Error
          ? reason.message
          : String(reason ?? "");
      maybeReload(msg);
    };
    window.addEventListener("error", onChunkError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onChunkError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return (
    <NostrProvider>
      <div className="dark min-h-screen theme-bg-primary theme-text-primary">
        <MigrationRunner />
        <AnonymousCleanupRunner />
        <Header />
        <div className="mx-auto w-full max-w-[95%]">
          {children}
          <SiteFooter />
        </div>
        {showShortcuts && (
          <KeyboardShortcuts onClose={() => setShowShortcuts(false)} />
        )}
      </div>
    </NostrProvider>
  );
}
