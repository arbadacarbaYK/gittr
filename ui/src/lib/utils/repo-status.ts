/**
 * Repository Status Management
 * Tracks whether repos are local-only, being pushed, or live on Nostr.
 *
 * Status meanings (user-facing):
 * - local: not published yet
 * - pushing / push_failed: in-flight publish
 * - live_soon: announced on Nostr; clone/files finishing (“Published, live soon”)
 * - live: fully live (“Live on Nostr”)
 * - live_with_edits: was live, has local changes not pushed yet
 */

export type RepoStatus =
  | "local"
  | "pushing"
  | "live"
  | "live_soon"
  | "live_with_edits"
  | "push_failed";

/** True when the repo is already on Nostr (including transitional / edits). */
export function isPublishedRepoStatus(status: RepoStatus): boolean {
  return (
    status === "live" || status === "live_soon" || status === "live_with_edits"
  );
}

/** True when the UI should still offer Push (incomplete publish or local edits). */
export function statusNeedsPushAction(status: RepoStatus): boolean {
  return (
    status === "local" ||
    status === "live_soon" ||
    status === "live_with_edits" ||
    status === "push_failed"
  );
}

/**
 * Check if repository exists in bridge database (async)
 * This is the source of truth for clone/file serving readiness.
 * Updates the repo in localStorage with bridgeProcessed flag.
 */
export async function checkBridgeExists(
  ownerPubkey: string,
  repoName: string,
  entity: string
): Promise<boolean> {
  try {
    if (!ownerPubkey || !/^[0-9a-f]{64}$/i.test(ownerPubkey)) {
      return false;
    }

    const response = await fetch(
      `/api/nostr/repo/exists?ownerPubkey=${encodeURIComponent(
        ownerPubkey
      )}&repo=${encodeURIComponent(repoName)}`
    );

    if (response.ok) {
      const data = await response.json();
      const exists = data.exists === true;
      try {
        const repos = JSON.parse(
          localStorage.getItem("gittr_repos") || "[]"
        ) as any[];
        const repoIndex = repos.findIndex((r: any) => {
          const rRepoName = r.repositoryName || r.repo || r.slug;
          return (
            (rRepoName === repoName ||
              r.slug === repoName ||
              r.repo === repoName) &&
            r.entity === entity
          );
        });

        if (repoIndex >= 0) {
          repos[repoIndex] = {
            ...repos[repoIndex],
            bridgeProcessed: exists,
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
    return false;
  }
}

/**
 * Get the current status of a repository.
 *
 * live = announcement on Nostr and past the short post-publish window
 *        (or bridge-confirmed). Matches what discovery/gitworkshop already show.
 * live_soon = just published; clone/bridge may still be catching up (~5 min).
 * live_with_edits = was live, local changes not pushed.
 */
export function getRepoStatus(repo: any): RepoStatus {
  if (repo.status === "pushing") return "pushing";
  if (repo.status === "push_failed") return "push_failed";

  const bridgeProcessed = repo.bridgeProcessed;

  const hasAnnouncementEventId = !!(
    repo.nostrEventId ||
    repo.lastNostrEventId ||
    repo.syncedFromNostr ||
    repo.fromNostr
  );

  const hasStateEventId = !!(repo.stateEventId || repo.lastStateEventId);

  const hasUnpushedEdits =
    repo.hasUnpushedEdits === true ||
    (repo.lastNostrEventId &&
      repo.lastModifiedAt &&
      repo.lastNostrEventCreatedAt &&
      repo.lastModifiedAt > repo.lastNostrEventCreatedAt * 1000);

  const isSyncedFromNostr = !!(repo.syncedFromNostr || repo.fromNostr);
  const eventCreatedAt =
    repo.lastNostrEventCreatedAt || repo.nostrEventCreatedAt || 0;
  const ageSec =
    eventCreatedAt > 0
      ? Date.now() / 1000 - eventCreatedAt
      : Number.POSITIVE_INFINITY;
  /** Short window after Push where bridge/clone may still be settling. */
  const isVeryRecentPush = ageSec < 300;
  /** Missing local flags but announce is old enough to treat as settled. */
  const isSettledAnnounce = ageSec >= 600;

  // Fully ready: both NIP-34 events + bridge has the bare repo
  if (hasAnnouncementEventId && hasStateEventId && bridgeProcessed === true) {
    return hasUnpushedEdits ? "live_with_edits" : "live";
  }

  // Discovery stubs / legacy: synced from network with no local timestamps → live
  if (isSyncedFromNostr && hasAnnouncementEventId && !eventCreatedAt) {
    return hasUnpushedEdits ? "live_with_edits" : "live";
  }

  // Synced long enough that transitional UI is misleading
  if (isSyncedFromNostr && hasAnnouncementEventId && isSettledAnnounce) {
    return hasUnpushedEdits ? "live_with_edits" : "live";
  }

  // Announcement published but state event missing (second sign cancelled, etc.)
  if (hasAnnouncementEventId && !hasStateEventId) {
    if (isSettledAnnounce) {
      return hasUnpushedEdits ? "live_with_edits" : "live";
    }
    return "live_soon";
  }

  // Both events on Nostr; bridge flag may still be catching up locally.
  // Do NOT require local `files[]` — My Repositories often has no file cache,
  // which previously stuck repos on "Published, live soon" forever.
  if (
    hasAnnouncementEventId &&
    hasStateEventId &&
    (bridgeProcessed === undefined || bridgeProcessed === false)
  ) {
    if (hasUnpushedEdits && !isVeryRecentPush) {
      return "live_with_edits";
    }
    if (isVeryRecentPush) {
      return "live_soon";
    }
    return "live";
  }

  if (repo.status === "live_soon") {
    // Stale persisted status after a successful push — promote once past the window
    if (!isVeryRecentPush && hasAnnouncementEventId) {
      return hasUnpushedEdits ? "live_with_edits" : "live";
    }
    return "live_soon";
  }
  if (repo.status === "live_with_edits") return "live_with_edits";
  if (repo.status === "live") {
    return hasUnpushedEdits ? "live_with_edits" : "live";
  }
  if (repo.status === "local") return "local";

  return "local";
}

/**
 * Query Nostr for state event (30618) when missing from localStorage
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
    }, 5000);

    const unsub = subscribe(
      [
        {
          kinds: [KIND_REPOSITORY_STATE],
          authors: [ownerPubkey],
          "#d": [repoName],
          limit: 1,
        },
      ],
      defaultRelays,
      (event: any) => {
        if (event.kind === KIND_REPOSITORY_STATE && !resolved) {
          foundStateEventId = event.id;
          resolved = true;
          clearTimeout(timeout);
          unsub();
          resolve(foundStateEventId);
        }
      },
      5000
    );

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

export function setRepoStatus(
  repoSlug: string,
  entity: string,
  status: RepoStatus
): void {
  try {
    const repos = JSON.parse(
      localStorage.getItem("gittr_repos") || "[]"
    ) as any[];
    const repoIndex = repos.findIndex(
      (r: any) =>
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

export function getStatusBadgeStyle(status: RepoStatus): {
  bg: string;
  text: string;
  label: string;
} {
  switch (status) {
    case "local":
      return {
        bg: "bg-yellow-600/30",
        text: "text-yellow-300",
        label: "Local",
      };
    case "pushing":
      return {
        bg: "bg-blue-600/30",
        text: "text-blue-300",
        label: "Pushing...",
      };
    case "push_failed":
      return {
        bg: "bg-red-600/30",
        text: "text-red-300",
        label: "Push Failed",
      };
    case "live":
      return {
        bg: "bg-green-600/30",
        text: "text-green-300",
        label: "Live on Nostr",
      };
    case "live_soon":
      return {
        bg: "bg-orange-600/30",
        text: "text-orange-300",
        label: "Published, live soon",
      };
    case "live_with_edits":
      return {
        bg: "bg-amber-600/30",
        text: "text-amber-300",
        label: "Has unpublished edits",
      };
    default:
      return {
        bg: "bg-gray-600/30",
        text: "text-gray-300",
        label: "Unknown",
      };
  }
}

export function markRepoAsEdited(repoSlug: string, entity: string): void {
  try {
    const repos = JSON.parse(
      localStorage.getItem("gittr_repos") || "[]"
    ) as any[];
    const repoIndex = repos.findIndex(
      (r: any) =>
        (r.slug === repoSlug || r.repo === repoSlug) && r.entity === entity
    );

    if (repoIndex >= 0) {
      const repo = repos[repoIndex];
      const wasLive = !!(
        repo.lastNostrEventId ||
        repo.nostrEventId ||
        repo.syncedFromNostr
      );

      if (wasLive) {
        repos[repoIndex] = {
          ...repo,
          hasUnpushedEdits: true,
          lastModifiedAt: Date.now(),
        };
        localStorage.setItem("gittr_repos", JSON.stringify(repos));
      } else {
        repos[repoIndex] = {
          ...repo,
          status: "local",
          lastModifiedAt: Date.now(),
        };
        localStorage.setItem("gittr_repos", JSON.stringify(repos));
      }
    }
  } catch (error) {
    console.error("Failed to mark repo as edited:", error);
  }
}

export function clearUnpushedEdits(
  repoSlug: string,
  entity: string,
  eventId: string,
  eventCreatedAt: number
): void {
  try {
    const repos = JSON.parse(
      localStorage.getItem("gittr_repos") || "[]"
    ) as any[];
    const repoIndex = repos.findIndex(
      (r: any) =>
        (r.slug === repoSlug || r.repo === repoSlug) && r.entity === entity
    );

    if (repoIndex >= 0) {
      repos[repoIndex] = {
        ...repos[repoIndex],
        hasUnpushedEdits: false,
        lastNostrEventId: eventId,
        lastNostrEventCreatedAt: eventCreatedAt,
        // Transitional until bridgeProcessed flips true via checkBridgeExists
        status: "live_soon",
        lastModifiedAt: Date.now(),
      };
      localStorage.setItem("gittr_repos", JSON.stringify(repos));
    }
  } catch (error) {
    console.error("Failed to clear unpushed edits:", error);
  }
}
