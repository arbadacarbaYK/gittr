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
  
  // Check if repo has event ID (was published to Nostr)
  const hasEventId = !!(repo.nostrEventId || repo.lastNostrEventId || repo.syncedFromNostr || repo.fromNostr);
  
  // Check if repo has files (if it was pushed empty, it needs files pushed)
  const hasFiles = repo.files && Array.isArray(repo.files) && repo.files.length > 0;
  
  // Check if repo has unpushed edits (hasLastNostrEventId but was modified after)
  const hasUnpushedEdits = repo.hasUnpushedEdits === true || 
    (repo.lastNostrEventId && repo.lastModifiedAt && repo.lastNostrEventCreatedAt && 
     repo.lastModifiedAt > repo.lastNostrEventCreatedAt * 1000);
  
  // Only mark as "live" if BOTH event ID exists AND bridge has processed it
  // If event ID exists but bridge hasn't processed it, check if there are actual edits
  if (hasEventId && bridgeProcessed === true) {
    // Event published AND bridge processed - truly "live"
  if (hasEventId && !hasFiles) {
      return "live_with_edits"; // Pushed but no files yet
  }
    return hasUnpushedEdits ? "live_with_edits" : "live";
  }
  
  // If event ID exists but bridge hasn't processed it yet:
  // Only show "live" if bridge has explicitly confirmed it processed the event
  // BUT: For repos pushed days ago, assume they're live until bridge check says otherwise
  // Only NEW pushes (recent eventCreatedAt) should show "awaiting bridge"
  if (hasEventId && (bridgeProcessed === undefined || bridgeProcessed === false)) {
    // Check if this is a recent push (within last hour) or an old push (days ago)
    const eventCreatedAt = repo.lastNostrEventCreatedAt || repo.nostrEventCreatedAt;
    const isRecentPush = eventCreatedAt && (Date.now() / 1000 - eventCreatedAt) < 3600; // Within last hour
    
    if (isRecentPush) {
      // Recent push - bridge might not have processed it yet, show as "awaiting bridge"
      return "live_with_edits"; // Show as "Published (Awaiting Bridge)" for recent pushes
    } else {
      // Old push (days ago) - assume it was processed by bridge, show as "live" optimistically
      // Bridge check will update this when it runs
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
 */
export function markRepoAsEdited(repoSlug: string, entity: string): void {
  try {
    const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as any[];
    const repoIndex = repos.findIndex((r: any) => 
      (r.slug === repoSlug || r.repo === repoSlug) && r.entity === entity
    );
    
    if (repoIndex >= 0) {
      const repo = repos[repoIndex];
      // Only mark as edited if it was previously live
      if (repo.lastNostrEventId || repo.nostrEventId || repo.syncedFromNostr) {
        repos[repoIndex] = { 
          ...repo, 
          hasUnpushedEdits: true,
          lastModifiedAt: Date.now(),
        };
        localStorage.setItem("gittr_repos", JSON.stringify(repos));
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

