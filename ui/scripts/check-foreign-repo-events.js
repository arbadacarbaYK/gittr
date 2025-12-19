// @ts-nocheck
/**
 * Script to check announcement events (kind 30617) for foreign repos
 * Verifies if they have clone URLs and other tags
 * 
 * Usage: node ui/scripts/check-foreign-repo-events.js <npub> <repo-name>
 * Example: node ui/scripts/check-foreign-repo-events.js npub1hs5244d3vle3m5muvmvvjh2qp3jprkpjwhk393gy7cykt50eamrq8f5rx4 pkgz
 */

const { nip19, SimplePool } = require("nostr-tools");

const KIND_REPOSITORY_NIP34 = 30617;

async function checkRepoEvent(npub, repoName) {
  const pool = new SimplePool();
  
  // Decode npub to pubkey
  let pubkey;
  try {
    const decoded = nip19.decode(npub);
    if (decoded.type === "npub") {
      pubkey = decoded.data;
    } else {
      console.error("❌ Invalid npub format");
      process.exit(1);
    }
  } catch (e) {
    // Maybe it's already a pubkey?
    if (npub.length === 64 && /^[0-9a-f]{64}$/i.test(npub)) {
      pubkey = npub;
    } else {
      console.error("❌ Failed to decode npub:", e.message);
      process.exit(1);
    }
  }

  console.log(`🔍 Checking announcement event for repo: ${repoName}`);
  console.log(`   Owner: ${npub}`);
  console.log(`   Pubkey: ${pubkey.slice(0, 16)}...`);
  console.log("");

  // Use common relays
  const relays = [
    "wss://relay.damus.io",
    "wss://nos.lol",
    "wss://relay.nostr.band",
    "wss://relay.ngit.dev",
    "wss://ngit-relay.nostrver.se",
    "wss://gitnostr.com",
    "wss://ngit.danconwaydev.com",
  ];

  console.log(`📡 Querying ${relays.length} relays...`);

  function processEvent(event) {
    console.log(`✅ Found announcement event:`);
    console.log(`   Event ID: ${event.id}`);
    console.log(`   Created: ${new Date(event.created_at * 1000).toISOString()}`);
    console.log(`   Pubkey: ${event.pubkey.slice(0, 16)}...`);
    console.log("");

    // Parse tags
    const tags = {};
    event.tags.forEach(tag => {
      if (!Array.isArray(tag) || tag.length < 2) return;
      const key = tag[0];
      const value = tag[1];
      if (!tags[key]) tags[key] = [];
      tags[key].push(value);
    });

    console.log("📋 Event Tags:");
    Object.keys(tags).sort().forEach(key => {
      const values = tags[key];
      console.log(`   ${key}: ${values.length} value(s)`);
      values.forEach((val, idx) => {
        const display = val.length > 80 ? val.slice(0, 80) + "..." : val;
        console.log(`      [${idx + 1}] ${display}`);
      });
    });
    console.log("");

    // Check for clone URLs
    const cloneUrls = tags.clone || [];
    console.log(`🔗 Clone URLs: ${cloneUrls.length}`);
    if (cloneUrls.length === 0) {
      console.log("   ❌ NO CLONE URLS FOUND!");
      console.log("   This is why gitworkshop.dev shows 'none' for servers.");
    } else {
      cloneUrls.forEach((url, idx) => {
        console.log(`   [${idx + 1}] ${url}`);
      });
    }
    console.log("");

    // Check for relays
    const relayTags = tags.relays || tags.relay || [];
    console.log(`📡 Relays: ${relayTags.length}`);
    if (relayTags.length === 0) {
      console.log("   ⚠️  No relay tags found");
    } else {
      relayTags.forEach((relay, idx) => {
        console.log(`   [${idx + 1}] ${relay}`);
      });
    }
    console.log("");

    // Check other important tags
    console.log("📌 Other Tags:");
    console.log(`   d (repo identifier): ${tags.d?.[0] || "MISSING"}`);
    console.log(`   name: ${tags.name?.[0] || "not set"}`);
    console.log(`   description: ${tags.description?.[0] ? tags.description[0].slice(0, 100) + "..." : "not set"}`);
    console.log(`   source: ${tags.source?.[0] || "not set"}`);
    console.log(`   maintainers (p tags): ${tags.p?.length || 0}`);
  }

  try {
    const events = await pool.get(relays, {
      kinds: [KIND_REPOSITORY_NIP34],
      authors: [pubkey],
      "#d": [repoName],
      limit: 1,
    });

    if (!events || events.length === 0) {
      console.log("❌ No announcement event found!");
      console.log("   This could mean:");
      console.log("   - The repo was never announced on Nostr");
      console.log("   - The repo name doesn't match the 'd' tag");
      console.log("   - The event isn't on these relays");
      await pool.close(relays);
      return null;
    }

    // Use the most recent event (highest created_at)
    const event = events.sort((a, b) => b.created_at - a.created_at)[0];
    processEvent(event);
    await pool.close(relays);
    return event;
  } catch (err) {
    await pool.close(relays);
    throw err;
  }
}

// Get args
const npub = process.argv[2];
const repoName = process.argv[3];

if (!npub || !repoName) {
  console.error("Usage: node check-foreign-repo-events.js <npub> <repo-name>");
  console.error("Example: node check-foreign-repo-events.js npub1hs5244d3vle3m5muvmvvjh2qp3jprkpjwhk393gy7cykt50eamrq8f5rx4 pkgz");
  process.exit(1);
}

checkRepoEvent(npub, repoName)
  .then(() => process.exit(0))
  .catch(err => {
    console.error("❌ Error:", err);
    process.exit(1);
  });
