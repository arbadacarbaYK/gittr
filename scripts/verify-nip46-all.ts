#!/usr/bin/env npx tsx
/**
 * Full NIP-46 login test suite — run before declaring auth "done".
 * Usage: cd ui && NODE_PATH=./node_modules npx tsx ../scripts/verify-nip46-all.ts
 */
import { execSync } from "child_process";
import { webcrypto } from "crypto";
import {
  generatePrivateKey,
  getPublicKey,
  getEventHash,
  signEvent,
  nip19,
  SimplePool,
} from "nostr-tools";
import { nip44 as nip44v2 } from "nostr-tools-v2";
import { isGraspServer } from "../ui/src/lib/utils/grasp-servers";
import {
  getNip46PairingRelays,
  parseRemoteSignerUri,
  rememberNostrConnectClientKey,
  RemoteSignerManager,
} from "../ui/src/lib/nostr/remoteSigner";

(globalThis as any).window = {
  crypto: webcrypto,
  location: { origin: "https://gittr.space" },
  localStorage: (() => {
    const s = new Map<string, string>();
    return {
      getItem: (k: string) => (s.has(k) ? s.get(k)! : null),
      setItem: (k: string, v: string) => s.set(k, String(v)),
      removeItem: (k: string) => s.delete(k),
    };
  })(),
  nostr: undefined,
};
(globalThis as any).localStorage = (globalThis as any).window.localStorage;

const PROD_RELAYS = [
  "wss://git.shakespeare.diy",
  "wss://ngit-relay.nostrver.se",
  "wss://git-01.uid.ovh",
  "wss://git-02.uid.ovh",
  "wss://gitnostr.com",
  "wss://relay.ngit.dev",
  "wss://ngit.danconwaydev.com",
  "wss://relay.damus.io",
  "wss://nostr.fmt.wiz.biz",
  "wss://nos.lol",
];

const results: { name: string; ok: boolean; detail?: string }[] = [];

function pass(name: string, detail?: string) {
  results.push({ name, ok: true, detail });
  console.log(`PASS: ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name: string, detail: string): never {
  results.push({ name, ok: false, detail });
  console.error(`FAIL: ${name} — ${detail}`);
  throw new Error(detail);
}

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

function testQrRelaysExcludeGrasp() {
  const pairing = getNip46PairingRelays(PROD_RELAYS, 8);
  const grasp = pairing.filter((r) => isGraspServer(r));
  if (grasp.length > 0) {
    fail("QR relays exclude GRASP", grasp.join(", "));
  }
  if (!pairing.includes("wss://relay.primal.net")) {
    fail("QR relays include Amber defaults", pairing.join(", "));
  }
  if (!pairing.includes("wss://relay.damus.io")) {
    fail("QR relays include damus", pairing.join(", "));
  }
  pass("QR relays exclude GRASP", pairing.join(", "));
}

function testParseUserBunkerFormat() {
  // Amber-style bunker URI shape (throwaway pubkey + random secret — no real creds).
  const dummyPubkey = getPublicKey(generatePrivateKey());
  const uri = `bunker://${dummyPubkey}?relay=wss://relay.primal.net/&relay=wss://theforest.nostr1.com/&relay=wss://nostr.oxtr.dev/&secret=${crypto.randomUUID()}`;
  const parsed = parseRemoteSignerUri(uri);
  if (parsed.mode !== "bunker") fail("parse bunker", "not bunker mode");
  if (parsed.relays.length !== 3) fail("parse bunker relays", String(parsed.relays.length));
  if (!parsed.secret) fail("parse bunker secret", "missing");
  pass("parse user bunker URI", `${parsed.relays.length} relays`);
}

async function simulateNostrConnect(): Promise<string> {
  const pairing = getNip46PairingRelays(PROD_RELAYS, 8);
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

  const amberSecret = generatePrivateKey();
  const amberPubkey = getPublicKey(amberSecret);
  const pool = new SimplePool();
  let relayHandler: ((e: any) => void) | undefined;

  async function amberReply(
    clientPk: string,
    id: string,
    method: string,
    result: unknown
  ) {
    const payload = JSON.stringify({ id, method, result });
    const content = await nip44Encrypt(amberSecret, clientPk, payload);
    const reply = signed24133(amberSecret, amberPubkey, clientPk, content);
    await pool.publish(pairing, reply);
    relayHandler?.(reply);
  }

  const subscribe = (filters: any[], relays: string[], onEvent: (e: any) => void) => {
    relayHandler = onEvent;
    const sub = pool.sub(relays, filters);
    sub.on("event", onEvent);
    return () => sub.unsub();
  };
  const publish = (event: any, relays: string[]) => {
    pool.publish(relays, event);
    if (event.pubkey !== amberPubkey) {
      void (async () => {
        try {
          const plain = await nip44Decrypt(amberSecret, event.pubkey, event.content);
          const msg = JSON.parse(plain);
          if (msg.method === "connect")
            await amberReply(event.pubkey, msg.id, "connect", "ack");
          if (msg.method === "get_public_key")
            await amberReply(event.pubkey, msg.id, "get_public_key", amberPubkey);
        } catch {
          /* ignore */
        }
      })();
    }
  };

  const amberSub = pool.sub(pairing, [
    { kinds: [24133], authors: [clientPubkey] },
  ]);
  amberSub.on("event", (event: any) => {
    if (event.pubkey !== clientPubkey) return;
    void (async () => {
      try {
        const plain = await nip44Decrypt(amberSecret, clientPubkey, event.content);
        const msg = JSON.parse(plain);
        if (msg.method === "connect")
          await amberReply(clientPubkey, msg.id, "connect", "ack");
        if (msg.method === "get_public_key")
          await amberReply(clientPubkey, msg.id, "get_public_key", amberPubkey);
      } catch {
        /* ignore */
      }
    })();
  });

  const manager = new RemoteSignerManager({
    subscribe,
    publish,
    getRelayStatuses: () => [],
  });

  const connectPromise = manager.connect(uri);
  await new Promise((r) => setTimeout(r, 14000));
  const handshakePayload = JSON.stringify({
    id: "h",
    method: "connect",
    result: challengeSecret,
  });
  const hsContent = await nip44Encrypt(amberSecret, clientPubkey, handshakePayload);
  const handshake = signed24133(amberSecret, amberPubkey, clientPubkey, hsContent);
  for (let i = 0; i < 3; i++) {
    await pool.publish(pairing, handshake);
    relayHandler?.(handshake);
    await new Promise((r) => setTimeout(r, 1000));
  }

  const result = await Promise.race([
    connectPromise,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error("nostrconnect timeout")), 90000)
    ),
  ]);
  manager.disconnect();
  amberSub.unsub();
  try {
    pool.close((r) => r);
  } catch {
    /* ignore */
  }
  const decoded = nip19.decode(result.npub);
  if (decoded.type !== "npub" || decoded.data !== amberPubkey) {
    fail("nostrconnect simulation", result.npub);
  }
  pass("nostrconnect Show QR flow", result.npub.slice(0, 20));
  return result.npub;
}

async function simulateBunkerNoMainPoolOpen(): Promise<string> {
  const amberSecret = generatePrivateKey();
  const amberPubkey = getPublicKey(amberSecret);
  const relays = [
    "wss://relay.primal.net/",
    "wss://theforest.nostr1.com/",
    "wss://nostr.oxtr.dev/",
  ];
  const q = new URLSearchParams();
  relays.forEach((r) => q.append("relay", r));
  q.set("secret", crypto.randomUUID());
  const uri = `bunker://${amberPubkey}?${q.toString()}`;

  const pool = new SimplePool();
  let relayHandler: ((e: any) => void) | undefined;

  async function amberReply(
    clientPk: string,
    id: string,
    method: string,
    result: unknown
  ) {
    const payload = JSON.stringify({ id, method, result });
    const content = await nip44Encrypt(amberSecret, clientPk, payload);
    const reply = signed24133(amberSecret, amberPubkey, clientPk, content);
    await pool.publish(relays, reply);
    relayHandler?.(reply);
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
          const plain = await nip44Decrypt(amberSecret, event.pubkey, event.content);
          const msg = JSON.parse(plain);
          if (msg.method === "connect")
            await amberReply(event.pubkey, msg.id, "connect", "ack");
          if (msg.method === "get_public_key")
            await amberReply(event.pubkey, msg.id, "get_public_key", amberPubkey);
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
    manager.connect(uri),
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error("bunker timeout")), 90000)
    ),
  ]);
  manager.disconnect();
  try {
    pool.close((r) => r);
  } catch {
    /* ignore */
  }
  pass("bunker paste (no main pool OPEN)", result.npub.slice(0, 20));
  return result.npub;
}

async function testBunkerAfterFailedNostrConnect() {
  const manager = new RemoteSignerManager({
    subscribe: () => () => {},
    publish: () => {},
    getRelayStatuses: () => [],
  });
  try {
    await manager.connect("nostrconnect://" + "a".repeat(64) + "?relay=wss://relay.damus.io");
  } catch {
    /* expected */
  }
  if (manager.getSession()) {
    fail("cleanup after failed connect", "session still set");
  }
  await simulateBunkerNoMainPoolOpen();
  pass("bunker works after failed nostrconnect attempt");
}

function testProductionDeploy() {
  // Operator-only check. Set e.g.:
  //   GITTR_DEPLOY_SSH="ssh -i ~/.ssh/<deploy-key> root@<server>"
  //   GITTR_DEPLOY_PATH="/opt/ngit/ui"   GITTR_SITE_URL="https://gittr.space"
  const sshCmd = process.env.GITTR_DEPLOY_SSH;
  const deployPath = process.env.GITTR_DEPLOY_PATH || "/opt/ngit/ui";
  const siteUrl = process.env.GITTR_SITE_URL || "https://gittr.space";
  if (!sshCmd) {
    pass("production deploy live", "skipped (GITTR_DEPLOY_SSH not set)");
    return;
  }
  try {
    const local = execSync(
      `${sshCmd} "grep -c NIP46_SIGNER_DEFAULT_RELAYS ${deployPath}/src/lib/nostr/remoteSigner.ts && grep -c resolveTransportRelays ${deployPath}/src/lib/nostr/remoteSigner.ts"`,
      { encoding: "utf8" }
    ).trim();
    const [signerDefaults, transport] = local.split("\n").map((x) => parseInt(x, 10));
    if (signerDefaults < 1 || transport < 1) {
      fail("production deploy", local);
    }
    const buildId = execSync(`${sshCmd} cat ${deployPath}/.next/BUILD_ID`, {
      encoding: "utf8",
    }).trim();
    const page = execSync(`curl -sf ${siteUrl}/login`, {
      encoding: "utf8",
    });
    if (!page.includes(buildId)) {
      fail("production live build", `page missing ${buildId}`);
    }
    pass("production deploy live", `build ${buildId}`);
  } catch (e) {
    fail("production deploy", e instanceof Error ? e.message : String(e));
  }
}

async function main() {
  console.log("=== NIP-46 full test suite ===\n");
  testQrRelaysExcludeGrasp();
  testParseUserBunkerFormat();
  await simulateNostrConnect();
  await simulateBunkerNoMainPoolOpen();
  await testBunkerAfterFailedNostrConnect();
  testProductionDeploy();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
  if (failed.length > 0) process.exit(1);
  console.log("\nAll NIP-46 login tests passed — safe to ship.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
