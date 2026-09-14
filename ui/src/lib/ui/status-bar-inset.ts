/**
 * Android WebView and installed PWAs draw under the system status bar, but
 * `env(safe-area-inset-top)` is often 0 there. The header then sits on top of
 * signal / battery / Bluetooth, and those OS hits eat taps.
 *
 * CSS in globals.css uses `html.gittr-needs-status-bar-gap` (and display-mode
 * media) to floor the inset at 3rem. This module decides when to set that class.
 * Keep the inline <script> in app/layout.tsx in sync — it must run before paint.
 */
import { isGittrAndroidShell } from "../repo/gittr-android-shell";

export const GITTR_STATUS_BAR_GAP_CLASS = "gittr-needs-status-bar-gap";

/** Floor used in CSS when the OS reports a 0 safe-area inset. */
export const GITTR_STATUS_BAR_MIN_TOP = "3rem";

export function displayModeNeedsStatusBarGap(
  matchMedia?: ((query: string) => { matches: boolean }) | null,
  iosStandalone?: boolean
): boolean {
  if (iosStandalone) return true;
  if (!matchMedia) return false;
  try {
    return (
      matchMedia("(display-mode: standalone)").matches ||
      matchMedia("(display-mode: fullscreen)").matches ||
      matchMedia("(display-mode: minimal-ui)").matches
    );
  } catch {
    return false;
  }
}

export function needsStatusBarGap(opts?: {
  userAgent?: string;
  search?: string;
  storage?: Pick<Storage, "getItem"> | null;
  displayStandalone?: boolean;
  iosStandalone?: boolean;
}): boolean {
  if (opts?.displayStandalone || opts?.iosStandalone) return true;
  return isGittrAndroidShell({
    userAgent: opts?.userAgent,
    search: opts?.search,
    storage: opts?.storage,
  });
}

function readIosStandalone(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

type StatusBarGapRoot = {
  classList: {
    toggle: (token: string, force?: boolean) => boolean;
  };
};

/** Toggle the html class so CSS can pad Home / Search / New below the OS icons. */
export function applyGittrStatusBarGapClass(
  root?: StatusBarGapRoot | null,
  opts?: {
    userAgent?: string;
    search?: string;
    storage?: Pick<Storage, "getItem"> | null;
    displayStandalone?: boolean;
    iosStandalone?: boolean;
  }
): boolean {
  if (!root) return false;
  const displayStandalone =
    opts?.displayStandalone ??
    (typeof window !== "undefined"
      ? displayModeNeedsStatusBarGap(
          typeof window.matchMedia === "function"
            ? window.matchMedia.bind(window)
            : null,
          opts?.iosStandalone ?? readIosStandalone()
        )
      : false);
  const needed = needsStatusBarGap({
    userAgent: opts?.userAgent,
    search: opts?.search,
    storage: opts?.storage,
    displayStandalone,
    iosStandalone: opts?.iosStandalone ?? readIosStandalone(),
  });
  root.classList.toggle(GITTR_STATUS_BAR_GAP_CLASS, needed);
  return needed;
}
