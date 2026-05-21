import { getAllRelays } from "@/lib/nostr/getAllRelays";

/** Zapstore’s default relay — indexes most NIP-82 app/release/asset events. */
export const RELAY_ZAPSTORE = "wss://relay.zapstore.dev";

/** Public relays used for the Apps directory (no login required). Zapstore first. */
export const SOFTWARE_CATALOG_RELAYS = [
  RELAY_ZAPSTORE,
  "wss://relay.damus.io",
  "wss://nos.lol",
] as const;

/**
 * Relays for browsing NIP-82 software: catalog relays first, then user + defaults.
 * Works logged out — does not depend on NIP-07 or remote signer.
 */
export function relaysForSoftwareCatalog(defaultRelays: string[]): string[] {
  const out: string[] = [...SOFTWARE_CATALOG_RELAYS];
  const base = getAllRelays(defaultRelays);
  for (const r of base) {
    if (r && !out.includes(r)) out.push(r);
  }
  return out;
}
