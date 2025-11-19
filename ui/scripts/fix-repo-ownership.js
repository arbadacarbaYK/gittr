/**
 * Fix repository ownership and delete problematic repos
 * Run this in browser console or via Node.js
 */

const fixRepos = () => {
  try {
    // Get current user's pubkey
    const currentPubkey = localStorage.getItem("gittr_npub");
    if (!currentPubkey) {
      console.error("No user logged in");
      return;
    }
    
    // Decode npub to pubkey if needed
    let pubkey = currentPubkey;
    if (currentPubkey.startsWith("npub")) {
      try {
        const { decode } = require("nostr-tools/nip19");
        const decoded = decode(currentPubkey);
        if (decoded.type === "npub") {
          pubkey = decoded.data;
        }
      } catch (e) {
        console.error("Failed to decode npub:", e);
        return;
      }
    }
    
    console.log("Current user pubkey:", pubkey);
    
    // Load repos
    const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
    console.log(`Found ${repos.length} repos`);
    
    // 1. Delete test_repo_icon_check_fork
    const filteredRepos = repos.filter(r => {
      const repoName = r.repo || r.slug || r.name || "";
      return repoName !== "test_repo_icon_check_fork";
    });
    
    const deletedCount = repos.length - filteredRepos.length;
    if (deletedCount > 0) {
      console.log(`✅ Deleted ${deletedCount} instance(s) of test_repo_icon_check_fork`);
    }
    
    // 2. Fix tides repo ownership
    const fixedRepos = filteredRepos.map(r => {
      const repoName = r.repo || r.slug || r.name || "";
      
      // Fix tides repo
      if (repoName === "tides" && (!r.ownerPubkey || r.ownerPubkey !== pubkey)) {
        console.log("🔧 Fixing tides repo ownership:", {
          current: r.ownerPubkey,
          shouldBe: pubkey,
          entity: r.entity
        });
        
        // Ensure ownerPubkey is set
        const updated = { ...r };
        updated.ownerPubkey = pubkey;
        
        // Ensure owner is in contributors
        if (!updated.contributors || !Array.isArray(updated.contributors)) {
          updated.contributors = [];
        }
        
        // Check if owner already in contributors
        const ownerExists = updated.contributors.some(c => c.pubkey === pubkey);
        if (!ownerExists) {
          updated.contributors.unshift({
            pubkey: pubkey,
            weight: 100,
            role: "owner"
          });
        } else {
          // Update existing owner contributor
          updated.contributors = updated.contributors.map(c => 
            c.pubkey === pubkey ? { ...c, weight: 100, role: "owner" } : c
          );
        }
        
        // Ensure entity matches pubkey prefix if it doesn't already
        if (!updated.entity || updated.entity === "user") {
          updated.entity = pubkey.slice(0, 8).toLowerCase();
        }
        
        return updated;
      }
      
      return r;
    });
    
    // Save fixed repos
    localStorage.setItem("gittr_repos", JSON.stringify(fixedRepos));
    console.log(`✅ Fixed ${fixedRepos.length} repos`);
    
    // 3. Fix activities with wrong user pubkeys
    const activities = JSON.parse(localStorage.getItem("gittr_activities") || "[]");
    const fixedActivities = activities.map(a => {
      // If activity has a partial pubkey that starts with "arbadaca" but isn't the full pubkey
      if (a.user && a.user.length < 64 && a.user.toLowerCase().includes("arbadaca")) {
        // Try to find the full pubkey from repos
        const matchingRepo = fixedRepos.find(r => 
          r.ownerPubkey && r.ownerPubkey.toLowerCase().startsWith(a.user.toLowerCase())
        );
        if (matchingRepo?.ownerPubkey && matchingRepo.ownerPubkey === pubkey) {
          console.log(`🔧 Fixing activity user: ${a.user} -> ${pubkey}`);
          return { ...a, user: pubkey };
        }
      }
      return a;
    });
    
    localStorage.setItem("gittr_activities", JSON.stringify(fixedActivities));
    console.log(`✅ Fixed ${fixedActivities.length} activities`);
    
    console.log("✅ All fixes applied!");
    return {
      reposFixed: fixedRepos.length,
      activitiesFixed: fixedActivities.length,
      deletedRepos: deletedCount
    };
  } catch (error) {
    console.error("Error fixing repos:", error);
    return null;
  }
};

// Export for Node.js
if (typeof module !== "undefined" && module.exports) {
  module.exports = { fixRepos };
}

// Auto-run in browser
if (typeof window !== "undefined") {
  fixRepos();
}

