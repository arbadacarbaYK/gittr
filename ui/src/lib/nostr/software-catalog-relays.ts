import { getAllRelays } from "@/lib/nostr/getAllRelays";

/** Zapstore’s default relay — indexes most NIP-82 app/release/asset events. */
export const RELAY_ZAPSTORE = "wss://relay.zapstore.dev";

/**
 * Relays for browsing NIP-82 software: user + defaults, plus Zapstore (and a tiny
 * fallback when `NEXT_PUBLIC_NOSTR_RELAYS` is empty in dev).
 */
export function relaysForSoftwareCatalog(defaultRelays: string[]): string[] {
  const base = getAllRelays(defaultRelays);
  const out = [...base];
  const extras = [RELAY_ZAPSTORE, "wss://relay.damus.io"];
  for (const r of extras) {
    if (!out.includes(r)) {
      out.push(r);
    }
  }
  return out;
}
