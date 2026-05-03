/**
 * Regenerate gittr_nostr_repos_username_reponame.txt (output is gitignored):
 * - Reads owner hex + repo from existing root file (first column is pubkey hex today).
 * - Fetches kind 0 from relays, derives a URL-safe username from profile.
 * - Writes username/reponame lines (sorted, unique).
 * Do not commit the *.txt exports — keep on server / local only.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { SimplePool } from "../ui/node_modules/nostr-tools/lib/esm/nostr.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const HEX_SOURCE =
  process.argv[2] || path.join(ROOT, "gittr_nostr_repos_ownerhex_reponame.txt");
const OUT =
  process.argv[3] || path.join(ROOT, "gittr_nostr_repos_username_reponame.txt");

const RELAYS = [
  "wss://nos.lol",
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
  "wss://relay.nostr.info",
];

const POOL_OPTS = { eoseSubTimeout: 7000, getTimeout: 7000 };
const AUTHOR_CHUNK = 30;

function parseInput(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("/");
    if (i === -1) continue;
    const pubkey = t.slice(0, i).toLowerCase();
    const repo = t.slice(i + 1);
    if (!/^[0-9a-f]{64}$/.test(pubkey) || !repo) continue;
    rows.push({ pubkey, repo });
  }
  return rows;
}

function slug(s) {
  const t = s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^\.+|\.+$/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (!t || /^[._-]+$/.test(t)) return "";
  return t;
}

function usernameFromKind0(ev) {
  const nip05 = ev.tags.find((t) => t[0] === "nip05")?.[1]?.trim();
  if (nip05 && nip05.includes("@")) {
    const local = nip05.split("@")[0];
    const sl = slug(local);
    if (sl) return sl;
  }
  try {
    const j = JSON.parse(ev.content || "{}");
    const raw = (
      j.display_name ||
      j.name ||
      j.displayName ||
      ""
    ).trim();
    const sl = slug(raw);
    if (sl) return sl;
  } catch {
    /* ignore */
  }
  return "";
}

async function fetchLatestKind0ByAuthor(pubkeys) {
  const pool = new SimplePool(POOL_OPTS);
  const byPk = new Map();
  for (let i = 0; i < pubkeys.length; i += AUTHOR_CHUNK) {
    const chunk = pubkeys.slice(i, i + AUTHOR_CHUNK);
    const events = await pool.list(RELAYS, [
      { kinds: [0], authors: chunk, limit: 500 },
    ]);
    for (const ev of events) {
      const pk = ev.pubkey.toLowerCase();
      const cur = byPk.get(pk);
      if (!cur || ev.created_at > cur.created_at) byPk.set(pk, ev);
    }
    console.error(
      `kind-0 fetch: ${Math.min(i + AUTHOR_CHUNK, pubkeys.length)}/${
        pubkeys.length
      }`
    );
  }
  pool.close(RELAYS);
  const profile = new Map();
  for (const pk of pubkeys) {
    const ev = byPk.get(pk);
    profile.set(pk, ev ? usernameFromKind0(ev) : "");
  }
  return profile;
}

function assignUniqueUsernames(pubkeys, profileSlug) {
  const used = new Set();
  const pkToUser = new Map();
  for (const pk of pubkeys) {
    let base = profileSlug.get(pk) || "";
    if (!base) base = `pub_${pk.slice(0, 8)}`;
    let candidate = base;
    if (used.has(candidate)) candidate = `${base}-${pk.slice(0, 8)}`;
    used.add(candidate);
    pkToUser.set(pk, candidate);
  }
  return pkToUser;
}

async function main() {
  if (!fs.existsSync(HEX_SOURCE)) {
    console.error("Missing", HEX_SOURCE);
    process.exit(1);
  }
  const text = fs.readFileSync(HEX_SOURCE, "utf8");
  const rows = parseInput(text);
  if (rows.length === 0) {
    console.error("No rows parsed from", OUT);
    process.exit(1);
  }
  const pubkeys = [...new Set(rows.map((r) => r.pubkey))].sort();
  console.error(`Unique owners: ${pubkeys.length}, repo rows: ${rows.length}`);
  const profileSlug = await fetchLatestKind0ByAuthor(pubkeys);
  const pkToUser = assignUniqueUsernames(pubkeys, profileSlug);

  const lines = new Set();
  for (const { pubkey, repo } of rows) {
    lines.add(`${pkToUser.get(pubkey)}/${repo}`);
  }
  const sorted = [...lines].sort();

  const srcName = path.basename(HEX_SOURCE);
  const header = [
    "# username/reponame — derived from bridge ownerhex list (see source filename in next line)",
    `# Source: ${srcName}`,
    "# username: Nostr kind 0 — nip05 local-part, else display_name/name (slugified);",
    "#          if missing/junk profile: pub_<first8hex> (suffix if collision).",
    "# Rebuild: node scripts/build-gittr-repo-owner-usernames.mjs [hexfile] [outfile]",
    "",
  ].join("\n");

  fs.writeFileSync(OUT, header + sorted.join("\n") + "\n");
  console.error(`Wrote ${sorted.length} lines to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
