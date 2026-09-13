import { appAlert, appConfirm } from "../../components/ui/app-dialog";

import { decideGittrAndroidUpdate } from "./gittr-android-latest";
import { installedGittrAppVersion } from "./gittr-android-shell";

export type GittrAndroidUpdateOutcome =
  | "current"
  | "opened"
  | "cancelled"
  | "unavailable";

function defaultOpenUrl(url: string): void {
  if (typeof window === "undefined") return;
  // Assign so the WebView's shouldOverrideUrlLoading fires (github.com → system browser).
  // window.open is a no-op here: the APK shell has no onCreateWindow handler.
  window.location.assign(url);
}

/**
 * Check GitHub for a newer `space.gittr.app` APK and offer to download it.
 */
export async function runGittrAndroidUpdateCheck(opts?: {
  fetchImpl?: typeof fetch;
  installed?: string | null;
  openUrl?: (url: string) => void;
  alertFn?: (message: string, title?: string) => Promise<void>;
  confirmFn?: (
    message: string,
    title?: string,
    options?: { okLabel?: string; cancelLabel?: string }
  ) => Promise<boolean>;
}): Promise<GittrAndroidUpdateOutcome> {
  const title = "Update app";
  const alertFn = opts?.alertFn ?? appAlert;
  const confirmFn = opts?.confirmFn ?? appConfirm;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const installed =
    opts?.installed !== undefined ? opts.installed : installedGittrAppVersion();
  const openUrl = opts?.openUrl ?? defaultOpenUrl;

  let latest: {
    ok?: boolean;
    version?: string;
    apkUrl?: string;
    message?: string;
  };
  try {
    const res = await fetchImpl("/api/repo/gittr-android-latest");
    latest = (await res.json()) as typeof latest;
  } catch {
    latest = {
      ok: false,
      message: "Could not reach gittr to check for a new app.",
    };
  }

  const decision = decideGittrAndroidUpdate({ installed, latest });
  if (decision.kind === "unavailable") {
    await alertFn(
      `${decision.message}\n\nYou can still open GitHub Releases and download gittr-*.apk from there.`,
      title
    );
    return "unavailable";
  }
  if (decision.kind === "current") {
    await alertFn(
      `You're on ${decision.installed}. That's the latest (${decision.latest}).\n\nThe website inside this app already updates on its own. This check is only for a newer Android installer.`,
      title
    );
    return "current";
  }

  const installedLine = decision.installed
    ? `You're on ${decision.installed}. Version ${decision.latest} is available.`
    : `The latest Android installer is ${decision.latest}.`;
  const ok = await confirmFn(
    `${installedLine}\n\nGitHub will open so you can download the APK. Android then asks you to install it (you may need to allow installs from the browser).`,
    title,
    { okLabel: "Download", cancelLabel: "Not now" }
  );
  if (!ok) return "cancelled";
  openUrl(decision.apkUrl);
  return "opened";
}
