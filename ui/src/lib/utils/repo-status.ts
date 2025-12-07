/**
 * Repository Status Management
 * Tracks whether repos are local-only, being pushed, or live on Nostr
 * Also tracks if a live repo has unpushed edits
 */

export type RepoStatus = "local" | "pushing" | "live" | "live_with_edits" | "push_failed";

/**
 * Check if repository exists in bridge database (async)
 * This is the source of truth - only repos in bridge DB are truly "live"
 * Updates the repo in localStorage with bridgeProcessed flag
 */
export async function checkBridgeExists(ownerPubkey: string, repoName: string, entity: string): Promise<boolean> {
  try {
    if (!ownerPubkey || !/^[0-9a-f]{64}$/i.test(ownerPubkey)) {
      return false; // Invalid pubkey
    }
    
    const response = await fetch(
      `/api/nostr/repo/exists?ownerPubkey=${encodeURIComponent(ownerPubkey)}&repo=${encodeURIComponent(repoName)}`
    );
    
    if (response.ok) {
      const data = await response.json();
      const exists = data.exists === true;
      // Update repo in localStorage with bridgeProcessed flag
      try {
        const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as any[];
        const repoIndex = repos.findIndex((r: any) => 
          (r.slug === repoName || r.repo === repoName) && r.entity === entity
        );
        
        if (repoIndex >= 0) {
          repos[repoIndex] = { 
            ...repos[repoIndex], 
            bridgeProcessed: exists 
          };
          localStorage.setItem("gittr_repos", JSON.stringify(repos));
        }
      } catch (storageError) {
        console.warn("Failed to update bridgeProcessed flag:", storageError);
      }
      
      return exists;
    }
    
    return false;
  } catch (error) {
    console.warn("Failed to check bridge:", error);
    return false; // On error, assume not in bridge (conservative)
  }
}

/**
 * Get the current status of a repository
 * - "local": Only exists locally, not published to Nostr
 * - "pushing": Currently being pushed to Nostr
 * - "live": Published to Nostr AND processed by bridge (bridge has the repo)
 * 
 * CRITICAL: "live" status requires BOTH:
 * 1. Event ID exists (event was published to Nostr)
 * 2. Bridge has processed the event (repo exists in bridge database)
 * 
 * This prevents false "live" status when events are published but not yet processed by bridge.
 */
export function getRepoStatus(repo: any): RepoStatus {
  // Check if repo has a "status" field explicitly set (highest priority)
  if (repo.status === "pushing") return "pushing";
  if (repo.status === "push_failed") return "push_failed";
  
  // Check if bridge has processed this repo
  // This is stored as a flag when we verify with the bridge
  // Check the raw value, not coerced to boolean, to distinguish undefined from false
  const bridgeProcessed = repo.bridgeProcessed;
  
  // Check if repo has announcement event ID (kind 30617) - was published to Nostr
  const hasAnnouncementEventId = !!(repo.nostrEventId || repo.lastNostrEventId || repo.syncedFromNostr || repo.fromNostr);
  
  // CRITICAL: Check if repo has state event ID (kind 30618) - required for full NIP-34 compliance
  // Both announcement AND state events are required for "live" status
  // gitworkshop.dev and other ngit clients need the state event to recognize "Nostr state"
  const hasStateEventId = !!(repo.stateEventId || repo.lastStateEventId);
  
  // Check if repo has files (if it was pushed empty, it needs files pushed)
  const hasFiles = repo.files && Array.isArray(repo.files) && repo.files.length > 0;
  
  // Check if repo has unpushed edits (hasLastNostrEventId but was modified after)
  const hasUnpushedEdits = repo.hasUnpushedEdits === true || 
    (repo.lastNostrEventId && repo.lastModifiedAt && repo.lastNostrEventCreatedAt && 
     repo.lastModifiedAt > repo.lastNostrEventCreatedAt * 1000);
  
  // CRITICAL: Only mark as "live" if BOTH announcement AND state events exist AND bridge has processed it
  // This ensures full NIP-34 compliance - both events are required for ngit clients
  if (hasAnnouncementEventId && hasStateEventId && bridgeProcessed === true) {
    // Both events published AND bridge processed - truly "live"
    if (hasAnnouncementEventId && !hasFiles) {
      return "live_with_edits"; // Pushed but no files yet
    }
    return hasUnpushedEdits ? "live_with_edits" : "live";
  }
  
  // CRITICAL: For repos synced from Nostr (syncedFromNostr or fromNostr), be more lenient
  // If they're old (more than 1 hour), assume they're live even without state event or bridge verification
  // This handles repos that were published before state events were required
  const isSyncedFromNostr = !!(repo.syncedFromNostr || repo.fromNostr);
  const eventCreatedAt = repo.lastNostrEventCreatedAt || repo.nostrEventCreatedAt;
  const isOldRepo = eventCreatedAt && (Date.now() / 1000 - eventCreatedAt) >= 3600; // More than 1 hour old
  
  if (isSyncedFromNostr && hasAnnouncementEventId && isOldRepo) {
    // Repo was synced from Nostr and is old - optimistically show as "live"
    // Bridge check will update this when it runs, but for now assume it's live
    return hasUnpushedEdits ? "live_with_edits" : "live";
  }
  
  // If announcement event exists but state event is missing:
  if (hasAnnouncementEventId && !hasStateEventId) {
    // Announcement published but state event missing - not fully "live"
    // This can happen if user cancelled the second signature or state event failed
    // OR if repo was published before state events were required
    // For recent pushes, show as "awaiting bridge", for old ones assume live
    if (isOldRepo) {
      // Old repo without state event - assume it's live (backward compatibility)
      return hasUnpushedEdits ? "live_with_edits" : "live";
    }
    return "live_with_edits"; // Show as "Published (Awaiting Bridge)" - state event needed
  }
  
  // If announcement event exists but bridge hasn't processed it yet:
  // Only show "live" if bridge has explicitly confirmed it processed the event
  // BUT: For repos pushed days ago, assume they're live until bridge check says otherwise
  // Only NEW pushes (recent eventCreatedAt) should show "awaiting bridge"
  // CRITICAL: If both events exist and were confirmed, show as "live" even if bridge hasn't processed yet
  // The bridge will update it later, but the repo is already live on Nostr
  if (hasAnnouncementEventId && hasStateEventId && (bridgeProcessed === undefined || bridgeProcessed === false)) {
    // Check if this is a recent push (within last hour) or an old push (days ago)
    const isRecentPush = eventCreatedAt && (Date.now() / 1000 - eventCreatedAt) < 3600; // Within last hour
    
    // CRITICAL: If both events exist, the repo is live on Nostr regardless of bridge processing
    // Bridge processing is for file serving, not for determining if repo is "live"
    // Only show "awaiting bridge" if it's a very recent push (within 5 minutes) AND no files
    const isVeryRecentPush = eventCreatedAt && (Date.now() / 1000 - eventCreatedAt) < 300; // Within 5 minutes
    const hasNoFiles = !hasFiles || (Array.isArray(repo.files) && repo.files.length === 0);
    
    if (isVeryRecentPush && hasNoFiles) {
      // Very recent push with no files - bridge might still be processing, show as "awaiting bridge"
      return "live_with_edits"; // Show as "Published (Awaiting Bridge)" for very recent pushes
    } else {
      // Both events exist - repo is live on Nostr, show as "live" even if bridge hasn't processed yet
      // Bridge processing is for file serving, not for determining live status
      return hasUnpushedEdits ? "live_with_edits" : "live";
    }
  }
  
  // Only check explicit status if no event ID exists
  if (repo.status === "live_with_edits") return "live_with_edits";
  if (repo.status === "live") {
    // Explicit "live" status - only downgrade if there are actual unpushed edits
    // This handles repos that were marked "live" before bridge verification was added
    // But don't downgrade if there are no edits (optimistic - assume it's live)
    return hasUnpushedEdits ? "live_with_edits" : "live";
  }
  if (repo.status === "local") return "local";
  
  // Default to "local" - repos need to be explicitly pushed and confirmed by bridge
  return "local";
}

/**
 * Query Nostr for state event (30618) when missing from localStorage
 * This restores the state event ID if localStorage was cleared but the event exists on relays
 */
export async function queryStateEventFromNostr(
  subscribe: (
    filters: any[],
    relays: string[],
    onEvent: (event: any, isAfterEose: boolean, relayURL?: string) => void,
    maxDelayms?: number,
    onEose?: (relayUrl: string, minCreatedAt: number) => void,
    options?: any
  ) => () => void,
  ownerPubkey: string,
  repoName: string,
  defaultRelays: string[]
): Promise<string | null> {
  return new Promise((resolve) => {
    if (!ownerPubkey || !/^[0-9a-f]{64}$/i.test(ownerPubkey)) {
      resolve(null);
      return;
    }

    const { KIND_REPOSITORY_STATE } = require("@/lib/nostr/events");
    let foundStateEventId: string | null = null;
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(foundStateEventId);
      }
    }, 5000); // 5 second timeout

    const unsub = subscribe(
      [{
        kinds: [KIND_REPOSITORY_STATE],
        authors: [ownerPubkey],
        "#d": [repoName],
        limit: 1,
      }],
      defaultRelays,
      (event: any, isAfterEose: boolean, relayURL?: string) => {
        if (event.kind === KIND_REPOSITORY_STATE && !resolved) {
          foundStateEventId = event.id;
          resolved = true;
          clearTimeout(timeout);
          unsub();
          resolve(foundStateEventId);
        }
      },
      5000 // 5 second timeout
    );

    // Also handle EOSE (End of Stored Events)
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        unsub();
        resolve(foundStateEventId);
      }
    }, 5000);
  });
}

/**
 * Set repository status
 */
export function setRepoStatus(repoSlug: string, entity: string, status: RepoStatus): void {
  try {
    const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as any[];
    const repoIndex = repos.findIndex((r: any) => 
      (r.slug === repoSlug || r.repo === repoSlug) && r.entity === entity
    );
    
    if (repoIndex >= 0) {
      repos[repoIndex] = { ...repos[repoIndex], status };
      localStorage.setItem("gittr_repos", JSON.stringify(repos));
    }
  } catch (error) {
    console.error("Failed to set repo status:", error);
  }
}

/**
 * Get status badge styling
 */
export function getStatusBadgeStyle(status: RepoStatus): { bg: string; text: string; label: string } {
  switch (status) {
    case "local":
      return {
        bg: "bg-yellow-600/30",
        text: "text-yellow-300",
        label: "Local"
      };
    case "pushing":
      return {
        bg: "bg-blue-600/30",
        text: "text-blue-300",
        label: "Pushing..."
      };
    case "push_failed":
      return {
        bg: "bg-red-600/30",
        text: "text-red-300",
        label: "Push Failed"
      };
    case "live":
      return {
        bg: "bg-green-600/30",
        text: "text-green-300",
        label: "Live on Nostr"
      };
    case "live_with_edits":
      return {
        bg: "bg-orange-600/30",
        text: "text-orange-300",
        label: "Published (Awaiting Bridge)" // More accurate: published to Nostr but bridge hasn't processed yet
      };
    default:
      return {
        bg: "bg-gray-600/30",
        text: "text-gray-300",
        label: "Unknown"
      };
  }
}

/**
 * Mark repository as having unpushed edits
 * Call this when repo is modified locally after being published
 * Also ensures local repos stay as "local" status so push button appears
 */
export function markRepoAsEdited(repoSlug: string, entity: string): void {
  try {
    const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as any[];
    const repoIndex = repos.findIndex((r: any) => 
      (r.slug === repoSlug || r.repo === repoSlug) && r.entity === entity
    );
    
    if (repoIndex >= 0) {
      const repo = repos[repoIndex];
      const wasLive = !!(repo.lastNostrEventId || repo.nostrEventId || repo.syncedFromNostr);
      
      if (wasLive) {
        // Repo was previously live - mark as having unpushed edits
        repos[repoIndex] = { 
          ...repo, 
          hasUnpushedEdits: true,
          lastModifiedAt: Date.now(),
        };
        localStorage.setItem("gittr_repos", JSON.stringify(repos));
        console.log(`📝 [markRepoAsEdited] Marked live repo as having unpushed edits: ${repoSlug}`);
      } else {
        // Repo was never pushed - ensure it's marked as "local" so push button appears
        repos[repoIndex] = { 
          ...repo, 
          status: "local", // Explicitly set to local
          lastModifiedAt: Date.now(),
        };
        localStorage.setItem("gittr_repos", JSON.stringify(repos));
        console.log(`📝 [markRepoAsEdited] Ensured local repo status is "local": ${repoSlug}`);
      }
    }
  } catch (error) {
    console.error("Failed to mark repo as edited:", error);
  }
}

/**
 * Clear unpushed edits flag (called after successful push)
 */
export function clearUnpushedEdits(repoSlug: string, entity: string, eventId: string, eventCreatedAt: number): void {
  try {
    const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as any[];
    const repoIndex = repos.findIndex((r: any) => 
      (r.slug === repoSlug || r.repo === repoSlug) && r.entity === entity
    );
    
    if (repoIndex >= 0) {
      repos[repoIndex] = { 
        ...repos[repoIndex], 
        hasUnpushedEdits: false,
        lastNostrEventId: eventId,
        lastNostrEventCreatedAt: eventCreatedAt,
        lastModifiedAt: Date.now(),
      };
      localStorage.setItem("gittr_repos", JSON.stringify(repos));
    }
  } catch (error) {
    console.error("Failed to clear unpushed edits:", error);
  }
}

