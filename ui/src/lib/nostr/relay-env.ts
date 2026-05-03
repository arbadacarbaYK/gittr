/**
 * Shared relay list for browser (NostrContext) and server (sitemap, etc.).
 * NEXT_PUBLIC_NOSTR_RELAYS is comma-separated wss:// URLs.
 */
export function getDefaultRelayUrls(): string[] {
  const envRelays = process.env.NEXT_PUBLIC_NOSTR_RELAYS;

  if (envRelays && envRelays.trim().length > 0) {
    const parsed = envRelays
      .split(",")
      .map((r) => {
        const trimmed = r.trim();
        if (trimmed.startsWith("wwss://")) {
          return trimmed.replace("wwss://", "wss://");
        }
        return trimmed;
      })
      .filter((r) => r.length > 0 && r.startsWith("wss://"))
      .filter((r, index, self) => self.indexOf(r) === index);

    if (parsed.length > 0) {
      return parsed;
    }
  }

  if (process.env.NODE_ENV === "development") {
    return [];
  }

  return ["wss://relay.damus.io"];
}
