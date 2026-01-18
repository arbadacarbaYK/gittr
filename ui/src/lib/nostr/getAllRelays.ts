/**
 * Helper to get all relays (default + user relays from localStorage)
 * This ensures user-configured relays are used for metadata fetching, explore, and profile pages
 * 
 * In development mode, skips user relays to avoid connection spam and improve dev server performance
 */

export function getAllRelays(defaultRelays: string[]): string[] {
  if (typeof window === "undefined") return defaultRelays;

  // In dev mode, skip user relays to avoid connection spam and improve performance
  // User relays often include many failing connections that slow down the dev server
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
      // Combine default and user relays, removing duplicates
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
