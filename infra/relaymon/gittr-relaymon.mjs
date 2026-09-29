#!/usr/bin/env node
/**
 * NIP-66 monitor for wss://relay.gittr.space
 *
 * nostr.watch's relay search only lists relays that are "online" right now.
 * "Online" means a recent kind 30166 from one of the three monitors it enables.
 * It enables the three active monitors that advertise the most `c` check types.
 * The monitors it currently enables advertise five: open, read, geo, info, dns.
 * A monitor with only open/nip11/ws never makes that cut, so its checks never
 * enter the search index — even on the "all relays" view. The d tag must be
 * URL.toString() form (trailing slash); that is the key nostr.watch aggregates on.
 *
 * Env:
 *   RELAYMON_NSEC or RELAYMON_HEX_PRIV — monitor signing key (machine key, not Amber)
 *   RELAYMON_KEY_FILE — hex or nsec file (default /opt/ngit/relaymon/monitor.key)
 *   RELAYMON_TARGET (default wss://relay.gittr.space)
 *   RELAYMON_FREQUENCY — seconds, advertised on kind 10166 (default 3600)
 *   RELAYMON_PUBLISH_RELAYS — comma-separated wss URLs
 */
import { lookup } from "node:dns/promises";
import { readFileSync, existsSync } from "node:fs";
import tls from "node:tls";
import { WebSocket } from "ws";
import { getEventHash, getPublicKey, nip19, signEvent } from "nostr-tools";

globalThis.WebSocket = WebSocket;

const TARGET_INPUT = (process.env.RELAYMON_TARGET || "wss://relay.gittr.space").trim();
// nostr.watch stores relays as `new URL(url).toString()`, which adds a trailing slash.
const TARGET = new URL(TARGET_INPUT).toString();
const FREQUENCY_SEC = Math.max(3600, Number(process.env.RELAYMON_FREQUENCY || 3600));
const PUBLISH_RELAYS = (
  process.env.RELAYMON_PUBLISH_RELAYS ||
  "wss://relaypag.es,wss://monitorlizard.nostr1.com,wss://nos.lol,wss://relay.primal.net,wss://relay.gittr.space,wss://purplepag.es,wss://relay.nostr.watch"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function loadSecret() {
  if (process.env.RELAYMON_HEX_PRIV?.match(/^[0-9a-f]{64}$/i)) {
    return process.env.RELAYMON_HEX_PRIV.toLowerCase();
  }
  const nsec = process.env.RELAYMON_NSEC;
  if (nsec?.startsWith("nsec1")) {
    const d = nip19.decode(nsec);
    if (d.type !== "nsec") throw new Error("RELAYMON_NSEC is not an nsec");
    const data = d.data;
    if (typeof data === "string") return data;
    return Buffer.from(data).toString("hex");
  }
  const keyFile = process.env.RELAYMON_KEY_FILE || "/opt/ngit/relaymon/monitor.key";
  if (existsSync(keyFile)) {
    const raw = readFileSync(keyFile, "utf8").trim();
    if (raw.startsWith("nsec1")) {
      const d = nip19.decode(raw);
      const data = d.data;
      return typeof data === "string" ? data : Buffer.from(data).toString("hex");
    }
    if (/^[0-9a-f]{64}$/i.test(raw)) return raw.toLowerCase();
  }
  throw new Error("Missing RELAYMON_NSEC / RELAYMON_HEX_PRIV / key file");
}

function finalize(sk, partial) {
  const pubkey = getPublicKey(sk);
  const event = {
    ...partial,
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
  };
  event.id = getEventHash(event);
  event.sig = signEvent(event, sk);
  return event;
}

async function fetchNip11(url) {
  const httpsUrl = url.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
  const t0 = Date.now();
  const res = await fetch(httpsUrl, {
    headers: { Accept: "application/nostr+json" },
    signal: AbortSignal.timeout(10000),
  });
  const rtt = Date.now() - t0;
  if (!res.ok) throw new Error(`NIP-11 HTTP ${res.status}`);
  const json = await res.json();
  return { json, rtt };
}

function probeOpenAndRead(url, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let openedAt = 0;
    let settled = false;
    const ws = new WebSocket(url);
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(result);
    };
    const timer = setTimeout(
      () => done({ ok: openedAt > 0, rttOpen: openedAt ? openedAt - t0 : Date.now() - t0, rttRead: null, err: "timeout" }),
      timeoutMs
    );
    ws.on("open", () => {
      openedAt = Date.now();
      ws.send(JSON.stringify(["REQ", "gittr-relaymon", { kinds: [0], limit: 1 }]));
    });
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg[0] === "EVENT" || msg[0] === "EOSE") {
          done({
            ok: true,
            rttOpen: openedAt - t0,
            rttRead: Date.now() - openedAt,
            err: "",
          });
        }
      } catch {
        /* ignore */
      }
    });
    ws.on("error", (e) => {
      done({
        ok: false,
        rttOpen: openedAt ? openedAt - t0 : Date.now() - t0,
        rttRead: null,
        err: e?.message || String(e),
      });
    });
  });
}

function probeSsl(hostname) {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host: hostname, port: 443, servername: hostname, timeout: 10000 },
      () => {
        const cert = socket.getPeerCertificate();
        const ok = !!socket.authorized;
        socket.end();
        resolve({ ok, validTo: cert?.valid_to || "" });
      }
    );
    socket.on("error", (e) => resolve({ ok: false, validTo: "", err: e?.message || String(e) }));
  });
}

function publish(relays, event) {
  return Promise.all(
    relays.map(
      (url) =>
        new Promise((resolve) => {
          const ws = new WebSocket(url);
          const timer = setTimeout(() => {
            try {
              ws.close();
            } catch {
              /* ignore */
            }
            resolve({ url, ok: false, err: "timeout" });
          }, 20000);
          ws.on("open", () => {
            ws.send(JSON.stringify(["EVENT", event]));
          });
          ws.on("message", (raw) => {
            try {
              const msg = JSON.parse(String(raw));
              if (msg[0] === "OK" && msg[1] === event.id) {
                clearTimeout(timer);
                ws.close();
                resolve({ url, ok: !!msg[2], err: msg[3] });
              }
            } catch {
              /* ignore */
            }
          });
          ws.on("error", (e) => {
            clearTimeout(timer);
            resolve({ url, ok: false, err: e?.message || String(e) });
          });
        })
    )
  );
}

async function main() {
  const sk = loadSecret();
  const pubkey = getPublicKey(sk);
  const host = new URL(TARGET).hostname;
  console.log(`[relaymon] pubkey=${pubkey} target=${TARGET}`);

  const open = await probeOpenAndRead(TARGET);
  console.log(
    `[relaymon] open ok=${open.ok} rtt-open=${open.rttOpen}ms rtt-read=${open.rttRead ?? ""} err=${open.err || ""}`
  );

  let nip11 = null;
  let infoRtt = null;
  try {
    const info = await fetchNip11(TARGET);
    nip11 = info.json;
    infoRtt = info.rtt;
    console.log(`[relaymon] nip11 ok name=${nip11?.name} rtt=${infoRtt}ms`);
  } catch (e) {
    console.warn(`[relaymon] nip11 failed:`, e?.message || e);
  }

  let dnsOk = false;
  try {
    const looked = await lookup(host);
    dnsOk = !!looked?.address;
    console.log(`[relaymon] dns ok address=${looked.address}`);
  } catch (e) {
    console.warn(`[relaymon] dns failed:`, e?.message || e);
  }

  const ssl = await probeSsl(host);
  console.log(`[relaymon] ssl ok=${ssl.ok} validTo=${ssl.validTo || ""} err=${ssl.err || ""}`);

  // More `c` tags than the five-check monitors nostr.watch currently enables,
  // and only checks this process actually ran.
  const checks = [];
  if (open.rttOpen != null) checks.push("open");
  if (open.ok && open.rttRead != null) checks.push("read");
  if (nip11) checks.push("info", "nip11");
  if (dnsOk) checks.push("dns");
  if (ssl.ok) checks.push("ssl");
  console.log(`[relaymon] checks=${checks.join(",")}`);

  const profile = finalize(sk, {
    kind: 0,
    content: JSON.stringify({
      name: "gittr relaymon",
      about:
        "NIP-66 monitor for wss://relay.gittr.space (gittr.space). Machine key — not a user identity.",
      website: "https://gittr.space",
    }),
    tags: [],
  });

  const monitorRelays = finalize(sk, {
    kind: 10002,
    content: "",
    tags: PUBLISH_RELAYS.map((r) => ["r", r.replace(/\/+$/, "")]),
  });

  const announce = finalize(sk, {
    kind: 10166,
    content: "",
    tags: [
      ["frequency", String(FREQUENCY_SEC)],
      ["timeout", "12000", "open"],
      ["timeout", "10000", "read"],
      ["timeout", "10000", "info"],
      ...checks.map((c) => ["c", c]),
    ],
  });

  const tags = [
    ["d", TARGET],
    ["n", "clearnet"],
  ];
  if (open.rttOpen != null) tags.push(["rtt-open", String(open.rttOpen)]);
  if (open.rttRead != null) tags.push(["rtt-read", String(open.rttRead)]);
  if (nip11?.supported_nips) {
    for (const n of nip11.supported_nips) tags.push(["N", String(n)]);
  }
  const lim = nip11?.limitation || {};
  tags.push(["R", lim.auth_required ? "auth" : "!auth"]);
  tags.push(["R", lim.payment_required ? "payment" : "!payment"]);
  tags.push(["R", lim.restricted_writes ? "writes" : "!writes"]);

  const check = finalize(sk, {
    kind: 30166,
    content: nip11 ? JSON.stringify(nip11) : "",
    tags,
  });

  if (!open.ok && !nip11) {
    console.error("[relaymon] relay unreachable — still publishing the observation");
  }

  for (const [label, event] of [
    ["kind0", profile],
    ["10002", monitorRelays],
    ["10166", announce],
    ["30166", check],
  ]) {
    const results = await publish(PUBLISH_RELAYS, event);
    const ok = results.filter((r) => r.ok).map((r) => r.url);
    const fail = results.filter((r) => !r.ok);
    console.log(
      `[relaymon] published ${label} ${event.id.slice(0, 12)}… ok=${ok.length} fail=${fail.length}`,
      fail.slice(0, 4)
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
