/**
 * Install links for the Omalauncher tiles.
 * The phone adds a tile from the official share page, or from an Android
 * intent that hands the same payload to the launcher.
 */
import { deflateRawSync } from "zlib";

const SHARE_PAGE = "https://simonschubert.github.io/omarchy-widgets/w";
const PLAY = "https://play.google.com/store/apps/details?id=dev.omalauncher";

export function owlShareToken(source: string): string {
  const packed = deflateRawSync(source).toString("base64url").replace(/=+$/, "");
  return `owl1.${packed}`;
}

export function omalauncherShareUrl(token: string): string {
  return `${SHARE_PAGE}#${token}`;
}

/** Same intent the store's share page uses. Chrome on Android opens the launcher. */
export function omalauncherIntentUrl(token: string): string {
  const fallback = encodeURIComponent(PLAY);
  return (
    "intent://simonschubert.github.io/omarchy-widgets/w#Intent;" +
    "scheme=https;package=dev.omalauncher;" +
    `S.widget=${encodeURIComponent(token)};` +
    `S.browser_fallback_url=${fallback};end`
  );
}
