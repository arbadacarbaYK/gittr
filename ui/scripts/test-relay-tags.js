// @ts-nocheck
/**
 * Test script to verify relay tags are comma-separated in announcement events
 * 
 * Usage: node ui/scripts/test-relay-tags.js
 */

const { SimplePool } = require("nostr-tools");

const KIND_REPOSITORY_NIP34 = 30617;

async function testRelayTags() {
  const pool = new SimplePool();
  
  // Use common relays
  const relays = [
    "wss://relay.damus.io",
    "wss://nos.lol",
    "wss://relay.nostr.band",
    "wss://relay.ngit.dev",
    "wss://ngit-relay.nostrver.se",
    "wss://gitnostr.com",
  ];

  console.log("🔍 Testing relay tag format in announcement events...\n");

  // Query for recent repo announcement events
  const events = await pool.get(relays, {
    kinds: [KIND_REPOSITORY_NIP34],
    limit: 10,
  });

  await pool.close(relays);

  if (!events || events.length === 0) {
    console.log("❌ No announcement events found to test");
    return;
  }

  console.log(`✅ Found ${events.length} announcement event(s)\n`);

  let commaSeparatedCount = 0;
  let separateTagsCount = 0;
  let noRelayTagsCount = 0;

  events.forEach((event, idx) => {
    const dTag = event.tags.find(t => Array.isArray(t) && t[0] === "d");
    const repoName = dTag?.[1] || "unknown";
    
    // Find all relay tags
    const relayTags = event.tags.filter(t => Array.isArray(t) && (t[0] === "relays" || t[0] === "relay"));
    
    console.log(`${idx + 1}. Repo: ${repoName}`);
    console.log(`   Event ID: ${event.id.slice(0, 16)}...`);
    console.log(`   Created: ${new Date(event.created_at * 1000).toISOString()}`);
    
    if (relayTags.length === 0) {
      console.log(`   ⚠️  No relay tags found`);
      noRelayTagsCount++;
    } else {
      relayTags.forEach((tag, tagIdx) => {
        const tagValue = tag[1];
        const hasComma = tagValue.includes(",");
        
        console.log(`   Relay tag #${tagIdx + 1}: ${hasComma ? "✅ COMMA-SEPARATED" : "❌ SINGLE VALUE"}`);
        console.log(`      Value: ${tagValue.length > 80 ? tagValue.slice(0, 80) + "..." : tagValue}`);
        
        if (hasComma) {
          commaSeparatedCount++;
          const relayUrls = tagValue.split(",").map(r => r.trim()).filter(r => r.length > 0);
          console.log(`      Parsed ${relayUrls.length} relay(s): ${relayUrls.slice(0, 3).join(", ")}${relayUrls.length > 3 ? "..." : ""}`);
        } else {
          separateTagsCount++;
        }
      });
    }
    console.log("");
  });

  console.log("📊 Summary:");
  console.log(`   Total events: ${events.length}`);
  console.log(`   ✅ Comma-separated relay tags: ${commaSeparatedCount}`);
  console.log(`   ❌ Separate relay tags: ${separateTagsCount}`);
  console.log(`   ⚠️  No relay tags: ${noRelayTagsCount}`);
  
  if (commaSeparatedCount > 0) {
    console.log("\n✅ Good: Found comma-separated relay tags (correct format)");
  }
  if (separateTagsCount > 0) {
    console.log("\n⚠️  Warning: Found separate relay tags (old format - needs update)");
  }
}

testRelayTags()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("❌ Error:", err);
    process.exit(1);
  });

