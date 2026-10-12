/**
 * Detect the official gittr Android WebView shell (`space.gittr.app`).
 * The live website already updates on deploy; this is only for a newer APK.
 */

export const GITTR_ANDROID_SHELL_STORAGE_KEY = "gittr_android_shell";

export const GITTR_ANDROID_DIST_STORAGE_KEY = "gittr_android_dist";

export const GITTR_ANDROID_UA_PREFIX = "GittrApp/";

function androidSource(search: string): string | null {
  const source = searchParams(search).get("source");
  if (source === "apk" || source === "fdroid") return source;
  return null;
}

function searchParams(search: string): URLSearchParams {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(raw);
}

/** Persist `?source=apk` or `?source=fdroid` so client navigation can drop the query. */
export function rememberGittrAndroidShellFromLocation(
  search?: string,
  storage?:
    | (Pick<Storage, "setItem"> & Partial<Pick<Storage, "removeItem">>)
    | null
): void {
  const q =
    search ?? (typeof window !== "undefined" ? window.location.search : "");
  const source = androidSource(q);
  if (!source) return;
  try {
    const store =
      storage ??
      (typeof sessionStorage !== "undefined" ? sessionStorage : null);
    store?.setItem(GITTR_ANDROID_SHELL_STORAGE_KEY, "1");
    if (source === "fdroid") {
      store?.setItem(GITTR_ANDROID_DIST_STORAGE_KEY, "fdroid");
    } else {
      store?.removeItem?.(GITTR_ANDROID_DIST_STORAGE_KEY);
    }
  } catch {
    /* private mode */
  }
}

export function isGittrAndroidShell(opts?: {
  userAgent?: string;
  search?: string;
  storage?: Pick<Storage, "getItem"> | null;
}): boolean {
  const ua =
    opts?.userAgent ??
    (typeof navigator !== "undefined" ? navigator.userAgent : "");
  if (new RegExp(`${GITTR_ANDROID_UA_PREFIX}\\d`, "i").test(ua)) return true;
  const search =
    opts?.search ??
    (typeof window !== "undefined" ? window.location.search : "");
  if (androidSource(search)) return true;
  try {
    const store =
      opts?.storage ??
      (typeof sessionStorage !== "undefined" ? sessionStorage : null);
    return store?.getItem(GITTR_ANDROID_SHELL_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** F-Droid installs must not offer the GitHub APK sideload. */
export function isGittrFDroidInstall(opts?: {
  userAgent?: string;
  search?: string;
  storage?: Pick<Storage, "getItem"> | null;
}): boolean {
  const ua =
    opts?.userAgent ??
    (typeof navigator !== "undefined" ? navigator.userAgent : "");
  if (/GittrDist\/fdroid/i.test(ua)) return true;
  const search =
    opts?.search ??
    (typeof window !== "undefined" ? window.location.search : "");
  if (androidSource(search) === "fdroid") return true;
  try {
    const store =
      opts?.storage ??
      (typeof sessionStorage !== "undefined" ? sessionStorage : null);
    return store?.getItem(GITTR_ANDROID_DIST_STORAGE_KEY) === "fdroid";
  } catch {
    return false;
  }
}

/** Zapstore / sideload builds can download a newer GitHub APK. F-Droid cannot. */
export function offersGittrSideloadUpdate(opts?: {
  userAgent?: string;
  search?: string;
  storage?: Pick<Storage, "getItem"> | null;
}): boolean {
  return isGittrAndroidShell(opts) && !isGittrFDroidInstall(opts);
}

/** `GittrApp/1.0.0` from the WebView user-agent, or null in a normal browser. */
export function installedGittrAppVersion(userAgent?: string): string | null {
  const ua =
    userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  const m = ua.match(/GittrApp\/(\d+\.\d+\.\d+)/i);
  return m?.[1] ?? null;
}

export function parseSemverParts(
  version: string
): [number, number, number] | null {
  const m = String(version || "")
    .trim()
    .replace(/^v/i, "")
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Negative when `a` is older than `b`. Missing `a` counts as older. */
export function compareSemver(a: string | null, b: string | null): number {
  const pa = a ? parseSemverParts(a) : null;
  const pb = b ? parseSemverParts(b) : null;
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  const [a0, a1, a2] = pa;
  const [b0, b1, b2] = pb;
  if (a0 !== b0) return a0 - b0;
  if (a1 !== b1) return a1 - b1;
  return a2 - b2;
}
