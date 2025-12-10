/**
 * Utility script to find corrupt "tides" repos with entity "gittr.space"
 * Run this in browser console to identify the Nostr event IDs causing the issue
 * 
 * Usage: findCorruptTidesRepos() in browser console
 */

export function findCorruptTidesRepos(): {
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
  const tidesRepos = repos.filter((r: any) => {
    const repoName = (r.repo || r.slug || r.name || "").toLowerCase();
    return repoName === "tides";
  });

  console.log(`🔍 Found ${tidesRepos.length} "tides" repos in localStorage`);
  
  const corruptRepos = tidesRepos.filter((r: any) => r.entity === "gittr.space");
  const validRepos = tidesRepos.filter((r: any) => r.entity !== "gittr.space");

  console.log(`❌ Corrupt repos (entity="gittr.space"): ${corruptRepos.length}`);
  console.log(`✅ Valid repos: ${validRepos.length}`);

  if (corruptRepos.length > 0) {
    console.log("\n📋 Corrupt tides repos (need to be removed from bridge):");
    corruptRepos.forEach((r: any, index: number) => {
      console.log(`\n${index + 1}. Corrupt tides repo:`, {
        entity: r.entity,
        repo: r.repo || r.slug || r.name,
        ownerPubkey: r.ownerPubkey?.slice(0, 16) + "...",
        nostrEventId: r.nostrEventId,
        lastNostrEventId: r.lastNostrEventId,
        syncedFromNostr: r.syncedFromNostr,
        createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : "unknown",
        contributors: r.contributors?.map((c: any) => ({
          pubkey: c.pubkey?.slice(0, 16) + "...",
          weight: c.weight,
          role: c.role
        }))
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
    console.log("✅ No corrupt tides repos found!");
    return {
      corruptCount: 0,
      validCount: validRepos.length,
      corruptRepos: [],
      eventIds: []
    };
  }
}

// Make it available globally for console access
if (typeof window !== 'undefined') {
  (window as any).findCorruptTidesRepos = findCorruptTidesRepos;
}

