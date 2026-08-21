#!/usr/bin/env node
/**
 * Find bare repos still on the git-nostr bridge whose latest NIP-34 (30617)
 * announcement is soft-deleted — then optionally remove them.
 *
 * SAFETY:
 * - Dry-run by default (print only).
 * - Removes ONLY when a 30617 is found AND deleted=true (tag or content JSON).
 * - Never removes when no event is found (relay miss ≠ deleted) — those may still
 *   be live imports with commits. Empty+no-event shells (≥7d) are a separate
 *   ops pass (see SETUP_INSTRUCTIONS retention table); not handled by this script.
 * - Never removes when the announcement is live (not deleted).
 *
 * Usage:
 *   node scripts/prune-bridge-deleted-orphans.mjs --list-via-ssh root@HOST
 *   node scripts/prune-bridge-deleted-orphans.mjs --list-via-ssh root@HOST --apply
 *   node scripts/prune-bridge-deleted-orphans.mjs --from-list /tmp/repos.txt
 *
 * Env:
 *   GIT_NOSTR_SSH_KEY  default ~/.ssh/id_ed25519_hetzner_new
 *   GIT_NOSTR_REPOS    remote path (default /home/git-nostr/git-nostr-repositories)
 *   GIT_NOSTR_DB       remote sqlite
 *   NOSTR_RELAYS       comma-separated (optional)
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const WebSocket = require(join(__dirname, "../ui/node_modules/ws"));

const KIND_REPO = 30617;
const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
  "wss://purplepag.es",
  "wss://relay.primal.net",
];
const AUTHOR_CONCURRENCY = 6;
const AUTHOR_TIMEOUT_MS = 14000;

function parseArgs(argv) {
  const out = {
    apply: false,
    listViaSsh: null,
    fromList: null,
    sshKey:
      process.env.GIT_NOSTR_SSH_KEY ||
      `${homedir()}/.ssh/id_ed25519_hetzner_new`,
    repoBase:
      process.env.GIT_NOSTR_REPOS || "/home/git-nostr/git-nostr-repositories",
    dbPath:
      process.env.GIT_NOSTR_DB ||
      "/home/git-nostr/.config/git-nostr/git-nostr-db.sqlite",
    relays: (process.env.NOSTR_RELAYS || DEFAULT_RELAYS.join(","))
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--list-via-ssh") out.listViaSsh = argv[++i];
    else if (a === "--from-list") out.fromList = argv[++i];
    else if (a === "--ssh-key") out.sshKey = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log("See script header for usage.");
      process.exit(0);
    }
  }
  return out;
}

function isDeletedAnnouncement(event) {
  if (!event) return false;
  const tags = Array.isArray(event.tags) ? event.tags : [];
  if (tags.some((t) => t?.[0] === "deleted" && t?.[1] === "true")) return true;
  if (tags.some((t) => t?.[0] === "status" && t?.[1] === "deleted"))
    return true;
  if (typeof event.content === "string" && event.content.trim()) {
    try {
      const j = JSON.parse(event.content);
      if (j && j.deleted === true) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

function dTag(event) {
  const t = (event.tags || []).find((x) => x?.[0] === "d");
  return t?.[1] || "";
}

/** Latest 30617 per d-tag for one author (merge across relays). */
function queryAuthorRepos(relays, authorHex, timeoutMs = AUTHOR_TIMEOUT_MS) {
  return new Promise((resolvePromise) => {
    const byD = new Map();
    const filter = {
      kinds: [KIND_REPO],
      authors: [authorHex.toLowerCase()],
      limit: 500,
    };
    let pending = relays.length;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolvePromise(byD);
    };
    const timer = setTimeout(done, timeoutMs);
    const finishOne = () => {
      pending--;
      if (pending <= 0) {
        clearTimeout(timer);
        done();
      }
    };

    for (const url of relays) {
      let ws;
      let finished = false;
      const once = () => {
        if (finished) return;
        finished = true;
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
        finishOne();
      };
      try {
        ws = new WebSocket(url);
      } catch {
        once();
        continue;
      }
      const subId = `a_${authorHex.slice(0, 8)}_${Math.random().toString(36).slice(2, 8)}`;
      ws.on("open", () => {
        ws.send(JSON.stringify(["REQ", subId, filter]));
      });
      ws.on("message", (raw) => {
        let msg;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (!Array.isArray(msg)) return;
        if (msg[0] === "EVENT" && msg[1] === subId && msg[2]) {
          const ev = msg[2];
          const d = dTag(ev);
          if (!d) return;
          const prev = byD.get(d);
          if (!prev || (ev.created_at || 0) > (prev.created_at || 0)) {
            byD.set(d, ev);
          }
        }
        if (msg[0] === "EOSE" && msg[1] === subId) {
          try {
            ws.send(JSON.stringify(["CLOSE", subId]));
          } catch {
            /* ignore */
          }
          once();
        }
      });
      ws.on("error", once);
      ws.on("close", () => {
        /* may already once() */
      });
      setTimeout(once, timeoutMs);
    }
  });
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
}

function ssh(opts, remoteCmd) {
  const key = resolve(opts.sshKey);
  const args = [
    "-i",
    key,
    "-o",
    "StrictHostKeyChecking=accept-new",
    opts.listViaSsh,
    remoteCmd,
  ];
  const r = spawnSync("ssh", args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`ssh failed: ${r.stderr || r.stdout || r.status}`);
  }
  return r.stdout;
}

function listReposViaSsh(opts) {
  const cmd = `find '${opts.repoBase}' -mindepth 2 -maxdepth 2 -type d -name '*.git' -printf '%P\\n' 2>/dev/null | sed 's/\\.git$//'`;
  const out = ssh(opts, cmd);
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[0-9a-f]{64}\/[^/]+$/.test(l));
}

function listFromFile(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) => l && !l.startsWith("#") && /^[0-9a-f]{64}\/[^/]+$/.test(l)
    );
}

function applyRemove(opts, owner, name) {
  // name is path-safe from disk listing; still quote for shell
  const bare = `${opts.repoBase}/${owner}/${name}.git`;
  const sql = `DELETE FROM Repository WHERE OwnerPubKey='${owner}' AND RepositoryName='${name}'; DELETE FROM RepositoryPermission WHERE OwnerPubKey='${owner}' AND RepositoryName='${name}';`;
  const cmd = [
    `test -d '${bare}' && du -sh '${bare}' && rm -rf '${bare}' && echo REMOVED_DISK || echo NO_DISK`,
    `sqlite3 '${opts.dbPath}' "${sql}" && echo REMOVED_DB || echo DB_SKIP`,
  ].join(" ; ");
  return ssh(opts, cmd);
}

async function main() {
  const opts = parseArgs(process.argv);
  if (!opts.listViaSsh && !opts.fromList) {
    console.error("Need --list-via-ssh user@host or --from-list file");
    process.exit(2);
  }

  let entries;
  if (opts.fromList) {
    entries = listFromFile(opts.fromList);
  } else {
    console.error(`Listing bare repos via ${opts.listViaSsh} …`);
    entries = listReposViaSsh(opts);
  }

  const byOwner = new Map();
  for (const e of entries) {
    const [owner, name] = e.split("/");
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner).push(name);
  }
  const owners = [...byOwner.keys()];
  console.error(
    `Checking ${entries.length} bare repos across ${owners.length} owners (${opts.relays.length} relays, concurrency ${AUTHOR_CONCURRENCY}) …`
  );

  /** Targeted fetch when author has >limit events and a disk name was missing. */
  function queryOneRepo(relays, authorHex, repoName, timeoutMs = 10000) {
    return new Promise((resolvePromise) => {
      let best = null;
      let pending = relays.length;
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolvePromise(best);
      };
      const timer = setTimeout(done, timeoutMs);
      for (const url of relays) {
        let ws;
        let finished = false;
        const once = () => {
          if (finished) return;
          finished = true;
          try {
            ws?.close();
          } catch {
            /* ignore */
          }
          pending--;
          if (pending <= 0) {
            clearTimeout(timer);
            done();
          }
        };
        try {
          ws = new WebSocket(url);
        } catch {
          once();
          continue;
        }
        const subId = `d_${Math.random().toString(36).slice(2, 10)}`;
        ws.on("open", () => {
          ws.send(
            JSON.stringify([
              "REQ",
              subId,
              {
                kinds: [KIND_REPO],
                authors: [authorHex.toLowerCase()],
                "#d": [repoName],
                limit: 3,
              },
            ])
          );
        });
        ws.on("message", (raw) => {
          let msg;
          try {
            msg = JSON.parse(String(raw));
          } catch {
            return;
          }
          if (!Array.isArray(msg)) return;
          if (msg[0] === "EVENT" && msg[1] === subId && msg[2]) {
            const ev = msg[2];
            if (!best || (ev.created_at || 0) > (best.created_at || 0)) best = ev;
          }
          if (msg[0] === "EOSE" && msg[1] === subId) {
            try {
              ws.send(JSON.stringify(["CLOSE", subId]));
            } catch {
              /* ignore */
            }
            once();
          }
        });
        ws.on("error", once);
        setTimeout(once, timeoutMs);
      }
    });
  }

  let doneOwners = 0;
  const authorMaps = await mapPool(owners, AUTHOR_CONCURRENCY, async (owner) => {
    const map = await queryAuthorRepos(opts.relays, owner);
    doneOwners++;
    process.stderr.write(
      `\r[${doneOwners}/${owners.length}] owners  events_for_last=${map.size}   `
    );
    return { owner, map };
  });
  process.stderr.write("\n");

  const eventByKey = new Map();
  for (const { owner, map } of authorMaps) {
    for (const [d, ev] of map) {
      eventByKey.set(`${owner}/${d}`, ev);
    }
    // Relay limit:500 can miss older/newer replaceables — fill gaps for disk names only.
    if (map.size >= 500) {
      const missing = (byOwner.get(owner) || []).filter((n) => !map.has(n));
      if (missing.length) {
        console.error(
          `\nAuthor ${owner.slice(0, 12)}… hit event cap; targeted check for ${missing.length} disk name(s) …`
        );
        for (const name of missing) {
          const ev = await queryOneRepo(opts.relays, owner, name);
          if (ev) eventByKey.set(`${owner}/${name}`, ev);
        }
      }
    }
  }

  const orphans = [];
  const live = [];
  const unknown = [];

  for (const e of entries) {
    const [owner, name] = e.split("/");
    const ev = eventByKey.get(e);
    if (!ev) {
      unknown.push({ owner, name });
      continue;
    }
    if (isDeletedAnnouncement(ev)) {
      orphans.push({
        owner,
        name,
        eventId: ev.id,
        created_at: ev.created_at,
        d: dTag(ev),
      });
    } else {
      live.push({ owner, name, eventId: ev.id });
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: opts.apply ? "apply" : "dry-run",
        totals: {
          bare: entries.length,
          owners: owners.length,
          deleted_orphan: orphans.length,
          live_keep: live.length,
          no_event_keep: unknown.length,
        },
        orphans,
        no_event_sample: unknown.slice(0, 30),
      },
      null,
      2
    )
  );

  if (!opts.apply) {
    console.error(
      `\nDry-run only. Re-run with --apply to remove ${orphans.length} confirmed deleted orphan(s).`
    );
    console.error(
      `Keeping ${live.length} live + ${unknown.length} with no relay event (owners may still expect those).`
    );
    return;
  }

  if (!opts.listViaSsh) {
    console.error("--apply requires --list-via-ssh so we can rm on the host");
    process.exit(2);
  }

  for (const o of orphans) {
    console.error(`Removing ${o.owner}/${o.name} (event ${o.eventId}) …`);
    const out = applyRemove(opts, o.owner, o.name);
    console.error(out.trim());
  }
  console.error(`Done. Removed ${orphans.length} confirmed deleted orphan(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
