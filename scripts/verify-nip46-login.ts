#!/usr/bin/env npx tsx
/**
 * Verifies NIP-46 nostrconnect pairing logic (4aa95fa) without Amber.
 */
import { webcrypto } from "crypto";
import {
  generatePrivateKey,
  getPublicKey,
  getEventHash,
  signEvent,
  nip04,
  nip19,
  SimplePool,
} from "nostr-tools";
import {
  getNip46PairingRelays,
  parseRemoteSignerUri,
  rememberNostrConnectClientKey,
  RemoteSignerManager,
} from "../ui/src/lib/nostr/remoteSigner";
import { nip44 as nip44v2 } from "nostr-tools-v2";

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.replace(/^0x/i, "").toLowerCase();
  const out = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function nip44Encrypt(
  fromSecret: string,
  toPubkey: string,
  plaintext: string
): Promise<string> {
  const key = nip44v2.getConversationKey(hexToBytes(fromSecret), toPubkey);
  return nip44v2.encrypt(plaintext, key);
}

async function nip44Decrypt(
  fromSecret: string,
  otherPubkey: string,
  ciphertext: string
): Promise<string> {
  const key = nip44v2.getConversationKey(hexToBytes(fromSecret), otherPubkey);
  return nip44v2.decrypt(ciphertext, key);
}

// Minimal browser shims
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

const PAIRING_RELAYS = [
  "wss://git.shakespeare.diy",
  "wss://ngit-relay.nostrver.se",
  "wss://relay.damus.io",
  "wss://nos.lol",
];

function fail(msg: string): never {
  console.error("FAIL:", msg);
  process.exit(1);
}

function ok(msg: string) {
  console.log("OK:", msg);
}

async function main() {
  const pairing = getNip46PairingRelays(PAIRING_RELAYS, 8);
  if (!pairing.includes("wss://relay.damus.io")) {
    fail("getNip46PairingRelays missing damus fallback");
  }
  if (pairing.some((r) => r.includes("git.shakespeare") || r.includes("ngit-relay"))) {
    fail(`GRASP relays must not appear in NIP-46 QR: ${pairing.join(", ")}`);
  }
  if (!pairing.includes("wss://relay.primal.net")) {
    fail("getNip46PairingRelays missing Amber default primal relay");
  }
  ok(`getNip46PairingRelays returns ${pairing.length} relays`);

  const clientSecretKey = generatePrivateKey();
  const clientPubkey = getPublicKey(clientSecretKey);
  const challengeBytes = new Uint8Array(8);
  webcrypto.getRandomValues(challengeBytes);
  const challengeSecret = Array.from(challengeBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  rememberNostrConnectClientKey(clientPubkey, clientSecretKey);
  const query = new URLSearchParams();
  pairing.forEach((r) => query.append("relay", r));
  query.set("secret", challengeSecret);
  query.set("name", "gittr");
  query.set("perms", "sign_event:1,nip44_encrypt");
  const uri = `nostrconnect://${clientPubkey}?${query.toString()}`;

  const parsed = parseRemoteSignerUri(uri);
  if (parsed.mode !== "nostrconnect" || parsed.secret !== challengeSecret) {
    fail("parseRemoteSignerUri nostrconnect mismatch");
  }
  ok("parseRemoteSignerUri + rememberNostrConnectClientKey");

  const amberSecret = generatePrivateKey();
  const amberPubkey = getPublicKey(amberSecret);

  const pool = new SimplePool();
  async function handleAmberClientEvent(event: any) {
    if (event.pubkey !== clientPubkey) return;
    try {
      const plaintext = await nip44Decrypt(
        amberSecret,
        clientPubkey,
        event.content
      ).catch(() => nip04.decrypt(amberSecret, clientPubkey, event.content));
      const message = JSON.parse(plaintext);
      if (!message?.id || !message?.method) return;
      if (message.method === "connect") {
        await replyToClient(clientPubkey, message.id, "connect", "ack");
      } else if (message.method === "get_public_key") {
        await replyToClient(
          clientPubkey,
          message.id,
          "get_public_key",
          amberPubkey
        );
      }
    } catch {
      // ignore decrypt errors
    }
  }

  let relayHandler: ((e: any) => void) | undefined;
  const subscribe = (filters: any[], relays: string[], onEvent: (e: any) => void) => {
    relayHandler = onEvent;
    const sub = pool.sub(relays, filters);
    sub.on("event", onEvent);
    return () => sub.unsub();
  };
  const publish = (event: any, relays: string[]) => {
    pool.publish(relays, event);
    if (event.pubkey === clientPubkey) {
      void handleAmberClientEvent(event);
    }
  };

  function signedKind24133(
    authorSecret: string,
    authorPubkey: string,
    clientPk: string,
    content: string
  ) {
    const unsigned = {
      kind: 24133,
      pubkey: authorPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["p", clientPk]],
      content,
    };
    const id = getEventHash(unsigned);
    const sig = signEvent(unsigned, authorSecret);
    return { ...unsigned, id, sig };
  }
  async function replyToClient(
    clientPk: string,
    requestId: string,
    method: string,
    result: unknown
  ) {
    const payload = JSON.stringify({ id: requestId, method, result });
    const content = await nip44Encrypt(amberSecret, clientPk, payload);
    const reply = signedKind24133(amberSecret, amberPubkey, clientPk, content);
    await pool.publish(pairing, reply);
    relayHandler?.(reply);
  }

  // Simulate Amber: handshake + JSON-RPC replies for connect / get_public_key
  const amberSub = pool.sub(pairing, [
    { kinds: [24133], authors: [clientPubkey] },
  ]);
  amberSub.on("event", (event: any) => {
    void handleAmberClientEvent(event);
  });

  const manager = new RemoteSignerManager({ subscribe, publish });
  let state = "idle";
  manager.onStateChange = (s) => {
    state = s;
  };

  const connectPromise = manager.connect(uri);
  await new Promise((r) => setTimeout(r, 6000));

  const payload = JSON.stringify({
    id: "amber-handshake",
    method: "connect",
    result: challengeSecret,
  });
  const content = await nip44Encrypt(amberSecret, clientPubkey, payload);
  const handshake = signedKind24133(
    amberSecret,
    amberPubkey,
    clientPubkey,
    content
  );

  for (let i = 0; i < 3; i++) {
    await pool.publish(pairing, handshake);
    relayHandler?.(handshake);
    await new Promise((r) => setTimeout(r, 1500));
  }
  ok("published simulated Amber nostrconnect handshake");

  const result = await Promise.race([
    connectPromise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("connect timed out after 90s")), 90000)
    ),
  ]);

  amberSub.unsub();
  try {
    pool.close((relays) => relays);
  } catch {
    // older nostr-tools close signature
    try {
      (pool as any).close();
    } catch {
      /* ignore */
    }
  }

  if (!result?.npub) fail("connect did not return npub");
  const decoded = nip19.decode(result.npub);
  if (decoded.type !== "npub" || decoded.data !== amberPubkey) {
    fail(`unexpected user pubkey: ${result.npub}`);
  }
  if (state !== "ready") fail(`expected ready state, got ${state}`);
  ok(`nostrconnect pairing completed: ${result.npub.slice(0, 16)}…`);
  console.log("\nAll NIP-46 login verification checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
