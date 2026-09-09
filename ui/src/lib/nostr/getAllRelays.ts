/**
 * Helper to get all relays (default + the visitor's list on top).
 * Used for metadata fetching, explore, and profile pages.
 *
 * Order: platform env defaults, then NIP-65 kind 10002 (Settings → Relays,
 * cached after last fetch/save), then legacy `gittr_user_relays`.
 */
import { readCachedNip65RelayUrls } from "./nip65-relay-cache";

function pushRelay(out: string[], seen: Set<string>, url: string): void {
  const trimmed = String(url || "")
    .trim()
    .replace(/\/+$/, "");
  if (!trimmed) return;
  if (!trimmed.startsWith("wss://") && !trimmed.startsWith("ws://")) return;
  const key = trimmed.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push(trimmed);
}

export function getAllRelays(defaultRelays: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const url of defaultRelays || []) {
    pushRelay(out, seen, url);
  }

  if (typeof localStorage === "undefined") return out;

  try {
    for (const url of readCachedNip65RelayUrls()) {
      pushRelay(out, seen, url);
    }
  } catch (e) {
    console.warn("[getAllRelays] Failed to load NIP-65 relays:", e);
  }

  try {
    const userRelaysStr = localStorage.getItem("gittr_user_relays");
    if (userRelaysStr) {
      const userRelays = JSON.parse(userRelaysStr) as Array<{
        url: string;
        type?: string;
      }>;
      for (const row of userRelays) {
        pushRelay(out, seen, row?.url);
      }
    }
  } catch (e) {
    console.warn("[getAllRelays] Failed to load user relays:", e);
  }

  return out;
}
