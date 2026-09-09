export const NIP65_RELAY_CACHE_KEY = "gittr_nip65_relays";

export function cacheNip65Relays(entries: Array<{ url: string }>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(NIP65_RELAY_CACHE_KEY, JSON.stringify(entries));
  } catch {
    /* quota */
  }
}

export function readCachedNip65RelayUrls(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(NIP65_RELAY_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<{ url?: string }>;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((e) =>
        String(e?.url || "")
          .trim()
          .replace(/\/+$/, "")
      )
      .filter((url) => url.startsWith("wss://") || url.startsWith("ws://"));
  } catch {
    return [];
  }
}
