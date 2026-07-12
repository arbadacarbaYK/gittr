#!/usr/bin/env npx tsx
/**
 * Verifies bunker:// pairing against a STRICT Amber-source-derived signer:
 * - connect params MUST be [remote-signer-pubkey, secret, perms, metadata?]
 *   (quartz BunkerRequestConnect.parse: params[0]=remoteKey, params[1]=secret)
 * - unknown secret → "invalid secret" (EventNotificationConsumer.kt)
 * - re-connect from known client key → silent "ack" (no user prompt)
 */
import { webcrypto, randomUUID } from "crypto";
import {
  generatePrivateKey,
  getPublicKey,
  getEventHash,
  signEvent,
  nip19,
  SimplePool,
} from "nostr-tools";
import { nip44 as nip44v2 } from "nostr-tools-v2";
import {
  parseRemoteSignerUri,
  RemoteSignerManager,
} from "../ui/src/lib/nostr/remoteSigner";

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

function hexToBytes(hex: string): Uint8Array {
  const n = hex.replace(/^0x/i, "").toLowerCase();
  const out = new Uint8Array(n.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(n.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function nip44Encrypt(from: string, to: string, text: string) {
  const key = nip44v2.getConversationKey(hexToBytes(from), to);
  return nip44v2.encrypt(text, key);
}

async function nip44Decrypt(from: string, to: string, ct: string) {
  const key = nip44v2.getConversationKey(hexToBytes(from), to);
  return nip44v2.decrypt(ct, key);
}

function signed24133(
  secret: string,
  pubkey: string,
  clientPk: string,
  content: string
) {
  const unsigned = {
    kind: 24133,
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["p", clientPk]],
    content,
  };
  return {
    ...unsigned,
    id: getEventHash(unsigned),
    sig: signEvent(unsigned, secret),
  };
}

async function main() {
  const amberSecret = generatePrivateKey();
  const amberPubkey = getPublicKey(amberSecret);
  const bunkerSecret = randomUUID();
  const relays = [
    "wss://relay.primal.net/",
    "wss://theforest.nostr1.com/",
    "wss://nostr.oxtr.dev/",
  ];
  const q = new URLSearchParams();
  relays.forEach((r) => q.append("relay", r));
  const uriWithSecret = `bunker://${amberPubkey}?${q.toString()}&secret=${bunkerSecret}`;
  parseRemoteSignerUri(uriWithSecret);

  const uriNoSecret = `bunker://${amberPubkey}?${q.toString()}`;
  parseRemoteSignerUri(uriNoSecret);
  console.log("OK: bunker parses with or without secret param");

  const pool = new SimplePool();
  let relayHandler: ((e: any) => void) | undefined;
  const connectAttempts: { clientPk: string; params: unknown[] }[] = [];
  // Amber DB state: secret -> bound client pubkey (after successful connect).
  const connectedClients = new Set<string>();

  async function amberReply(
    clientPk: string,
    id: string,
    method: string,
    result: string,
    error?: string
  ) {
    const payload = JSON.stringify(
      error ? { id, method, result: "", error } : { id, method, result }
    );
    const content = await nip44Encrypt(amberSecret, clientPk, payload);
    const reply = signed24133(amberSecret, amberPubkey, clientPk, content);
    await pool.publish(relays, reply);
    relayHandler?.(reply);
  }

  /** Strict port of Amber's connect handling (EventNotificationConsumer.kt). */
  async function amberHandleConnect(
    clientPk: string,
    id: string,
    params: unknown[]
  ) {
    connectAttempts.push({ clientPk, params });
    // Known client key → silent ack (line 297 path).
    if (connectedClients.has(clientPk)) {
      await amberReply(clientPk, id, "connect", "ack");
      return;
    }
    const secret = typeof params[1] === "string" ? params[1] : "";
    if (secret !== bunkerSecret) {
      await amberReply(clientPk, id, "connect", "", "invalid secret");
      return;
    }
    connectedClients.add(clientPk);
    await amberReply(clientPk, id, "connect", "ack");
  }

  const subscribe = (filters: any[], rs: string[], onEvent: (e: any) => void) => {
    relayHandler = onEvent;
    const sub = pool.sub(rs, filters);
    sub.on("event", onEvent);
    return () => sub.unsub();
  };
  const publish = (event: any, rs: string[]) => {
    pool.publish(rs, event);
    if (event.pubkey !== amberPubkey) {
      void (async () => {
        try {
          const plain = await nip44Decrypt(
            amberSecret,
            event.pubkey,
            event.content
          );
          const msg = JSON.parse(plain);
          if (msg.method === "connect") {
            await amberHandleConnect(event.pubkey, msg.id, msg.params || []);
          } else if (msg.method === "get_public_key") {
            if (connectedClients.has(event.pubkey)) {
              await amberReply(event.pubkey, msg.id, "get_public_key", amberPubkey);
            } else {
              await amberReply(event.pubkey, msg.id, "get_public_key", "", "no permission");
            }
          } else if (msg.method === "switch_relays") {
            // Amber replies with ITS OWN relays and ignores client params.
            await amberReply(
              event.pubkey,
              msg.id,
              "switch_relays",
              JSON.stringify(relays)
            );
          }
        } catch {
          /* ignore */
        }
      })();
    }
  };

  const manager = new RemoteSignerManager({
    subscribe,
    publish,
    getRelayStatuses: () => [],
  });

  const result = await Promise.race([
    manager.connect(uriWithSecret),
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error("bunker connect timed out")), 90000)
    ),
  ]);

  if (connectAttempts.length === 0) {
    throw new Error("no connect attempts observed");
  }
  const first = connectAttempts[0];
  if (first.params[0] !== amberPubkey) {
    throw new Error(
      `connect params[0] must be remote-signer pubkey (quartz remoteKey); got ${JSON.stringify(first.params[0])}`
    );
  }
  if (first.params[1] !== bunkerSecret) {
    throw new Error(
      `connect params[1] must be the bunker secret; got ${JSON.stringify(first.params[1])}`
    );
  }
  if (typeof first.params[3] === "string") {
    const meta = JSON.parse(first.params[3] as string);
    if (meta.name !== "gittr.space") {
      throw new Error(`metadata name should be gittr.space, got ${meta.name}`);
    }
  }
  console.log(
    "OK: connect uses canonical [remoteKey, secret, perms, metadata] on first attempt"
  );

  // Amber would have rejected any attempt with a wrong secret position.
  const invalidAttempts = connectAttempts.filter(
    (a) => a.params[1] !== bunkerSecret && !connectedClients.has(a.clientPk)
  );
  if (invalidAttempts.length > 0) {
    throw new Error(
      `client sent connect layouts Amber rejects: ${JSON.stringify(invalidAttempts.map((a) => a.params))}`
    );
  }
  console.log("OK: no connect layout that Amber would reject as invalid secret");

  const firstClientPk = first.clientPk;
  const bunkerKeysRaw = (globalThis as any).localStorage.getItem(
    "nostr:bunker-client-keys"
  );
  if (!bunkerKeysRaw) {
    throw new Error("bunker client keys not persisted");
  }
  const bunkerKeys = JSON.parse(bunkerKeysRaw);
  const storageKey = `${amberPubkey}:${bunkerSecret.toLowerCase()}`;
  const stored = bunkerKeys[storageKey];
  if (!stored || stored.clientPubkey !== firstClientPk) {
    throw new Error("bunker client key not stored for URI identity");
  }
  console.log("OK: bunker client pubkey persisted for stable Amber app identity");

  // Re-pair with the same URI (secret already consumed): must reuse the same
  // client key so Amber's known-client silent-ack path fires — no new app entry.
  manager.disconnect();
  const manager2 = new RemoteSignerManager({
    subscribe,
    publish,
    getRelayStatuses: () => [],
  });
  const result2 = await Promise.race([
    manager2.connect(uriWithSecret),
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error("bunker re-pair timed out")), 90000)
    ),
  ]);
  const lastAttempt = connectAttempts[connectAttempts.length - 1];
  if (lastAttempt.clientPk !== firstClientPk) {
    throw new Error(
      `re-pair used a NEW client key (${lastAttempt.clientPk.slice(0, 8)}…) — Amber would create another app entry`
    );
  }
  manager2.disconnect();
  console.log("OK: re-pair reuses same client key (single Amber app entry, silent ack)");

  try {
    pool.close((r) => r);
  } catch {
    /* ignore */
  }

  for (const r of [result, result2]) {
    const decoded = nip19.decode(r.npub);
    if (decoded.type !== "npub" || decoded.data !== amberPubkey) {
      throw new Error(`unexpected pubkey ${r.npub}`);
    }
  }
  console.log("OK: bunker pairing + re-pairing against strict Amber semantics");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
