/**
 * Utility script to find corrupted repos using the general corruption detection
 * Run this in browser console to identify corrupted repos and their Nostr event IDs
 * 
 * Usage: findCorruptedRepos() in browser console
 * 
 * Note: This uses the general isRepoCorrupted() function which detects:
 * - Missing/invalid repositoryName
 * - Invalid entity (e.g., "gittr.space" instead of npub)
 * - Non-npub entities
 * - Mismatched ownerPubkey vs entity pubkey
 */

import { isRepoCorrupted } from "../../lib/utils/repo-corruption-check";

export function findCorruptedRepos(): {
  corruptCount: number;
  validCount: number;
  corruptRepos: any[];
  eventIds: string[];
} {
  if (typeof window === 'undefined') {
    console.error("This script must be run in the browser");
    return {
      corruptCount: 0,
      validCount: 0,
      corruptRepos: [],
      eventIds: []
    };
  }

  const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
  
  const corruptRepos = repos.filter((r: any) => {
    const eventId = r.nostrEventId || r.lastNostrEventId;
    return isRepoCorrupted(r, eventId);
  });
  
  const validRepos = repos.filter((r: any) => {
    const eventId = r.nostrEventId || r.lastNostrEventId;
    return !isRepoCorrupted(r, eventId);
  });

  console.log(`🔍 Found ${repos.length} total repos in localStorage`);
  console.log(`❌ Corrupt repos: ${corruptRepos.length}`);
  console.log(`✅ Valid repos: ${validRepos.length}`);

  if (corruptRepos.length > 0) {
    console.log("\n📋 Corrupted repos (should be removed from localStorage):");
    corruptRepos.forEach((r: any, index: number) => {
      const repoName = r.repositoryName || r.repo || r.slug || r.name || "unknown";
      console.log(`\n${index + 1}. Corrupted repo:`, {
        entity: r.entity || "missing",
        repo: repoName,
        ownerPubkey: r.ownerPubkey ? (r.ownerPubkey.slice(0, 16) + "...") : "missing",
        nostrEventId: r.nostrEventId,
        lastNostrEventId: r.lastNostrEventId,
        syncedFromNostr: r.syncedFromNostr,
        createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : "unknown",
        corruptionReasons: getCorruptionReasons(r)
      });
    });

    // Extract all unique event IDs
    const eventIds = new Set<string>();
    corruptRepos.forEach((r: any) => {
      if (r.nostrEventId) eventIds.add(r.nostrEventId);
      if (r.lastNostrEventId) eventIds.add(r.lastNostrEventId);
    });

    console.log("\n📝 Nostr Event IDs to check/delete on bridge:");
    Array.from(eventIds).forEach((eventId, index) => {
      console.log(`${index + 1}. ${eventId}`);
    });

    return {
      corruptCount: corruptRepos.length,
      validCount: validRepos.length,
      corruptRepos,
      eventIds: Array.from(eventIds)
    };
  } else {
    console.log("✅ No corrupted repos found!");
    return {
      corruptCount: 0,
      validCount: validRepos.length,
      corruptRepos: [],
      eventIds: []
    };
  }
}

/**
 * Get human-readable reasons why a repo is considered corrupted
 */
function getCorruptionReasons(repo: any): string[] {
  const reasons: string[] = [];
  const repoName = repo.repositoryName || repo.repo || repo.slug || repo.name || "";
  const entity = repo.entity || "";
  
  if (!repoName || repoName.trim() === "") {
    reasons.push("Missing repositoryName");
  }
  
  if (!entity || entity === "gittr.space" || (entity.includes(".") && !entity.startsWith("npub"))) {
    reasons.push(`Invalid entity: "${entity}" (should be npub format)`);
  }
  
  if (entity && !entity.startsWith("npub")) {
    reasons.push(`Non-npub entity: "${entity}"`);
  }
  
  // Check ownerPubkey mismatch (synchronous check using nip19 if available)
  if (entity && entity.startsWith("npub") && repo.ownerPubkey) {
    try {
      // Use nip19 from global scope if available (from nostr-tools)
      const nip19 = (window as any).nostr?.nip19 || (window as any).nip19;
      if (nip19) {
      const decoded = nip19.decode(entity);
      if (decoded.type === "npub") {
        const entityPubkey = (decoded.data as string).toLowerCase();
        const ownerPubkey = repo.ownerPubkey.toLowerCase();
        if (ownerPubkey !== entityPubkey) {
          reasons.push(`OwnerPubkey mismatch: entity pubkey doesn't match ownerPubkey`);
        }
      }
      } else {
        // Fallback: check if ownerPubkey looks valid but doesn't match entity pattern
        if (repo.ownerPubkey.length === 64 && /^[0-9a-f]{64}$/i.test(repo.ownerPubkey)) {
          reasons.push("OwnerPubkey present but cannot verify match with entity (nip19 not available)");
        }
      }
    } catch (e: any) {
      reasons.push(`Cannot decode entity: ${e?.message || e}`);
    }
  }
  
  return reasons.length > 0 ? reasons : ["Unknown corruption reason"];
}

// Make it available globally for console access
if (typeof window !== 'undefined') {
  (window as any).findCorruptedRepos = findCorruptedRepos;
  // Keep old name for backward compatibility
  (window as any).findCorruptTidesRepos = findCorruptedRepos;
}

