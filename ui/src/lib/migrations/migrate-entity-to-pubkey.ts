/**
 * Migrates repos that have GitHub usernames or 8-char pubkey prefixes as entity to use npub format
 * This fixes repos created before the entity fix that used GitHub username or 8-char prefix instead of npub
 */
import { nip19 } from "nostr-tools";

export function migrateEntityToPubkey(
  currentUserPubkey: string | null,
  currentUserName: string | null
): boolean {
  // CRITICAL: Run migration even without currentUserPubkey to fix ALL repos with 8-char entities
  // This ensures repos from all users get migrated, not just the current user's
  let updated = false;
  
  if (!currentUserPubkey || typeof currentUserPubkey !== "string") {
    // Still run migration for repos with ownerPubkey, just skip current-user-specific migrations
    console.log('⚠️ [Migration] Running migration without currentUserPubkey - will migrate all repos with ownerPubkey');
  }

  try {
    const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as any[];
    
    // Use npub format (GRASP protocol standard) instead of 8-char prefix (only if we have currentUserPubkey)
    const entityNpub = currentUserPubkey && typeof currentUserPubkey === "string" 
      ? nip19.npubEncode(currentUserPubkey) 
      : null;
    const displayName = currentUserPubkey && currentUserName && currentUserName !== "Anonymous Nostrich" 
      ? currentUserName.trim() 
      : (entityNpub ? entityNpub.slice(0, 12) : null); // Shortened npub for display

    const migratedRepos = repos.map(r => {
      // Check if entity is a GitHub username (not npub or pubkey)
      const isGitHubUsername = r.entity && 
        !r.entity.startsWith("npub") &&
        !/^[0-9a-f]{8}$/i.test(r.entity) && 
        !/^[0-9a-f]{64}$/i.test(r.entity) &&
        r.entity.length > 8 &&
        (r.entity.includes('-') || r.entity.includes('_') || !/^[0-9a-f]+$/i.test(r.entity));
      
      // Check if entity is an 8-char pubkey prefix (old format we want to migrate)
      const is8CharPrefix = r.entity && 
        r.entity.length === 8 && 
        /^[0-9a-f]{8}$/i.test(r.entity);
      
      // CRITICAL: Also migrate repos where entity is 8-char prefix that matches ownerPubkey prefix
      // This handles repos created by other users or before ownerPubkey was set
      const entityMatchesOwnerPrefix = is8CharPrefix && r.ownerPubkey && 
        /^[0-9a-f]{64}$/i.test(r.ownerPubkey) &&
        r.ownerPubkey.toLowerCase().startsWith(r.entity.toLowerCase());
      
      // If entity looks like GitHub username or 8-char prefix AND ownerPubkey matches current user, migrate to npub
      // OR if entity is 8-char prefix that matches ownerPubkey prefix (regardless of current user)
      if (currentUserPubkey && (isGitHubUsername || is8CharPrefix) && r.ownerPubkey === currentUserPubkey) {
        updated = true;
        return {
          ...r,
          entity: entityNpub!, // Use npub format (we know entityNpub is set because currentUserPubkey exists)
          entityDisplayName: displayName || entityNpub!.slice(0, 12) + "...",
          ownerPubkey: currentUserPubkey, // Ensure ownerPubkey is set
        };
      }
      
      // Also migrate if entity is missing but ownerPubkey exists and matches current user
      if (currentUserPubkey && !r.entity && r.ownerPubkey === currentUserPubkey) {
        updated = true;
        return {
          ...r,
          entity: entityNpub!, // Use npub format
          entityDisplayName: displayName || entityNpub!.slice(0, 12) + "...",
          ownerPubkey: currentUserPubkey,
        };
      }
      
      // CRITICAL: Migrate ALL repos with 8-char entity prefix to use npub (not just current user's)
      // This fixes repos that were created with shortened entities
      // If entity is 8-char and matches ownerPubkey prefix, migrate it
      if (entityMatchesOwnerPrefix && r.ownerPubkey && /^[0-9a-f]{64}$/i.test(r.ownerPubkey)) {
        updated = true;
        const repoEntityNpub = nip19.npubEncode(r.ownerPubkey);
        return {
          ...r,
          entity: repoEntityNpub, // Use npub format
          entityDisplayName: r.entityDisplayName || repoEntityNpub.slice(0, 12) + "...",
          ownerPubkey: r.ownerPubkey,
        };
      }
      
      // CRITICAL: Also migrate repos with 8-char entity even if ownerPubkey doesn't match
      // This handles cases where entity was set incorrectly or ownerPubkey is missing
      // We'll try to find the ownerPubkey from the entity prefix if possible
      if (is8CharPrefix && r.ownerPubkey && /^[0-9a-f]{64}$/i.test(r.ownerPubkey)) {
        // Check if ownerPubkey starts with the entity prefix
        if (r.ownerPubkey.toLowerCase().startsWith(r.entity.toLowerCase())) {
          updated = true;
          const repoEntityNpub = nip19.npubEncode(r.ownerPubkey);
          return {
            ...r,
            entity: repoEntityNpub, // Use npub format
            entityDisplayName: r.entityDisplayName || repoEntityNpub.slice(0, 12) + "...",
            ownerPubkey: r.ownerPubkey,
          };
        }
      }
      
      // CRITICAL: If entity is 8-char but we don't have ownerPubkey, keep it as-is for now
      // (We can't migrate without knowing the full pubkey)
      // But ensure ownerPubkey is set if we can derive it from entity
      if (is8CharPrefix && !r.ownerPubkey) {
        // Can't migrate without ownerPubkey - leave as-is but log it
        console.warn('⚠️ [Migration] Repo with 8-char entity but no ownerPubkey:', {
          entity: r.entity,
          repo: r.repo || r.slug,
          name: r.name
        });
      }
      
      return r;
    });

    if (updated) {
      try {
        localStorage.setItem("gittr_repos", JSON.stringify(migratedRepos));
        const migratedCount = migratedRepos.filter(r => 
          r.entity && (r.entity.startsWith("npub") || /^[0-9a-f]{64}$/i.test(r.entity))
        ).length;
        console.log(`✅ [Migration] Migrated ${migratedCount} repos to use entity npub format (GRASP protocol standard). Total repos: ${migratedRepos.length}`);
        return true;
      } catch (storageError: any) {
        if (storageError.name === "QuotaExceededError" || storageError.code === 22) {
          console.warn("⚠️ [Migration] Cannot migrate entity to npub: localStorage quota exceeded. Consider cleaning up old data.");
          return false;
        }
        throw storageError; // Re-throw if it's a different error
      }
    }
  } catch (e) {
    console.error("Failed to migrate entity to npub:", e);
  }
  
  return false;
}
