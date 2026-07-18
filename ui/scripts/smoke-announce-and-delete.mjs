/**
 * End-to-end: fetch forge release from gittr.space API, publish NIP-82, then NIP-09 delete.
 * Usage:
 *   NSEC=nsec1... node scripts/smoke-announce-and-delete.mjs https://github.com/owner/repo
 */
import WebSocket from "ws";
import {
  getEventHash,
  getPublicKey,
  nip19,
  signEvent,
} from "nostr-tools";

const sourceUrl = process.argv[2] || process.env.SOURCE_URL;
const nsec = process.env.NSEC || process.env.SMOKE_NSEC;
if (!sourceUrl || !nsec) {
  console.error("Usage: NSEC=nsec1... node scripts/smoke-announce-and-delete.mjs <github-repo-url>");
  process.exit(1);
}

const { type, data: sk } = nip19.decode(nsec);
if (type !== "nsec") throw new Error("Need nsec");
const pubkey = getPublicKey(sk);
const npub = nip19.npubEncode(pubkey);
console.log("signer", npub);

const relays = [
  "wss://relay.zapstore.dev",
  "wss://relay.damus.io",
  "wss://nos.lol",
];

function sign(unsigned) {
  const event = {
    ...unsigned,
    pubkey,
  };
  event.id = getEventHash(event);
  event.sig = signEvent(event, sk);
  return event;
}

async function publishToRelays(event) {
  const confirmed = [];
  await Promise.all(
    relays.map(
      (url) =>
        new Promise((resolve) => {
          const ws = new WebSocket(url);
          const t = setTimeout(() => {
            try {
              ws.close();
            } catch {}
            resolve(false);
          }, 10000);
          ws.on("open", () => {
            ws.send(JSON.stringify(["EVENT", event]));
          });
          ws.on("message", (raw) => {
            try {
              const msg = JSON.parse(String(raw));
              if (msg[0] === "OK" && msg[1] === event.id) {
                if (msg[2]) confirmed.push(url);
                clearTimeout(t);
                ws.close();
                resolve(Boolean(msg[2]));
              }
            } catch {}
          });
          ws.on("error", () => {
            clearTimeout(t);
            resolve(false);
          });
        })
    )
  );
  return confirmed;
}

const forgeRes = await fetch(
  `https://gittr.space/api/repo/forge-releases?sourceUrl=${encodeURIComponent(sourceUrl)}&hash=1`
);
const forge = await forgeRes.json();
if (!forge.ok) {
  console.error("forge-releases failed", forge);
  process.exit(1);
}
console.log("forge release", forge.release.tag, forge.release.apkAssets[0]?.name);

const appId = `space.gittr.smoke.${forge.repo}`.toLowerCase().replace(/[^a-z0-9.]/g, "");
const version = forge.release.tag.replace(/^v/i, "");
const apk = forge.release.apkAssets[0];
if (!apk?.sha256) throw new Error("missing sha256");
const now = Math.floor(Date.now() / 1000);

const asset = sign({
  kind: 3063,
  created_at: now,
  content: "",
  tags: [
    ["i", appId],
    ["x", apk.sha256],
    ["m", "application/vnd.android.package-archive"],
    ["url", apk.downloadUrl],
    ["version", version],
    ["f", "android-arm64-v8a"],
    ["size", String(apk.size || 0)],
  ],
});

const release = sign({
  kind: 30063,
  created_at: now,
  content: forge.release.body || "gittr announce smoke test",
  tags: [
    ["d", `${appId}@${version}`],
    ["i", appId],
    ["version", version],
    ["c", "main"],
    ["e", asset.id, "wss://relay.zapstore.dev"],
  ],
});

const app = sign({
  kind: 32267,
  created_at: now,
  content: "gittr announce smoke test — will be deleted",
  tags: [
    ["d", appId],
    ["name", `gittr smoke ${forge.repo}`],
    ["summary", "Temporary smoke test; safe to ignore"],
    ["repository", forge.repositoryUrl],
    ["f", "android-arm64-v8a"],
    ["t", "android"],
    ["t", "gittr-smoke"],
  ],
});

console.log("publishing asset", asset.id);
console.log("confirmed asset", await publishToRelays(asset));
console.log("publishing release", release.id);
console.log("confirmed release", await publishToRelays(release));
console.log("publishing app", app.id);
console.log("confirmed app", await publishToRelays(app));

console.log("waiting 3s before delete…");
await new Promise((r) => setTimeout(r, 3000));

const deletion = sign({
  kind: 5,
  created_at: Math.floor(Date.now() / 1000),
  content:
    "Delete NIP-82 software announce smoke test (app/release/asset); repo unchanged.",
  tags: [
    ["e", asset.id],
    ["e", release.id],
    ["e", app.id],
    ["k", "32267"],
    ["k", "30063"],
    ["k", "3063"],
  ],
});
console.log("publishing deletion", deletion.id);
console.log("confirmed deletion", await publishToRelays(deletion));

console.log(
  JSON.stringify(
    {
      ok: true,
      appId,
      version,
      appEventId: app.id,
      releaseEventId: release.id,
      assetEventId: asset.id,
      deletionEventId: deletion.id,
      repositoryUrl: forge.repositoryUrl,
      note: "NIP-09 deletes app catalog events only; NIP-34 repo (if any) is untouched",
    },
    null,
    2
  )
);
process.exit(0);
