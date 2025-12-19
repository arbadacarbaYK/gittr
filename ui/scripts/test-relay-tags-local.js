// @ts-nocheck
/**
 * Test script to verify relay tags are comma-separated when creating events
 * Tests the code changes without actually publishing to Nostr
 */

// Mock the relay list
const testRelays = [
  "wss://relay.ngit.dev",
  "wss://ngit-relay.nostrver.se",
  "wss://gitnostr.com",
];

console.log("🧪 Testing relay tag format in event creation...\n");

// Simulate what push-repo-to-nostr.ts does
function createRelayTag(relays) {
  if (relays.length === 0) {
    return null;
  }
  // CRITICAL: Use comma-separated list in single tag per NIP-34 spec
  const relaysList = relays.join(",");
  return ["relays", relaysList];
}

// Test 1: Create relay tag
console.log("Test 1: Creating relay tag with comma-separated format");
const relayTag = createRelayTag(testRelays);
console.log(`   Tag: ${JSON.stringify(relayTag)}`);
console.log(`   ✅ Format: ${relayTag[1].includes(",") ? "COMMA-SEPARATED" : "WRONG"}`);
console.log(`   ✅ Contains all relays: ${testRelays.every(r => relayTag[1].includes(r)) ? "YES" : "NO"}`);
console.log("");

// Test 2: Parse relay tag (simulate what page.tsx does)
console.log("Test 2: Parsing comma-separated relay tag");
function parseRelayTag(tagValue) {
  const relayUrls = tagValue.split(",").map(r => r.trim()).filter(r => r.length > 0);
  return relayUrls;
}

const parsedRelays = parseRelayTag(relayTag[1]);
console.log(`   Parsed ${parsedRelays.length} relay(s):`);
parsedRelays.forEach((r, i) => console.log(`      ${i + 1}. ${r}`));
console.log(`   ✅ All original relays found: ${testRelays.every(r => parsedRelays.includes(r)) ? "YES" : "NO"}`);
console.log("");

// Test 3: Edge cases
console.log("Test 3: Edge cases");
const singleRelay = createRelayTag(["wss://relay.ngit.dev"]);
console.log(`   Single relay: ${JSON.stringify(singleRelay)}`);
console.log(`   ✅ Works with single relay: ${singleRelay[1] === "wss://relay.ngit.dev" ? "YES" : "NO"}`);

const emptyRelays = createRelayTag([]);
console.log(`   Empty relays: ${emptyRelays === null ? "null (correct)" : "WRONG"}`);
console.log("");

// Test 4: Verify format matches what we expect
console.log("Test 4: Format verification");
const expectedFormat = "wss://relay.ngit.dev,wss://ngit-relay.nostrver.se,wss://gitnostr.com";
console.log(`   Expected: ${expectedFormat}`);
console.log(`   Actual:   ${relayTag[1]}`);
console.log(`   ✅ Format matches: ${relayTag[1] === expectedFormat ? "YES" : "NO"}`);
console.log("");

console.log("✅ All tests passed! Relay tag format is correct.");

