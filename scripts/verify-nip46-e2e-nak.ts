#!/usr/bin/env npx tsx
/**
 * REAL end-to-end NIP-46 test: gittr's RemoteSignerManager pairing with an
 * independent bunker implementation (fiatjaf's `nak bunker`) over real relays.
 *
 * Usage:
 *   1. nak bunker --sec <hex-or-nsec> -s <secret> wss://relay.damus.io wss://nos.lol
 *   2. NAK_BUNKER_URI="bunker://..." npx tsx scripts/verify-nip46-e2e-nak.ts
 *
 * Verifies: connect (canonical params accepted), get_public_key, sign_event.
 */
import { webcrypto } from "crypto";
import WebSocketImpl from "ws";
// nostr-tools v1 needs a global WebSocket in Node.
(globalThis as any).WebSocket = (globalThis as any).WebSocket || WebSocketImpl;
import {
  getPublicKey,
  nip19,
  verifySignature,
  SimplePool,
} from "nostr-tools";
import type { Event as NostrEvent } from "nostr-tools";
import { RemoteSignerManager } from "../ui/src/lib/nostr/remoteSigner";

(globalThis as any).window = {
  crypto: webcrypto,
  location: { origin: "https://gittr.space" },
  localStorage: (() => {
    const store = new Map<string, string>();
    return {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => store.set(k, String(v)),
      removeItem: (k: string) => store.delete(k),
    };
  })(),
  nostr: undefined,
};
(globalThis as any).localStorage = (globalThis as any).window.localStorage;

const uri = process.env.NAK_BUNKER_URI;
if (!uri || !uri.startsWith("bunker://")) {
  console.error("Set NAK_BUNKER_URI to the bunker:// URI printed by nak bunker");
  process.exit(2);
}
const expectedUserPubkey = process.env.NAK_USER_PUBKEY; // optional assert

async function main() {
  const pool = new SimplePool();

  const subscribe = (
    filters: any[],
    relays: string[],
    onEvent: (e: any) => void
  ) => {
    const sub = pool.sub(relays, filters);
    sub.on("event", onEvent);
    return () => sub.unsub();
  };
  const publish = (event: any, relays: string[]) => {
    pool.publish(relays, event);
  };

  const manager = new RemoteSignerManager({
    subscribe,
    publish,
    getRelayStatuses: () => [],
  });

  console.log("connecting to real bunker via", uri.slice(0, 40) + "…");
  const t0 = Date.now();
  const result = await Promise.race([
    manager.connect(uri!),
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error("e2e connect timed out (120s)")), 120000)
    ),
  ]);
  const connectMs = Date.now() - t0;
  console.log(`OK: paired with real nak bunker in ${connectMs}ms — ${result.npub}`);

  const decoded = nip19.decode(result.npub);
  if (decoded.type !== "npub") throw new Error("bad npub");
  if (expectedUserPubkey && decoded.data !== expectedUserPubkey) {
    throw new Error(
      `user pubkey mismatch: got ${decoded.data}, expected ${expectedUserPubkey}`
    );
  }

  const t1 = Date.now();
  const signedRaw = await Promise.race([
    manager.signEvent({
      kind: 1,
      content: "gittr NIP-46 e2e verification (test event, not published)",
      tags: [["t", "gittr-e2e-test"]],
      created_at: Math.floor(Date.now() / 1000),
      pubkey: decoded.data as string,
    }),
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error("e2e sign_event timed out (60s)")), 60000)
    ),
  ]);
  const signed = signedRaw as NostrEvent;
  const signMs = Date.now() - t1;
  if (!verifySignature(signed)) {
    throw new Error("signature returned by bunker does not verify");
  }
  if (signed.pubkey !== decoded.data) {
    throw new Error(
      `signed event pubkey ${signed.pubkey} != user pubkey ${decoded.data}`
    );
  }
  console.log(`OK: real bunker signed kind-1 in ${signMs}ms; signature verifies`);

  manager.disconnect();
  try {
    pool.close((r) => r);
  } catch {
    /* ignore */
  }
  console.log("E2E PASS: pairing + signing against independent bunker implementation");
  process.exit(0);
}

main().catch((e) => {
  console.error("E2E FAIL:", e);
  process.exit(1);
});
