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
    return false;
  } catch {
    return false;
  }
}
