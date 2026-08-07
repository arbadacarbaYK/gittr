/**
 * Helper to get all relays (default + optional browser-local extras).
 * Used for metadata fetching, explore, and profile pages.
 *
 * Note: NIP-65 kind 10002 is the user's published list (Settings → Relays).
 * `gittr_user_relays` is only legacy/local extras if present — never overwrite
 * or replace the platform default env list.
 *
 * In development mode, skips local extras to avoid connection spam.
 */

export function getAllRelays(defaultRelays: string[]): string[] {
  if (typeof window === "undefined") return defaultRelays;

  if (process.env.NODE_ENV === "development") {
    return defaultRelays;
  }

  try {
    const userRelaysStr = localStorage.getItem("gittr_user_relays");
    if (userRelaysStr) {
      const userRelays = JSON.parse(userRelaysStr) as Array<{
        url: string;
        type: string;
      }>;
      const userRelayUrls = userRelays
        .map((r) => r.url)
        .filter((url) => url && url.startsWith("wss://"));
      const allRelays = [...defaultRelays];
      userRelayUrls.forEach((url) => {
        if (!allRelays.includes(url)) {
          allRelays.push(url);
        }
      });
      return allRelays;
    }
  } catch (e) {
    console.warn("[getAllRelays] Failed to load user relays:", e);
  }

  return defaultRelays;
}
