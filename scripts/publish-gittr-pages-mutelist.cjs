#!/usr/bin/env node
/**
 * Publish/update gittr NIP-51 mute list (kind 10000) — MERGE p tags, do not replace.
 * Run on server: cd /opt/ngit/ui && node scripts/publish-gittr-pages-mutelist.cjs
 */
const fs = require("fs");
const path = require("path");
const {
  finishEvent,
  nip19,
  SimplePool,
  getPublicKey,
  verifySignature,
} = require("nostr-tools");

const MUTE_LIST_KIND = 10000;

const UI_ENV = process.env.UI_ENV_LOCAL || "/opt/ngit/ui/.env.local";
const RELAYS = (
  process.env.NOSTR_RELAYS ||
  "wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net,wss://relay.nostr.band,wss://nsite.run"
)
  .split(/[\s,;]+/)
  .map((s) => s.trim())
  .filter(Boolean);

function readNsec() {
  const raw =
    process.env.GITTR_PAGES_MUTE_NSEC ||
    process.env.CURATION_USER ||
    "";
  if (raw.startsWith("nsec1")) {
    const decoded = nip19.decode(raw);
    if (decoded.type !== "nsec") throw new Error("Invalid nsec");
    return decoded.data;
  }
  throw new Error("Set GITTR_PAGES_MUTE_NSEC or CURATION_USER=nsec1…");
}

function blocklistHexFromUiEnv() {
  if (!fs.existsSync(UI_ENV)) return [];
  const text = fs.readFileSync(UI_ENV, "utf8");
  const m = text.match(/^NEXT_PUBLIC_PUBLISHER_BLOCKLIST=(.+)$/m);
  if (!m) return [];
  let v = m[1].trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  const hex = [];
  for (const p of v.split(/[\s,;]+/).filter(Boolean)) {
    if (/^npub1/i.test(p)) {
      hex.push(nip19.decode(p).data.toLowerCase());
    } else if (/^[0-9a-f]{64}$/i.test(p)) {
      hex.push(p.toLowerCase());
    }
  }
  return hex;
}

function parsePMutedPubkeys(event) {
  const out = [];
  for (const tag of event.tags || []) {
    if (tag[0] === "p" && tag[1] && /^[0-9a-f]{64}$/i.test(tag[1])) {
      out.push(tag[1].toLowerCase());
    }
  }
  return out;
}

/** nsite-gateway uses getReplaceable(Mutelist, pubkey) → default NIP-33 identifier `d=""`. */
function listDIdentifier(event) {
  const d = (event.tags || []).find((t) => t[0] === "d");
  return d ? d[1] ?? "" : "";
}

function isDefaultMuteList(event) {
  return listDIdentifier(event) === "";
}

function mergePTags(existingP, toAdd) {
  const seen = new Set(existingP.map((p) => p.toLowerCase()));
  const merged = [...existingP];
  for (const pk of toAdd) {
    const lower = pk.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      merged.push(lower);
    }
  }
  return merged;
}

async function main() {
  const sk = readNsec();
  const pubkey = getPublicKey(sk);
  console.log("Curator pubkey:", pubkey);

  const pool = new SimplePool();
  const blocklist = blocklistHexFromUiEnv();
  console.log("Blocklist pubkeys to ensure:", blocklist.length);

  const got = await pool.get(RELAYS, {
    kinds: [MUTE_LIST_KIND],
    authors: [pubkey],
    limit: 10,
  });
  const events = got == null ? [] : Array.isArray(got) ? got : [got];

  let existingP = [];
  let nonPTags = [];
  let content = "";
  if (events.length) {
    events.sort((a, b) => b.created_at - a.created_at);
    const defaultLists = events.filter(isDefaultMuteList);
    const latest =
      defaultLists[0] ||
      events.find((e) => listDIdentifier(e) === "gittr-pages-curation") ||
      events[0];
    existingP = parsePMutedPubkeys(latest);
    // Merge p tags from any older lists (e.g. mistaken d=gittr-pages-curation publish).
    for (const ev of events) {
      if (ev === latest) continue;
      existingP = mergePTags(existingP, parsePMutedPubkeys(ev));
    }
    nonPTags = latest.tags.filter((t) => t[0] !== "p" && t[0] !== "d");
    content = latest.content || "";
    console.log(
      "Existing p tags (default d=\"\" list + merged):",
      existingP.length,
    );
  } else {
    console.log("No existing mute list — creating new");
  }

  const mergedP = mergePTags(existingP, blocklist);
  // Default NIP-33 identifier for the primary mute list (gateway getReplaceable).
  const tags = [["d", ""], ...nonPTags, ...mergedP.map((p) => ["p", p])];

  const event = finishEvent(
    {
      kind: MUTE_LIST_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content,
    },
    sk
  );

  if (!verifySignature(event)) {
    throw new Error("Signed event failed local verification");
  }

  console.log("Publishing kind 10000 with", mergedP.length, "public p tags");
  const results = await Promise.all(
    RELAYS.map(
      (url) =>
        new Promise((resolve) => {
          pool
            .ensureRelay(url)
            .then((relay) => {
              const pub = relay.publish(event);
              const done = (status, detail) => {
                console.log(" ", url, status, detail || "");
                resolve({ url, status });
              };
              pub.on("ok", () => done("ok"));
              pub.on("failed", (reason) => done("failed", reason));
              setTimeout(() => done("timeout"), 12_000);
            })
            .catch((e) => {
              console.log(" ", url, "connect-error", String(e?.message || e));
              resolve({ url, status: "connect-error" });
            });
        })
    )
  );

  const ok = results.filter((r) => r.status === "ok").length;
  console.log("Relay OK:", ok, "/", RELAYS.length);
  console.log("Event id:", event.id);

  await new Promise((r) => setTimeout(r, 3000));
  const check = await pool.get(RELAYS, { ids: [event.id] });
  console.log(check ? "Verified on relay" : "WARNING: event id not found on relays yet");

  pool.close(RELAYS);
  if (ok === 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
