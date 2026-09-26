import { headers } from "next/headers";

/**
 * True for App Router Flight / soft client navigations.
 * Full document loads (crawlers, hard refresh, location.assign) do not set these.
 *
 * Soft nav must not block on Nostr/SQLite in generateMetadata — that stalls
 * every repo tab click for seconds and can trigger appNavigate's hard fallback.
 */
export async function isRscClientNavigation(): Promise<boolean> {
  try {
    const h = await headers();
    if (h.get("rsc") === "1") return true;
    if (h.has("next-router-state-tree")) return true;
    if (h.has("next-router-prefetch")) return true;
    if (h.has("next-url")) return true;
    const accept = h.get("accept") || "";
    if (accept.includes("text/x-component")) return true;
    return false;
  } catch {
    return false;
  }
}

/** Link-preview fetchers. A normal browser click must not wait on them. */
const SOCIAL_PREVIEW_UA =
  /bot|crawl|spider|slurp|facebookexternalhit|facebot|twitterbot|telegrambot|slackbot|discordbot|whatsapp|linkedinbot|embedly|pinterest|redditbot|applebot|googlebot|bingbot|duckduckbot|yandex|baiduspider/i;

/**
 * Browser document loads skip the Nostr/SQLite title lookup. Soft Flight
 * requests already did. A full click was waiting on that lookup again, so
 * the tab stayed blank after the address changed.
 * Crawlers and preview bots still get the full title.
 */
export async function shouldUseFastDocumentMetadata(): Promise<boolean> {
  if (await isRscClientNavigation()) return true;
  try {
    const h = await headers();
    const ua = h.get("user-agent") || "";
    if (!ua) return false;
    return !SOCIAL_PREVIEW_UA.test(ua);
  } catch {
    return false;
  }
}
