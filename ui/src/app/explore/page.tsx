"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { LoadMoreButton } from "@/components/ui/load-more-button";
import {
  isPublisherBlocklisted,
  isRepoFromBlocklistedOwner,
} from "@/lib/moderation/publisher-blocklist";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import {
  shouldHideAnnounceForUnusableClones,
  usableCloneUrls,
} from "@/lib/nostr/clone-url-quality";
import { KIND_REPOSITORY, KIND_REPOSITORY_NIP34 } from "@/lib/nostr/events";
import {
  exploreDeferredSocialRelays,
  exploreImmediateDiscoveryRelays,
  exploreRepoRelaysForClient,
  rememberExploreDiscoveryRelay,
} from "@/lib/nostr/explore-discovery-relays";
import {
  EXPLORE_SEED_CACHE_CAP,
  EXPLORE_SEED_FETCH_LIMIT,
  mergeExploreSeedIntoCatalog,
  shouldFetchExploreSeed,
} from "@/lib/nostr/explore-seed-catalog";
import {
  hydrateExploreSessionCatalog,
  peekExploreSessionCatalog,
  writeExploreSessionCatalog,
} from "@/lib/nostr/explore-session-catalog";
import { shouldHideExploreSyncForCatalog } from "@/lib/nostr/explore-sync-indicator";
import { getAllRelays } from "@/lib/nostr/getAllRelays";
import {
  nostrTimestampToMs,
  nostrTimestampToSeconds,
} from "@/lib/nostr/nostr-created-at";
import { parseRepoLinksFromNip34Tags } from "@/lib/nostr/parse-nip34-repo-links";
import { applyDeletionMarkersToRepoData } from "@/lib/nostr/repo-deleted";
import {
  type Metadata,
  useContributorMetadata,
} from "@/lib/nostr/useContributorMetadata";
import { hasPrivateRepoAccess } from "@/lib/repo-permissions";
import { clearDeletedRepoTombstones } from "@/lib/repos/deleted-repo-tombstones";
import { isRenderableRepoName } from "@/lib/repos/renderable-repo-name";
import { repoCardDescriptionText } from "@/lib/repos/repo-about-text";
import { loadStoredRepos, saveStoredRepos } from "@/lib/repos/storage";
import { REPO_LIST_PAGE_SIZE } from "@/lib/ui/list-pagination";
import { coalesceMetadataList } from "@/lib/utils/coalesce-metadata-list";
import {
  getEntityDisplayName,
  getRepoOwnerPubkey,
} from "@/lib/utils/entity-resolver";
import { getGraspServers } from "@/lib/utils/grasp-servers";
import { nip34TagValuesFromRow } from "@/lib/utils/nip34-tag-values";
import { normalizeGithubSourceUrl } from "@/lib/utils/normalize-github-source-url";
import { isRepoCorrupted } from "@/lib/utils/repo-corruption-check";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { OnEvent } from "nostr-relaypool";
import { nip19 } from "nostr-tools";

/** Per-event Explore logs freeze the tab; opt in with localStorage gittr_explore_debug=1 */
function exploreDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("gittr_explore_debug") === "1";
  } catch {
    return false;
  }
}

function exploreDebug(...args: unknown[]) {
  if (!exploreDebugEnabled()) return;
  console.log(...args);
}

export const dynamic = "force-dynamic";

// Parse NIP-34 repository announcement format
// NIP-34 uses tags for metadata, content is empty
function parseNIP34Repository(event: any): any {
  const repoData: any = {
    repositoryName: "",
    description: "",
    clone: [],
    relays: [],
    topics: [],
    maintainers: [],
    web: [],
  };

  if (!event.tags || !Array.isArray(event.tags)) {
    return repoData;
  }

  for (const tag of event.tags) {
    if (!Array.isArray(tag) || tag.length < 2) continue;

    const tagName = tag[0];
    const tagValue = tag[1];

    switch (tagName) {
      case "d":
        // Repo ID (usually kebab-case short name)
        repoData.repositoryName = tagValue;
        break;
      case "name":
        // Human-readable project name
        repoData.name = tagValue;
        break;
      case "description":
        // Brief description
        repoData.description = tagValue;
        break;
      case "clone":
        for (const v of nip34TagValuesFromRow(tag)) {
          if (v && !repoData.clone.includes(v)) repoData.clone.push(v);
        }
        break;
      case "relays": {
        const rawVals = nip34TagValuesFromRow(tag);
        for (const raw of rawVals) {
          const parts = raw.includes(",")
            ? raw
                .split(",")
                .map((r: string) => r.trim())
                .filter((r: string) => r.length > 0)
            : [raw];
          for (const tagValue of parts) {
            const normalized =
              tagValue.startsWith("wss://") || tagValue.startsWith("ws://")
                ? tagValue
                : `wss://${tagValue}`;
            if (!repoData.relays.includes(normalized)) {
              repoData.relays.push(normalized);
            }
          }
        }
        break;
      }
      case "web":
        for (const v of nip34TagValuesFromRow(tag)) {
          if (v && !repoData.web.includes(v)) repoData.web.push(v);
        }
        break;
      case "t":
        // Hashtags/topics (can have multiple)
        if (tagValue) repoData.topics.push(tagValue);
        break;
      case "maintainers":
        // NIP-34: Accept both hex and npub formats, normalize to hex for internal storage
        for (const tagValue of nip34TagValuesFromRow(tag)) {
          if (!tagValue) continue;
          let normalizedPubkey = tagValue;
          try {
            if (tagValue.startsWith("npub")) {
              const decoded = nip19.decode(tagValue);
              if (
                decoded.type === "npub" &&
                /^[0-9a-f]{64}$/i.test(decoded.data as string)
              ) {
                normalizedPubkey = decoded.data as string;
              }
            } else if (/^[0-9a-f]{64}$/i.test(tagValue)) {
              normalizedPubkey = tagValue.toLowerCase();
            }
            if (/^[0-9a-f]{64}$/i.test(normalizedPubkey)) {
              repoData.maintainers.push(normalizedPubkey);
            }
          } catch (e) {
            if (/^[0-9a-f]{64}$/i.test(tagValue)) {
              repoData.maintainers.push(tagValue.toLowerCase());
            }
          }
        }
        break;
      case "r":
        // Earliest unique commit ID
        if (tagValue && tag[2] === "euc") {
          repoData.earliestUniqueCommit = tagValue;
        }
        break;
      case "public-read":
        // gittr extension on 30617 (not core NIP-34)
        if (tagValue) {
          repoData.publicRead = tagValue.toLowerCase() !== "false";
        }
        break;
      case "public-write":
        if (tagValue) {
          repoData.publicWrite = tagValue.toLowerCase() === "true";
        }
        break;
    }
  }

  // gittr sidebar links: ["link", type, url, label?] (+ web fallback)
  const links = parseRepoLinksFromNip34Tags(event.tags);
  if (links.length > 0) repoData.links = links;

  // Use name as repositoryName if d tag wasn't found
  if (!repoData.repositoryName && repoData.name) {
    repoData.repositoryName = repoData.name;
  }

  // Missing privacy tags => public read (legacy announcements)
  if (repoData.publicRead === undefined) {
    repoData.publicRead = true;
  }
  if (repoData.publicWrite === undefined) {
    repoData.publicWrite = false;
  }

  // gittr soft-delete: content JSON and/or deleted/archived tags (not core NIP-34)
  applyDeletionMarkersToRepoData(repoData, event);

  return repoData;
}

type Repo = {
  slug: string;
  entity?: string;
  repo?: string;
  name: string;
  description?: string;
  sourceUrl?: string;
  forkedFrom?: string;
  readme?: string;
  stars?: number;
  forks?: number;
  languages?: Record<string, number>;
  topics?: string[];
  branches?: Array<{ name: string; commit?: string }>;
  releases?: Array<{
    tag: string;
    name: string;
    description?: string;
    createdAt?: number;
  }>;
  createdAt: number;
  updatedAt?: number; // Track when repo was last updated from Nostr
  entityDisplayName?: string;
  logoUrl?: string;
  files?: Array<{ type: string; path: string; size?: number }>;
  defaultBranch?: string;
  ownerPubkey?: string; // Explicit owner pubkey for imported repos
  contributors?: Array<{
    pubkey?: string;
    name?: string;
    picture?: string;
    weight: number;
    githubLogin?: string;
  }>;
  deleted?: boolean;
  archived?: boolean;
  links?: Array<{
    type:
      | "docs"
      | "discord"
      | "slack"
      | "youtube"
      | "twitter"
      | "github"
      | "other";
    url: string;
    label?: string;
  }>;
  // GRASP-01: Clone and relays tags
  clone?: string[];
  relays?: string[];
  // Status tracking
  status?:
    | "local"
    | "pushing"
    | "live"
    | "live_soon"
    | "live_with_edits"
    | "push_failed";
  hasUnpushedEdits?: boolean;
  lastModifiedAt?: number;
  nostrEventId?: string;
  lastNostrEventId?: string;
  lastNostrEventCreatedAt?: number;
  syncedFromNostr?: boolean;
  fromNostr?: boolean;
  // Privacy
  publicRead?: boolean;
  publicWrite?: boolean;
};

function ExplorePageContent() {
  const sessionStart = peekExploreSessionCatalog() as Repo[] | null;
  const [repos, setRepos] = useState<Repo[]>(() => sessionStart || []);
  const [isLoadingRepos, setIsLoadingRepos] = useState(
    !(sessionStart && sessionStart.length > 0)
  );
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [visibleRepoCount, setVisibleRepoCount] = useState(REPO_LIST_PAGE_SIZE);
  const searchParams = useSearchParams();
  const qRaw = searchParams?.get("q") || "";
  const q = qRaw.toLowerCase();
  const userFilter = searchParams?.get("user") || null;
  const openRepoInNewTab = !!(qRaw.trim() || userFilter);
  const { defaultRelays, subscribe, pubkey, addRelay } = useNostrContext();
  // Session catalog: grows with every Nostr event even when localStorage quota
  // blocks persist. Never reset this from a failed save + loadRepos() loop.
  // Module-level peek survives leaving /explore (the page used to remount empty).
  const exploreCatalogRef = useRef<Repo[] | null>(sessionStart);
  const catalogPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const catalogUiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset page window when search/filter changes (keep scroll stable on Load more).
  useEffect(() => {
    setVisibleRepoCount(REPO_LIST_PAGE_SIZE);
  }, [q, userFilter]);

  // DEBUG: Log context values
  useEffect(() => {
    exploreDebug("🔍 [Explore] Context values:", {
      hasSubscribe: !!subscribe,
      hasDefaultRelays: !!defaultRelays,
      defaultRelaysLength: defaultRelays?.length || 0,
      defaultRelays: defaultRelays,
      pubkey: pubkey ? pubkey.slice(0, 8) : "none",
    });
  }, [subscribe, defaultRelays, pubkey]);

  // Get owner metadata for RENDERED repos only (batched, progressive loading)
  // CRITICAL: Only fetch metadata for repos that are actually rendered (first batch)
  // Fetch more metadata progressively as repos appear, not all upfront
  // This matches homepage pattern: only fetch for `recent` repos (12 repos)
  // INCREASED: Fetch metadata for first 100 repos to ensure more icons show up when logged out
  // The cache will be checked first, so this only fetches missing metadata from Nostr
  const [metadataBatchSize] = useState(400); // Fetch metadata for visible explore owners (HTTP batch API)

  const ownerPubkeys = useMemo(() => {
    exploreDebug(
      `🔍 [Explore] Computing ownerPubkeys: repos.length=${repos.length}`
    );
    // Only fetch metadata if we have repos (like homepage - no loading state check)
    if (repos.length === 0) {
      exploreDebug(`⏭️ [Explore] No repos, returning empty pubkeys array`);
      return [];
    }

    // Get filtered repos (same logic as filteredRepos but we need it here for metadata)
    const reposWithEntity = repos.map((r) => {
      if (!r.entity || r.entity === "user") {
        if (r.ownerPubkey && /^[0-9a-f]{64}$/i.test(r.ownerPubkey)) {
          const derivedEntity = nip19.npubEncode(r.ownerPubkey);
          return {
            ...r,
            entity: derivedEntity,
            entityDisplayName: r.entityDisplayName || derivedEntity,
          };
        }
      }
      return r;
    });

    const sortedRepos = reposWithEntity
      .slice()
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    // Apply same filters as filteredRepos
    // CRITICAL: Don't mutate repo objects - create new objects if needed
    const filtered = sortedRepos.filter((r) => {
      if (!r.entity || r.entity === "user") {
        if (r.ownerPubkey && /^[0-9a-f]{64}$/i.test(r.ownerPubkey)) {
          // Don't mutate - just check if it would be valid
          // Entity is valid, continue filtering
        } else {
          return false;
        }
      }

      const repoName = (r.repo || r.slug || r.name || "").toLowerCase();
      const isTestRepo =
        repoName.startsWith("test") ||
        repoName.includes("test-") ||
        repoName === "test";
      const isProfileRepo =
        repoName === "profile" ||
        repoName === "profile-page" ||
        repoName.includes("profile-");
      if (isTestRepo || isProfileRepo) return false;

      if (userFilter) {
        const entity = r.entity || "";
        const entityDisplayName = r.entityDisplayName || "";
        const matches =
          entity.toLowerCase().includes(userFilter.toLowerCase()) ||
          entityDisplayName.toLowerCase().includes(userFilter.toLowerCase()) ||
          (userFilter.length >= 4 &&
            entity.toLowerCase().startsWith(userFilter.toLowerCase()));
        if (!matches) return false;
      }

      if (q) {
        const entity = r.entity || "";
        const repo = r.repo || r.slug || "";
        const name = r.name || repo;
        const description = (r.description || "").toLowerCase();
        const topics = (Array.isArray(r.topics) ? r.topics : [])
          .map((t: string) => String(t || "").toLowerCase())
          .join(" ");
        const entityDisplayName = (r.entityDisplayName || "").toLowerCase();

        // Search in: repo name, description, topics, entity/repo path, and owner display name
        // Note: ownerMetadata not available here yet, but entityDisplayName should work for most cases
        const matches =
          `${entity}/${repo}`.toLowerCase().includes(q) ||
          name.toLowerCase().includes(q) ||
          description.includes(q) ||
          topics.includes(q) ||
          entityDisplayName.includes(q);
        if (!matches) return false;
      }

      return true;
    });

    // CRITICAL: Only fetch metadata for first batch of rendered repos (like homepage)
    // This prevents overwhelming relays and ensures metadata loads progressively
    const reposForMetadata = filtered.slice(0, metadataBatchSize);

    const pubkeys = new Set<string>();

    // CRITICAL: Ensure we use FULL 64-char pubkeys, never shortened ones
    for (const repo of reposForMetadata) {
      if (!repo.entity || repo.entity === "user") continue;

      const fullPubkey = getRepoOwnerPubkey(repo as any, repo.entity);
      // CRITICAL: Validate it's a full 64-char hex pubkey (not shortened, not npub)
      if (fullPubkey && /^[0-9a-f]{64}$/i.test(fullPubkey)) {
        pubkeys.add(fullPubkey);
      } else {
        exploreDebug("⚠️ [Explore] Skipping invalid pubkey:", {
          repo: repo.slug || repo.repo,
          entity: repo.entity,
          ownerPubkey: repo.ownerPubkey
            ? repo.ownerPubkey.slice(0, 16)
            : "MISSING",
          resolvedPubkey: fullPubkey ? fullPubkey.slice(0, 16) : "NULL",
          isValid: fullPubkey ? /^[0-9a-f]{64}$/i.test(fullPubkey) : false,
        });
      }
    }

    const pubkeyArray = Array.from(pubkeys);
    exploreDebug("🔑 [Explore] Owner pubkeys for metadata (BATCHED):", {
      totalRepos: repos.length,
      filteredRepos: filtered.length,
      reposForMetadata: reposForMetadata.length,
      pubkeysFound: pubkeyArray.length,
      batchSize: metadataBatchSize,
      samplePubkeys: pubkeyArray.slice(0, 3).map((p) => ({
        short: p.slice(0, 8),
        full: p.slice(0, 16) + "...",
        length: p.length,
        isValid: /^[0-9a-f]{64}$/i.test(p),
      })),
      ALL_PUBKEYS: pubkeyArray.map((p) => p.slice(0, 16) + "..."),
      RETURNING_ARRAY_LENGTH: pubkeyArray.length,
    });

    exploreDebug(
      `✅ [Explore] ownerPubkeys computed: returning ${pubkeyArray.length} pubkeys`
    );
    return pubkeyArray;
  }, [repos, q, userFilter, metadataBatchSize]);

  // Debug: Log when ownerPubkeys changes
  useEffect(() => {
    exploreDebug(
      `🔄 [Explore] ownerPubkeys changed: length=${ownerPubkeys.length}`,
      {
        pubkeys: ownerPubkeys.slice(0, 3).map((p) => p.slice(0, 8)),
        joinValue: ownerPubkeys.join(",").slice(0, 50),
      }
    );

    if (typeof window !== "undefined") {
      (window as any).__gittrExploreState = {
        ...(window as any).__gittrExploreState,
        ownerPubkeys,
      };
    }
  }, [ownerPubkeys]);

  // CRITICAL: useContributorMetadata hook handles all metadata fetching
  // No need for manual subscription - the hook does it automatically
  const ownerMetadata = useContributorMetadata(ownerPubkeys);

  // REMOVED: Old manual metadata subscription code - useContributorMetadata hook handles it now
  // The hook automatically:
  // - Loads from localStorage cache
  // - Subscribes to Nostr relays for missing metadata
  // - Updates state when metadata arrives
  // - Handles caching and deduplication

  // Debug: Log metadata state
  useEffect(() => {
    const metadataCount = Object.keys(ownerMetadata).length;
    exploreDebug("📊 [Explore] Metadata state:", {
      ownerPubkeysCount: ownerPubkeys.length,
      metadataKeysCount: metadataCount,
      metadataKeys: Object.keys(ownerMetadata)
        .slice(0, 3)
        .map((k) => k.slice(0, 8)),
      sampleMetadata: Object.keys(ownerMetadata)
        .slice(0, 2)
        .map((k) => ({
          pubkey: k.slice(0, 8),
          hasPicture: !!ownerMetadata[k]?.picture,
          picture: ownerMetadata[k]?.picture?.slice(0, 50) || "none",
        })),
    });
    if (ownerPubkeys.length > 0 && metadataCount === 0) {
      exploreDebug(
        "⚠️ [Explore] METADATA NOT LOADING! Have",
        ownerPubkeys.length,
        "pubkeys but 0 metadata entries"
      );
    }

    if (typeof window !== "undefined") {
      (window as any).__gittrExploreState = {
        ...(window as any).__gittrExploreState,
        ownerMetadata,
        metadataKeysCount: metadataCount,
      };
    }
  }, [ownerPubkeys.length, ownerMetadata]);

  // Track when metadata is loading
  useEffect(() => {
    if (ownerPubkeys.length === 0) {
      setIsLoadingMetadata(false);
      return;
    }
    if (Object.keys(ownerMetadata).length > 0) {
      setIsLoadingMetadata(false);
    }
  }, [ownerPubkeys.length, ownerMetadata]);

  // Function to resolve repo icon with priority:
  // 1. Stored logoUrl (user-set in repo settings)
  // 2. Logo file from repo (if files list has logo.*)
  // 3. Owner Nostr profile picture (last fallback)
  // (GitHub owner avatar removed - should use Nostr profile picture for imported repos)
  // CRITICAL: Use ref to access metadata without causing re-renders that block clicks
  const resolveRepoIcon = (repo: Repo): string | null => {
    // Priority 1: Stored logoUrl
    if (repo.logoUrl && repo.logoUrl.trim().length > 0) {
      return repo.logoUrl;
    }

    // Priority 2: Logo/repo image file from repo (search all directories, handle multiple formats/names)
    if (repo.files && repo.files.length > 0) {
      const repoName = (repo.repo || repo.slug || repo.name || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"];

      // Find all potential icon files:
      // 1. Files with "logo" in name (highest priority)
      // 2. Files named after the repo (e.g., "tides.png" for tides repo)
      // 3. Common icon names in root (repo.png, icon.png, etc.)
      const iconFiles = repo.files
        .map((f) => f.path)
        .filter((p) => {
          const fileName = p.split("/").pop() || "";
          const baseName = fileName.replace(/\.[^.]+$/, "").toLowerCase();
          const extension = fileName.split(".").pop()?.toLowerCase() || "";
          const isRoot = p.split("/").length === 1;

          if (!imageExts.includes(extension)) return false;

          // Match logo files, but exclude third-party logos (alby, etc.)
          if (
            baseName.includes("logo") &&
            !baseName.includes("logo-alby") &&
            !baseName.includes("alby-logo")
          )
            return true;

          // Match repo-name-based files (e.g., "tides.png" for tides repo)
          if (repoName && baseName === repoName) return true;

          // Match common icon names in root directory
          if (
            isRoot &&
            (baseName === "repo" ||
              baseName === "icon" ||
              baseName === "favicon")
          )
            return true;

          return false;
        });

      const logoFiles = iconFiles;

      if (logoFiles.length > 0) {
        // Prioritize logo files
        const prioritized = logoFiles.sort((a, b) => {
          const aParts = a.split("/");
          const bParts = b.split("/");
          const aName =
            aParts[aParts.length - 1]?.replace(/\.[^.]+$/, "").toLowerCase() ||
            "";
          const bName =
            bParts[bParts.length - 1]?.replace(/\.[^.]+$/, "").toLowerCase() ||
            "";
          const aIsRoot = aParts.length === 1;
          const bIsRoot = bParts.length === 1;

          // Priority 1: Exact "logo" match
          if (aName === "logo" && bName !== "logo") return -1;
          if (bName === "logo" && aName !== "logo") return 1;

          // Priority 2: Repo-name-based files (e.g., "tides.png")
          if (
            repoName &&
            aName === repoName &&
            bName !== repoName &&
            bName !== "logo"
          )
            return -1;
          if (
            repoName &&
            bName === repoName &&
            aName !== repoName &&
            aName !== "logo"
          )
            return 1;

          // Priority 3: Root directory files
          if (aName === "logo" && bName === "logo") {
            if (aIsRoot && !bIsRoot) return -1;
            if (!aIsRoot && bIsRoot) return 1;
          }
          if (aIsRoot && !bIsRoot) return -1;
          if (!aIsRoot && bIsRoot) return 1;

          // Priority 4: Format preference
          const aExt = a.split(".").pop()?.toLowerCase() || "";
          const bExt = b.split(".").pop()?.toLowerCase() || "";
          const formatPriority = {
            png: 0,
            svg: 1,
            webp: 2,
            jpg: 3,
            jpeg: 3,
            gif: 4,
            ico: 5,
          };
          const aPrio =
            formatPriority[aExt as keyof typeof formatPriority] ?? 10;
          const bPrio =
            formatPriority[bExt as keyof typeof formatPriority] ?? 10;

          return aPrio - bPrio;
        });

        const logoPath = prioritized[0];

        // Helper function to extract owner/repo from various URL formats
        const extractOwnerRepo = (
          urlString: string
        ): { owner: string; repo: string; hostname: string } | null => {
          try {
            // Handle SSH format: git@github.com:owner/repo.git
            if (urlString.includes("@") && urlString.includes(":")) {
              const match = urlString.match(
                /(?:git@|https?:\/\/)([^\/:]+)[\/:]([^\/]+)\/([^\/]+?)(?:\.git)?$/
              );
              if (match && match[1] && match[2] && match[3]) {
                const hostname = match[1]!;
                const owner = match[2]!;
                const repo = match[3]!.replace(/\.git$/, "");
                return { owner, repo, hostname };
              }
            }

            // Handle HTTPS/HTTP URLs
            const url = new URL(urlString);
            const parts = url.pathname.split("/").filter(Boolean);
            if (parts.length >= 2 && parts[0] && parts[1]) {
              return {
                owner: parts[0],
                repo: parts[1].replace(/\.git$/, ""),
                hostname: url.hostname,
              };
            }
          } catch (e) {
            // Invalid URL format
          }
          return null;
        };

        // Try sourceUrl first
        const gitUrl: string | undefined = repo.sourceUrl;
        let ownerRepo: {
          owner: string;
          repo: string;
          hostname: string;
        } | null = null;

        if (gitUrl) {
          ownerRepo = extractOwnerRepo(gitUrl);
        }

        // If sourceUrl didn't work, try clone array
        if (
          !ownerRepo &&
          (repo as any).clone &&
          Array.isArray((repo as any).clone) &&
          (repo as any).clone.length > 0
        ) {
          // Find first GitHub/GitLab/Codeberg URL in clone array
          const gitCloneUrl = (repo as any).clone.find(
            (url: string) =>
              url &&
              (url.includes("github.com") ||
                url.includes("gitlab.com") ||
                url.includes("codeberg.org"))
          );
          if (gitCloneUrl) {
            ownerRepo = extractOwnerRepo(gitCloneUrl);
          }
        }

        // If we found a valid git URL, construct raw URL
        if (ownerRepo) {
          const { owner, repo: repoName, hostname } = ownerRepo;
          const branch = repo.defaultBranch || "main";

          if (hostname === "github.com" || hostname.includes("github.com")) {
            return `https://raw.githubusercontent.com/${owner}/${repoName}/${encodeURIComponent(
              branch
            )}/${logoPath}`;
          } else if (
            hostname === "gitlab.com" ||
            hostname.includes("gitlab.com")
          ) {
            return `https://gitlab.com/${owner}/${repoName}/-/raw/${encodeURIComponent(
              branch
            )}/${logoPath}`;
          } else if (
            hostname === "codeberg.org" ||
            hostname.includes("codeberg.org")
          ) {
            return `https://codeberg.org/${owner}/${repoName}/raw/branch/${encodeURIComponent(
              branch
            )}/${logoPath}`;
          }
        }

        // For native Nostr repos (without sourceUrl or clone URLs), use the API endpoint
        // CRITICAL: Use repositoryName from Nostr event (exact name used by git-nostr-bridge)
        // Priority: repositoryName > repo > slug > name
        if (!ownerRepo && logoPath) {
          const ownerPubkey = repo.entity
            ? getRepoOwnerPubkey(repo as any, repo.entity)
            : null;
          const repoDataAny = repo as any;
          let repoName =
            repoDataAny?.repositoryName || repo.repo || repo.slug || repo.name;

          // Extract repo name (handle paths like "host.example/my-repo")
          if (
            repoName &&
            typeof repoName === "string" &&
            repoName.includes("/")
          ) {
            const parts = repoName.split("/");
            repoName = parts[parts.length - 1] || repoName;
          }
          if (repoName) {
            repoName = String(repoName).replace(/\.git$/, "");
          }

          if (ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey) && repoName) {
            // Raw image bytes (not JSON file-content) so <img> can render
            return `/api/og/repo-image?ownerPubkey=${encodeURIComponent(
              ownerPubkey
            )}&repo=${encodeURIComponent(repoName)}`;
          }
        }
      }
    }

    // Priority 3: Owner Nostr profile picture (last fallback)
    // CRITICAL: Use getRepoOwnerPubkey to resolve full pubkey (handles all cases)
    const ownerPubkey = repo.entity
      ? getRepoOwnerPubkey(repo as any, repo.entity)
      : null;
    if (ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey)) {
      // CRITICAL: Use ownerMetadata directly so React re-renders when metadata loads
      // Normalize pubkey to lowercase for metadata lookup
      const normalizedPubkey = ownerPubkey.toLowerCase();
      const metadata =
        ownerMetadata[normalizedPubkey] || ownerMetadata[ownerPubkey];
      if (metadata?.picture) {
        const picture = metadata.picture;
        if (
          picture &&
          picture.trim().length > 0 &&
          picture.startsWith("http")
        ) {
          return picture;
        }
      }
    }

    return null;
  };

  // Load repos from localStorage and sync from Nostr
  const applyReposToUi = useCallback((list: Repo[]) => {
    const deletedRepos = JSON.parse(
      localStorage.getItem("gittr_deleted_repos") || "[]"
    ) as Array<{ entity: string; repo: string; deletedAt: number }>;
    const deletedReposSet = new Set(
      deletedRepos.map((d) => `${d.entity}/${d.repo}`.toLowerCase())
    );

    const filtered = list
      .map((r: any) => {
        if (
          (!r.entity || r.entity === "user") &&
          r.ownerPubkey &&
          /^[0-9a-f]{64}$/i.test(r.ownerPubkey)
        ) {
          let entityDisplay = r.entityDisplayName;
          if (!entityDisplay) {
            try {
              entityDisplay =
                nip19.npubEncode(r.ownerPubkey).substring(0, 16) + "...";
            } catch {
              entityDisplay = r.ownerPubkey.substring(0, 16) + "...";
            }
          }
          return {
            ...r,
            entity: nip19.npubEncode(r.ownerPubkey),
            entityDisplayName: entityDisplay,
          };
        }
        return r;
      })
      .filter((r: any) => {
        const entity = r.entity || "";
        const repo = r.repo || r.slug || "";
        const repoKey = `${entity}/${repo}`.toLowerCase();
        if (deletedReposSet.has(repoKey)) return false;
        if (r.deleted === true || r.archived === true) return false;
        if (!isRenderableRepoName(repo)) return false;
        if (!r.entity || r.entity === "user") {
          exploreDebug("⚠️ [Explore] Skipping repo without entity:", {
            slug: r.slug,
            repo: r.repo,
            hasOwnerPubkey: !!r.ownerPubkey,
          });
          return false;
        }
        if (isRepoFromBlocklistedOwner(r)) return false;
        return true;
      });

    const finalRepos = filtered.map((r: any) => ({
      ...r,
      ownerPubkey: r.ownerPubkey,
      contributors: r.contributors || [],
    }));

    exploreDebug("🔍 [Explore] applyReposToUi:", {
      catalog: list.length,
      shown: finalRepos.length,
    });
    setRepos(finalRepos);
  }, []);

  const readExploreCatalog = useCallback((): Repo[] => {
    if (exploreCatalogRef.current) return exploreCatalogRef.current;
    const fromLs = loadStoredRepos() as Repo[];
    const hydrated = hydrateExploreSessionCatalog(fromLs) as Repo[];
    exploreCatalogRef.current = hydrated;
    return hydrated;
  }, []);

  /** Persist best-effort; always keep session catalog + UI in sync with `list`. */
  const commitExploreCatalog = useCallback(
    (list: Repo[], opts?: { immediate?: boolean }) => {
      exploreCatalogRef.current = list;
      writeExploreSessionCatalog(list);
      const flushUi = () => {
        if (exploreCatalogRef.current) {
          applyReposToUi(exploreCatalogRef.current);
        }
      };
      const flushPersist = () => {
        if (!exploreCatalogRef.current) return false;
        return saveStoredRepos(exploreCatalogRef.current as any, {
          quiet: true,
        });
      };

      if (opts?.immediate) {
        if (catalogUiTimerRef.current) {
          clearTimeout(catalogUiTimerRef.current);
          catalogUiTimerRef.current = null;
        }
        if (catalogPersistTimerRef.current) {
          clearTimeout(catalogPersistTimerRef.current);
          catalogPersistTimerRef.current = null;
        }
        flushUi();
        return flushPersist();
      }

      if (catalogUiTimerRef.current) clearTimeout(catalogUiTimerRef.current);
      catalogUiTimerRef.current = setTimeout(flushUi, 120);

      if (catalogPersistTimerRef.current)
        clearTimeout(catalogPersistTimerRef.current);
      catalogPersistTimerRef.current = setTimeout(() => {
        flushPersist();
      }, 600);
      return true;
    },
    [applyReposToUi]
  );

  const loadRepos = useCallback(() => {
    const alreadyHas =
      (exploreCatalogRef.current?.length || 0) > 0 ||
      (peekExploreSessionCatalog()?.length || 0) > 0;
    if (!alreadyHas) setIsLoadingRepos(true);
    try {
      const rawRepos = localStorage.getItem("gittr_repos");
      exploreDebug("🔍 [Explore] loadRepos - raw localStorage:", {
        hasData: !!rawRepos,
        length: rawRepos ? JSON.parse(rawRepos).length : 0,
        sample: rawRepos
          ? JSON.parse(rawRepos)
              .slice(0, 2)
              .map((r: any) => ({
                entity: r.entity,
                repo: r.repo || r.slug,
                hasOwnerPubkey: !!r.ownerPubkey,
                ownerPubkey: r.ownerPubkey?.slice(0, 8),
              }))
          : [],
      });

      const fromLs = loadStoredRepos() as Repo[];
      const mem =
        exploreCatalogRef.current ||
        (peekExploreSessionCatalog() as Repo[] | null);
      // Prefer the larger session catalog when quota blocked persist — otherwise
      // every loadRepos() after a failed save snapped UI back to ~180 rows.
      const rawList =
        mem && mem.length > fromLs.length
          ? mem
          : ((exploreCatalogRef.current = fromLs),
            writeExploreSessionCatalog(fromLs),
            fromLs);
      const list = rawList.filter((r) =>
        isRenderableRepoName(r.repo || r.slug || r.name)
      );
      if (list.length !== rawList.length) {
        exploreCatalogRef.current = list;
        writeExploreSessionCatalog(list);
      }

      exploreDebug("🔍 [Explore] loadRepos - after loadStoredRepos:", {
        loadedCount: fromLs.length,
        sessionCatalog: mem?.length ?? 0,
        using: list.length,
        sample: list.slice(0, 2).map((r) => ({
          entity: r.entity,
          repo: r.repo || r.slug,
          hasOwnerPubkey: !!r.ownerPubkey,
        })),
      });

      applyReposToUi(list);
    } catch (err) {
      console.error("❌ [Explore] loadRepos error:", err);
      setRepos([]);
    } finally {
      setIsLoadingRepos(false);
    }
  }, [applyReposToUi]);

  useEffect(() => {
    loadRepos();

    const handleRepoUpdate = () => {
      loadRepos();
    };

    window.addEventListener("storage", handleRepoUpdate);
    window.addEventListener("gittr:repo-created", handleRepoUpdate);
    window.addEventListener("gittr:repo-imported", handleRepoUpdate);

    return () => {
      window.removeEventListener("storage", handleRepoUpdate);
      window.removeEventListener("gittr:repo-created", handleRepoUpdate);
      window.removeEventListener("gittr:repo-imported", handleRepoUpdate);
    };
  }, [loadRepos]);

  // Locals first, then SEO snapshot (Hetzner disk), then live Nostr enriches.
  // Do not skip the snapshot because localStorage is already large.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    const mergeSeed = (
      seed: Array<{
        entity: string;
        repo: string;
        repoName?: string;
        ownerPubkey: string;
        lastActivity?: number;
        description?: string;
      }>
    ) => {
      if (!seed.length) return;
      try {
        const existing = readExploreCatalog() as any[];
        const { list, added, updated, removed } = mergeExploreSeedIntoCatalog(
          existing,
          seed,
          EXPLORE_SEED_CACHE_CAP
        );
        if ((added > 0 || updated > 0 || removed > 0) && !cancelled) {
          const saved = commitExploreCatalog(list as Repo[], {
            immediate: true,
          });
          if (!saved) {
            console.warn(
              "[Explore] seed merge could not persist (quota); session catalog kept in memory"
            );
          }
          exploreDebug(
            `🌱 [Explore] Seeded +${added} ~${updated} -${removed} (cache now ${list.length})`
          );
        }
      } catch (e) {
        console.warn("[Explore] seed merge failed:", e);
      }
    };

    (async () => {
      const existing = readExploreCatalog() as any[];
      if (!shouldFetchExploreSeed(existing)) return;

      try {
        const [seedRes, recentRes] = await Promise.all([
          fetch(`/api/explore/seed?limit=${EXPLORE_SEED_FETCH_LIMIT}`).catch(
            () => null
          ),
          fetch("/api/stats/recent-repos").catch(() => null),
        ]);
        if (cancelled) return;

        const seedJson = seedRes?.ok
          ? ((await seedRes.json()) as {
              ok?: boolean;
              repos?: Array<{
                entity: string;
                repo: string;
                repoName?: string;
                ownerPubkey: string;
                lastActivity?: number;
              }>;
            })
          : null;
        const recentJson = recentRes?.ok
          ? ((await recentRes.json()) as {
              repos?: Array<{
                entity: string;
                repo: string;
                repoName?: string;
                ownerPubkey: string;
                lastActivity?: number;
                description?: string;
              }>;
            })
          : null;

        mergeSeed([...(seedJson?.repos || []), ...(recentJson?.repos || [])]);
      } catch (e) {
        console.warn("[Explore] seed fetch failed:", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [commitExploreCatalog, readExploreCatalog]);

  // Sync from Nostr relays - query for ALL public repos (Nostr cloud)
  // This allows users to see repos from all users, not just their own
  useEffect(() => {
    // Wait for client-side only
    if (typeof window === "undefined") return;

    exploreDebug("🔍 [Explore] useEffect triggered:", {
      hasSubscribe: !!subscribe,
      hasDefaultRelays: !!defaultRelays,
      defaultRelaysLength: defaultRelays?.length || 0,
      pubkey: pubkey ? pubkey.slice(0, 8) : "none",
      relayList: defaultRelays?.slice(0, 5), // Show first 5 relays
    });

    if (!subscribe) {
      console.warn("⚠️ [Explore] Cannot subscribe: subscribe missing");
      return;
    }

    let alive = true;
    const existingRepos = readExploreCatalog();
    exploreDebug(
      "📊 [Explore] Current repos in session catalog:",
      existingRepos.length
    );

    let deletedReposList: Array<{
      entity: string;
      repo: string;
      deletedAt: number;
    }> = [];
    try {
      const parsed = JSON.parse(
        localStorage.getItem("gittr_deleted_repos") || "[]"
      );
      deletedReposList = Array.isArray(parsed) ? parsed : [];
    } catch {
      deletedReposList = [];
    }

    const envRelays = defaultRelays || [];
    const alreadyHasCatalog = shouldHideExploreSyncForCatalog(existingRepos);
    setSyncing(!alreadyHasCatalog);

    // Query GRASP / NIP-34 discovery hosts first — don't wait for relays tags,
    // and don't open Damus/wine in the same REQ (that starves discovery).
    const allRelays = exploreRepoRelaysForClient(getAllRelays(envRelays));
    const immediateRelays = exploreImmediateDiscoveryRelays(
      getAllRelays(envRelays)
    );
    const deferredRelays = exploreDeferredSocialRelays(getAllRelays(envRelays));
    const graspRelays = getGraspServers(allRelays);
    const normRelay = (u: string) => u.trim().toLowerCase().replace(/\/+$/, "");
    const graspRelayNorms = new Set(graspRelays.map(normRelay));
    const queriedDiscoveryRelays = new Set(allRelays.map(normRelay));
    const extraUnsubs: Array<() => void> = [];
    exploreDebug(
      "🎯 [Explore] Immediate discovery (NIP-34 / GRASP):",
      immediateRelays
    );
    if (deferredRelays.length > 0) {
      exploreDebug("⏳ [Explore] Social relays deferred 1.5s:", deferredRelays);
    }

    // Track which relays have sent EOSE - but prioritize GRASP relays
    // Stop syncing after we get responses from at least 2 GRASP relays OR 5 regular relays OR 10 seconds
    const eoseReceived = new Set<string>();
    const graspRelaysReceived = new Set<string>();
    let eoseTimeout: NodeJS.Timeout | null = null;
    let minRelaysTimeout: NodeJS.Timeout | null = null;
    let syncIndicatorHidden = alreadyHasCatalog;

    const checkShouldStopSyncing = () => {
      // CRITICAL: This only stops the "syncing" UI indicator, NOT the subscription!
      // The subscription continues to listen for new repos in real-time even after this.
      // EOSE means "end of stored events" - but new events can still arrive after EOSE.
      if (syncIndicatorHidden) return;

      // Stop showing "syncing" status if we've received EOSE from at least 2 GRASP relays
      // OR if we've received repos from at least 5 regular relays and waited 5 seconds
      // OR if we've received a very large number of repos (2000+) - we have enough initial data
      const repos = readExploreCatalog();
      const hasEnoughRepos = repos.length > 0;
      const hasUsableSample = shouldHideExploreSyncForCatalog(repos);

      const hasEnoughGraspRelays = graspRelaysReceived.size >= 2;
      const hasEnoughRegularRelays = eoseReceived.size >= 5 && hasEnoughRepos;

      if (hasEnoughGraspRelays || hasEnoughRegularRelays || hasUsableSample) {
        syncIndicatorHidden = true;
        exploreDebug(
          "✅ [Explore] Hiding sync indicator - enough initial data received:",
          {
            eoseCount: eoseReceived.size,
            graspRelaysReceived: graspRelaysReceived.size,
            totalRepos: repos.length,
            reason: hasEnoughGraspRelays
              ? "2+ GRASP relays"
              : hasEnoughRegularRelays
              ? "5+ regular relays with repos"
              : "40+ live Nostr events (not SEO seed)",
            note: "Subscription continues to listen for new repos in real-time",
          }
        );
        setSyncing(false); // Only hides the UI indicator - subscription keeps running!
        if (eoseTimeout) clearTimeout(eoseTimeout);
        if (minRelaysTimeout) clearTimeout(minRelaysTimeout);
      }
    };

    // Stop syncing after 15 seconds max (longer to allow GRASP relays to respond)
    eoseTimeout = setTimeout(() => {
      exploreDebug("⏱️ [Explore] Sync timeout after 15s:", {
        eoseReceived: eoseReceived.size,
        graspRelaysReceived: graspRelaysReceived.size,
        totalRepos: readExploreCatalog().length,
      });
      setSyncing(false);
      if (minRelaysTimeout) clearTimeout(minRelaysTimeout);
    }, 15000);

    // Also stop after 8 seconds if we have at least 2 GRASP relay responses OR 5 regular relays
    minRelaysTimeout = setTimeout(() => {
      checkShouldStopSyncing();
    }, 8000);

    // Query Nostr for ALL repositories (no author filter = all users)
    // Also query user's own repos to ensure they're included
    // NOTE: No time limit - get all repos from Nostr (historical repos are valuable)
    // Relays will handle pagination/limits if needed
    // Match /repositories: lighter REQ so relays actually finish (EOSE).
    // Soft-delete markers on 30617 cover most deletions; do NOT bundle unscoped
    // kind 5 here — that flood stalls discovery across ~16 relays.
    const filters = [
      {
        kinds: [KIND_REPOSITORY, KIND_REPOSITORY_NIP34],
        limit: 800,
      },
      ...(pubkey
        ? [
            {
              kinds: [KIND_REPOSITORY, KIND_REPOSITORY_NIP34],
              authors: [pubkey],
              limit: 1000,
            },
          ]
        : []),
    ];

    exploreDebug("📡 [Explore] Subscribing with filters:", filters);

    // NIP-34 replaceable events are applied live; collect duplicates only for debug.
    const nip34EventsByRepo = new Map<
      string,
      Array<{ event: any; relayURL?: string }>
    >();

    const onExploreEvent: OnEvent = (event, isAfterEose, relayURL) => {
      if (!alive) return;
      // CRITICAL: Process ALL events, including those that arrive after EOSE!
      // EOSE (End of Stored Events) just means the relay finished sending stored events,
      // but new events can still arrive in real-time. The subscription NEVER stops listening.
      // We continue to process and add new repos even after the "syncing" status changes to false.
      exploreDebug("📨 [Explore] Event received:", {
        kind: event.kind,
        expectedKinds: [KIND_REPOSITORY, KIND_REPOSITORY_NIP34, 5],
        relay: relayURL,
        isAfterEose,
        pubkey: event.pubkey?.slice(0, 8),
        eventId: event.id?.slice(0, 8),
      });

      // CRITICAL: For NIP-34 replaceable events, collect ALL events first
      // Don't process immediately - wait for EOSE to pick the latest one
      if (event.kind === KIND_REPOSITORY_NIP34) {
        if (isPublisherBlocklisted(event.pubkey)) return;
        const dTag = event.tags?.find(
          (t: any) => Array.isArray(t) && t[0] === "d"
        );
        const repoName = dTag?.[1];
        if (repoName && event.pubkey && exploreDebugEnabled()) {
          const repoKey = `${event.pubkey}/${repoName}`;
          if (!nip34EventsByRepo.has(repoKey)) {
            nip34EventsByRepo.set(repoKey, []);
          }
          nip34EventsByRepo.get(repoKey)!.push({ event, relayURL });
          exploreDebug(
            `📦 [Explore] Collected NIP-34 event for ${repoKey}: id=${event.id.slice(
              0,
              8
            )}..., created_at=${event.created_at}, total=${
              nip34EventsByRepo.get(repoKey)!.length
            }`
          );
        }
      }

      // Handle NIP-09 deletion events (kind 5)
      if (event.kind === 5) {
        // NIP-09: Deletion events reference the deleted event via "e" tag
        // Process deletion events to mark repos as deleted
        if (event.tags && Array.isArray(event.tags)) {
          for (const tag of event.tags) {
            if (Array.isArray(tag) && tag[0] === "e" && tag[1]) {
              const deletedEventId = tag[1];
              exploreDebug(
                "🗑️ [Explore] NIP-09 deletion event received for event:",
                deletedEventId.slice(0, 8)
              );

              // Find repos with this event ID and mark them as deleted
              const existingRepos = readExploreCatalog();
              let updated = false;

              const updatedRepos = existingRepos.map((r: any) => {
                // Match by nostrEventId or lastNostrEventId
                if (
                  (r.nostrEventId === deletedEventId ||
                    r.lastNostrEventId === deletedEventId) &&
                  !r.deleted
                ) {
                  exploreDebug(
                    "🗑️ [Explore] Marking repo as deleted via NIP-09:",
                    {
                      repo: r.repo || r.slug,
                      entity: r.entity,
                      eventId: deletedEventId.slice(0, 8),
                    }
                  );
                  updated = true;
                  return { ...r, deleted: true };
                }
                return r;
              });

              if (updated) {
                commitExploreCatalog(updatedRepos, { immediate: true });
              }
            }
          }
        }
        return; // Don't process deletion events as repos
      }

      // Support both gitnostr (kind 51) and NIP-34 (kind 30617)
      if (
        event.kind === KIND_REPOSITORY ||
        event.kind === KIND_REPOSITORY_NIP34
      ) {
        if (isPublisherBlocklisted(event.pubkey)) return;
        try {
          // NIP-34 uses tags for metadata, content is empty
          // gitnostr uses JSON in content
          let repoData: any;
          if (event.kind === KIND_REPOSITORY_NIP34) {
            // NIP-34 format: Parse from tags
            repoData = parseNIP34Repository(event);
          } else {
            // gitnostr format: Parse from JSON content
            // CRITICAL: Validate content is JSON before parsing
            if (!event.content || typeof event.content !== "string") {
              exploreDebug(
                "⚠️ [Explore] Skipping event with invalid content:",
                {
                  eventId: event.id.slice(0, 8),
                  kind: event.kind,
                  contentLength: event.content?.length || 0,
                }
              );
              return;
            }

            // Check if content looks like JSON (starts with { or [)
            const trimmedContent = event.content.trim();
            if (
              !trimmedContent.startsWith("{") &&
              !trimmedContent.startsWith("[")
            ) {
              exploreDebug(
                "⚠️ [Explore] Skipping event with non-JSON content:",
                {
                  eventId: event.id.slice(0, 8),
                  kind: event.kind,
                  contentPreview: trimmedContent.slice(0, 50),
                }
              );
              return;
            }

            try {
              repoData = JSON.parse(event.content);
            } catch (parseError) {
              exploreDebug("⚠️ [Explore] Failed to parse JSON content:", {
                eventId: event.id.slice(0, 8),
                kind: event.kind,
                error: parseError,
                contentPreview: trimmedContent.slice(0, 100),
              });
              return; // Skip this event
            }
          }

          // CRITICAL: Validate repoData has required fields
          if (
            !repoData ||
            typeof repoData !== "object" ||
            !repoData.repositoryName
          ) {
            exploreDebug("⚠️ [Explore] Skipping event with invalid repoData:", {
              eventId: event.id.slice(0, 8),
              hasRepoData: !!repoData,
              hasRepositoryName: !!repoData?.repositoryName,
            });
            return;
          }

          // Foreign clients sometimes announce storage paths ("<hex>/name")
          // as the d tag — those can never resolve on gittr, so don't list.
          if (!isRenderableRepoName(repoData.repositoryName)) {
            exploreDebug(
              "⚠️ [Explore] Skipping repo with unrenderable identifier:",
              {
                eventId: event.id.slice(0, 8),
                repositoryName: String(repoData.repositoryName).slice(0, 80),
              }
            );
            return;
          }

          // GRASP-01: Parse clone, relays, topics, and contributors from event.tags
          // Tags are stored as: ["clone", "https://gittr.space"] or ["relays", "wss://relay.example.com"]
          // Contributors are stored as: ["p", pubkey, weight, role]
          const cloneTags: string[] = [];
          const relaysTags: string[] = [];
          const topicTags: string[] = [];
          const contributorTags: Array<{
            pubkey: string;
            weight: number;
            role?: string;
          }> = [];

          if (event.tags && Array.isArray(event.tags)) {
            for (const tag of event.tags) {
              if (Array.isArray(tag) && tag.length >= 2) {
                const tagName = tag[0];
                const tagValue = tag[1];

                if (tagName === "clone" && tagValue) {
                  cloneTags.push(tagValue);
                } else if (tagName === "relays" && tagValue) {
                  // CRITICAL: Handle both formats per NIP-34 spec:
                  // 1. Separate tags: ["relays", "wss://relay1.com"], ["relays", "wss://relay2.com"]
                  // 2. Comma-separated (backward compat): ["relays", "wss://relay1.com,wss://relay2.com"]
                  // Check if value contains commas (comma-separated format)
                  if (tagValue.includes(",")) {
                    // Comma-separated format - split and add each
                    const relayUrls = tagValue
                      .split(",")
                      .map((r) => r.trim())
                      .filter((r) => r.length > 0);
                    relayUrls.forEach((relayUrl) => {
                      // Ensure wss:// prefix
                      const normalized =
                        relayUrl.startsWith("wss://") ||
                        relayUrl.startsWith("ws://")
                          ? relayUrl
                          : `wss://${relayUrl}`;
                      if (!relaysTags.includes(normalized)) {
                        relaysTags.push(normalized);
                      }
                    });
                  } else {
                    // Single relay per tag - add directly
                    const normalized =
                      tagValue.startsWith("wss://") ||
                      tagValue.startsWith("ws://")
                        ? tagValue
                        : `wss://${tagValue}`;
                    if (!relaysTags.includes(normalized)) {
                      relaysTags.push(normalized);
                    }
                  }
                } else if (tagName === "t" && tagValue) {
                  // Topic/tag tags
                  topicTags.push(tagValue);
                } else if (tagName === "p") {
                  // Extract contributors from "p" tags: ["p", pubkey, weight, role]
                  const pubkey = tagValue;
                  const weight =
                    tag.length > 2 ? parseInt(tag[2] as string) || 0 : 0;
                  const role = tag.length > 3 ? (tag[3] as string) : undefined;

                  // Validate pubkey format (64 hex chars)
                  if (pubkey && /^[0-9a-f]{64}$/i.test(pubkey)) {
                    contributorTags.push({
                      pubkey,
                      weight,
                      role:
                        role ||
                        (weight === 100
                          ? "owner"
                          : weight >= 50
                          ? "maintainer"
                          : "contributor"),
                    });
                  }
                }
              }
            }
          }

          // Extra `relays` tags: query each new *real* relay once. Do not
          // re-dial gitworkshop / git.gittr.space, and do not spawn a nested
          // subscribe per event (that thrashed CONNECTING sockets).
          if (relaysTags.length > 0 && addRelay && subscribe) {
            for (const relayUrl of relaysTags) {
              const toQuery = rememberExploreDiscoveryRelay(
                relayUrl,
                queriedDiscoveryRelays
              );
              if (!toQuery) continue;
              exploreDebug(
                "🔄 [GRASP-02] Discovering new relay from repo event:",
                toQuery
              );
              addRelay(toQuery);
              const extraUnsub = subscribe(filters, [toQuery], onExploreEvent);
              if (typeof extraUnsub === "function") {
                extraUnsubs.push(extraUnsub);
              }
            }
          }

          const isForeignRepo = pubkey && event.pubkey !== pubkey;
          const isOwnRepo = pubkey && event.pubkey === pubkey;
          exploreDebug("📦 [Explore] Repo event received:", {
            relay: relayURL,
            owner: event.pubkey.slice(0, 8),
            repoName: repoData.repositoryName,
            isForeign: isForeignRepo,
            isOwn: isOwnRepo,
            hasFiles: !!(repoData.files && repoData.files.length > 0),
            filesCount: repoData.files?.length || 0,
            cloneTags: cloneTags.length,
            relaysTags: relaysTags.length,
            topicTags: topicTags.length,
            createdAt: new Date(event.created_at * 1000).toISOString(),
            eventId: event.id.slice(0, 8),
          });

          // Session catalog (grows past localStorage quota)
          const existingRepos = readExploreCatalog();

          // Check if this repo was locally deleted (user deleted it, don't re-add from Nostr)
          const deletedRepos = deletedReposList;
          // CRITICAL: Use npub format for entity (GRASP protocol standard)
          const entity = nip19.npubEncode(event.pubkey);
          const repoKey = `${entity}/${repoData.repositoryName}`.toLowerCase();
          const isDeleted = deletedRepos.some((d) => {
            // Check by npub entity or by ownerPubkey (handles both formats)
            const dEntityMatch =
              d.entity.toLowerCase() === entity.toLowerCase();
            // CRITICAL: Check repoData.repositoryName exists before calling toLowerCase()
            if (
              dEntityMatch &&
              repoData.repositoryName &&
              d.repo.toLowerCase() === repoData.repositoryName.toLowerCase()
            )
              return true;
            // Also check if deleted entity is npub for same pubkey
            if (d.entity.startsWith("npub")) {
              try {
                const dDecoded = nip19.decode(d.entity);
                if (
                  dDecoded.type === "npub" &&
                  (dDecoded.data as string).toLowerCase() ===
                    event.pubkey.toLowerCase()
                ) {
                  return (
                    repoData.repositoryName &&
                    d.repo.toLowerCase() ===
                      repoData.repositoryName.toLowerCase()
                  );
                }
              } catch {}
            }
            return false;
          });

          // Normalize repo name for comparison (handle underscores vs hyphens, case-insensitive)
          const normalizeRepoName = (name: string): string => {
            if (!name) return "";
            return name.toLowerCase().replace(/[_-]/g, "");
          };
          const normalizedRepoName = normalizeRepoName(repoData.repositoryName);

          // Soft-delete on Nostr → hide + purge Explore copies.
          // Local tombstone alone means a prior Delete in this browser; a live
          // non-deleted 30617 is a reopen under the same name — clear & show.
          if (repoData.deleted === true || repoData.archived === true) {
            const purged = existingRepos.filter((r: any) => {
              const rRepoNormalized = normalizeRepoName(r.repo || r.slug || "");
              const sameRepo = rRepoNormalized === normalizedRepoName;
              if (!sameRepo) return true;
              if (
                r.ownerPubkey &&
                r.ownerPubkey.toLowerCase() === event.pubkey.toLowerCase()
              ) {
                return false;
              }
              if (r.entity === entity || r.entity === event.pubkey) {
                return false;
              }
              return true;
            });
            if (purged.length !== existingRepos.length) {
              commitExploreCatalog(purged, { immediate: true });
            }
            return;
          }

          if (isDeleted) {
            const announcedAtMs =
              typeof event.created_at === "number"
                ? event.created_at * 1000
                : undefined;
            const cleared = clearDeletedRepoTombstones({
              entity,
              repo: repoData.repositoryName,
              ownerPubkey: event.pubkey,
              announcedAtMs,
            });
            if (cleared === 0) {
              return;
            }
          }

          // Check if this repo already exists (match by ownerPubkey first, then entity)
          // CRITICAL: Use ownerPubkey as primary key for matching to avoid duplicates
          // CRITICAL: Normalize repo names to handle variations (bitcoin_meetup_calendar vs bitcoin-meetup-calendar)
          const existingIndex = existingRepos.findIndex((r: any) => {
            // Normalize existing repo names for comparison
            const rRepoNormalized = normalizeRepoName(r.repo || r.slug || "");
            const rSlugNormalized = normalizeRepoName(r.slug || "");

            // Match by ownerPubkey first (most reliable - works across all entity formats)
            if (
              r.ownerPubkey &&
              r.ownerPubkey.toLowerCase() === event.pubkey.toLowerCase()
            ) {
              return (
                rRepoNormalized === normalizedRepoName ||
                rSlugNormalized === normalizedRepoName
              );
            }
            // Match by entity (npub format or full pubkey)
            if (r.entity === entity || r.entity === event.pubkey) {
              return (
                rRepoNormalized === normalizedRepoName ||
                rSlugNormalized === normalizedRepoName
              );
            }
            // Also check if existing entity is npub for same pubkey
            if (r.entity && r.entity.startsWith("npub")) {
              try {
                const rDecoded = nip19.decode(r.entity);
                if (
                  rDecoded.type === "npub" &&
                  (rDecoded.data as string).toLowerCase() ===
                    event.pubkey.toLowerCase()
                ) {
                  return (
                    rRepoNormalized === normalizedRepoName ||
                    rSlugNormalized === normalizedRepoName
                  );
                }
              } catch {}
            }
            return false;
          });

          // entityDisplayName will be set from metadata later, use npub as fallback
          const entityDisplayName = entity;
          const existingRepo =
            existingIndex >= 0 ? existingRepos[existingIndex] : undefined;

          // CRITICAL: Extract contributors from "p" tags first (most reliable source)
          // Then merge with contributors from JSON content, then with existing repo contributors
          let contributors: Array<{
            pubkey?: string;
            name?: string;
            picture?: string;
            weight: number;
            role?: string;
            githubLogin?: string;
          }> = [];

          // Priority 1: Contributors from "p" tags (published by owner, most reliable)
          if (contributorTags.length > 0) {
            contributors = contributorTags.map((c) => ({
              pubkey: c.pubkey,
              weight: c.weight,
              role: c.role as
                | "owner"
                | "maintainer"
                | "contributor"
                | undefined,
            }));
            exploreDebug(
              `📋 [Explore] Extracted ${contributors.length} contributors from "p" tags`
            );
          }

          // Priority 2: Merge with contributors from JSON content (if any)
          if (
            repoData.contributors &&
            Array.isArray(repoData.contributors) &&
            repoData.contributors.length > 0
          ) {
            // Merge: add contributors from content that aren't already in tags
            for (const contentContributor of repoData.contributors) {
              const exists = contributors.some(
                (c) =>
                  c.pubkey &&
                  contentContributor.pubkey &&
                  c.pubkey.toLowerCase() ===
                    contentContributor.pubkey.toLowerCase()
              );
              if (!exists) {
                contributors.push(contentContributor);
              }
            }
            exploreDebug(
              `📋 [Explore] Merged ${repoData.contributors.length} contributors from JSON content`
            );
          }

          // Priority 3: Merge with existing repo contributors (preserve local metadata like names/pictures)
          if (
            existingRepo?.contributors &&
            Array.isArray(existingRepo.contributors) &&
            existingRepo.contributors.length > 0
          ) {
            for (const existingContributor of existingRepo.contributors) {
              const existingIndex = contributors.findIndex(
                (c) =>
                  c.pubkey &&
                  existingContributor.pubkey &&
                  c.pubkey.toLowerCase() ===
                    existingContributor.pubkey.toLowerCase()
              );
              if (existingIndex >= 0) {
                // Merge: keep pubkey/weight/role from tags/content, but preserve name/picture from existing
                contributors[existingIndex] = {
                  ...contributors[existingIndex],
                  name:
                    existingContributor.name ||
                    contributors[existingIndex]?.name,
                  picture:
                    existingContributor.picture ||
                    contributors[existingIndex]?.picture,
                  githubLogin:
                    existingContributor.githubLogin ||
                    contributors[existingIndex]?.githubLogin,
                  weight:
                    contributors[existingIndex]?.weight ??
                    existingContributor.weight ??
                    0, // Ensure weight is always a number
                };
              } else {
                // Add contributor that exists locally but not in event
                // Ensure weight is always a number
                contributors.push({
                  ...existingContributor,
                  weight: existingContributor.weight ?? 0,
                });
              }
            }
          }

          // CRITICAL: Always ensure owner (event.pubkey) is in contributors with weight 100 and role owner
          const ownerInContributors = contributors.some(
            (c: any) =>
              c.pubkey && c.pubkey.toLowerCase() === event.pubkey.toLowerCase()
          );
          if (!ownerInContributors) {
            contributors = [
              { pubkey: event.pubkey, weight: 100, role: "owner" },
              ...contributors,
            ];
          } else {
            // Ensure owner has weight 100 and role owner (override any other values)
            contributors = contributors.map((c: any) =>
              c.pubkey && c.pubkey.toLowerCase() === event.pubkey.toLowerCase()
                ? { ...c, weight: 100, role: "owner" }
                : c
            );
          }

          exploreDebug(
            `✅ [Explore] Final contributors list: ${contributors.length} total`,
            {
              owners: contributors.filter(
                (c) => c.weight === 100 || c.role === "owner"
              ).length,
              maintainers: contributors.filter(
                (c) =>
                  c.role === "maintainer" || (c.weight >= 50 && c.weight < 100)
              ).length,
              contributors: contributors.filter(
                (c) =>
                  c.role === "contributor" || (c.weight > 0 && c.weight < 50)
              ).length,
            }
          );

          // CRITICAL: Validate BEFORE creating repo object - use general corruption check
          const repoForValidation = {
            repositoryName: repoData.repositoryName,
            entity: entity,
            ownerPubkey: event.pubkey,
          };

          if (isRepoCorrupted(repoForValidation, event.id)) {
            // Silently reject - don't spam console for corrupted repos
            return; // Don't store corrupted repos
          }

          // Discovery: skip announces that only advertise localhost/private clones.
          // (Zero clone tags still allowed — legacy / GRASP-only.)
          const rawCloneUrls =
            cloneTags.length > 0
              ? cloneTags
              : Array.isArray(repoData.clone)
              ? repoData.clone
              : [];
          if (shouldHideAnnounceForUnusableClones(rawCloneUrls)) {
            if (existingIndex >= 0) {
              existingRepos.splice(existingIndex, 1);
            }
            return;
          }

          const repo: Repo = {
            slug: repoData.repositoryName,
            entity: entity, // CRITICAL: Use npub format (GRASP protocol standard)
            repo: repoData.repositoryName,
            // CRITICAL: Use human-readable name from event content if available, otherwise use repositoryName
            name: repoData.name || repoData.repositoryName,
            description: repoData.description,
            sourceUrl: (() => {
              const raw = repoData.sourceUrl || existingRepo?.sourceUrl;
              return raw ? normalizeGithubSourceUrl(String(raw)) : raw;
            })(),
            forkedFrom: (() => {
              const raw = repoData.forkedFrom || existingRepo?.forkedFrom;
              return raw ? normalizeGithubSourceUrl(String(raw)) : raw;
            })(),
            readme: repoData.readme || existingRepo?.readme,
            // CRITICAL: Only use files from event if they exist and are an array with items
            // Don't overwrite existing files with empty array from event
            files:
              repoData.files &&
              Array.isArray(repoData.files) &&
              repoData.files.length > 0
                ? repoData.files
                : existingRepo?.files &&
                  Array.isArray(existingRepo.files) &&
                  existingRepo.files.length > 0
                ? existingRepo.files
                : undefined,
            stars:
              repoData.stars !== undefined
                ? repoData.stars
                : existingRepo?.stars,
            forks:
              repoData.forks !== undefined
                ? repoData.forks
                : existingRepo?.forks,
            languages: repoData.languages || existingRepo?.languages,
            // GRASP-01: Use topics from event.tags (t tags), fallback to content
            topics:
              topicTags.length > 0
                ? topicTags
                : repoData.topics || existingRepo?.topics || [],
            contributors: contributors,
            defaultBranch:
              repoData.defaultBranch || existingRepo?.defaultBranch,
            branches: repoData.branches || existingRepo?.branches,
            releases: coalesceMetadataList(
              repoData.releases,
              existingRepo?.releases
            ),
            logoUrl: existingRepo?.logoUrl,
            createdAt: existingRepo?.createdAt || event.created_at * 1000, // Keep in milliseconds for compatibility
            updatedAt: event.created_at * 1000, // Track when repo was last updated from Nostr (in milliseconds)
            entityDisplayName: entityDisplayName,
            ownerPubkey: event.pubkey, // CRITICAL: Always store full pubkey
            deleted: repoData.deleted || false,
            archived: repoData.archived || false,
            links: repoData.links || existingRepo?.links,
            // GRASP-01: Store clone and relays tags from event.tags (for future GRASP-02 sync)
            clone: usableCloneUrls(
              cloneTags.length > 0
                ? cloneTags
                : repoData.clone || existingRepo?.clone || []
            ),
            relays:
              relaysTags.length > 0
                ? relaysTags
                : repoData.relays || existingRepo?.relays,
          };

          // CRITICAL: Ensure entity is always set (required for filtering)
          // If somehow entity is missing, derive from ownerPubkey as npub
          if (!repo.entity || repo.entity === "user") {
            if (repo.ownerPubkey && /^[0-9a-f]{64}$/i.test(repo.ownerPubkey)) {
              repo.entity = nip19.npubEncode(repo.ownerPubkey);
              repo.entityDisplayName = repo.entityDisplayName || repo.entity;
            } else {
              console.error(
                "⚠️ [Explore] Cannot store repo without entity or ownerPubkey:",
                {
                  repo: repoData.repositoryName,
                  hasEntity: !!repo.entity,
                  hasOwnerPubkey: !!repo.ownerPubkey,
                }
              );
              return; // Skip storing repos without entity/ownerPubkey
            }
          }

          exploreDebug("💾 [Explore] Storing repo:", {
            entity,
            repo: repoData.repositoryName,
            ownerPubkey: event.pubkey.slice(0, 8),
            isNew: existingIndex < 0,
            hasEntity: !!entity,
            hasOwnerPubkey: !!event.pubkey,
            eventId: event.id.slice(0, 16),
            createdAt: new Date(event.created_at * 1000).toISOString(),
            relay: relayURL,
            // Log if this is a duplicate
            isDuplicate: existingIndex >= 0,
            existingEntity:
              existingIndex >= 0
                ? existingRepos[existingIndex]?.entity
                : undefined,
            existingUpdatedAt:
              existingIndex >= 0
                ? existingRepos[existingIndex]?.updatedAt
                : undefined,
          });

          if (existingIndex >= 0) {
            // CRITICAL: For NIP-34 replaceable events, only update if this event is newer
            // Check if existing repo has a newer event already stored
            // NIP-34 uses Unix timestamps in SECONDS - compare in seconds
            const existingEventCreatedAtSeconds = nostrTimestampToSeconds(
              existingRepo?.lastNostrEventCreatedAt || existingRepo?.updatedAt
            );
            const newEventCreatedAtSeconds = event.created_at;

            if (
              event.kind === KIND_REPOSITORY_NIP34 &&
              newEventCreatedAtSeconds <= existingEventCreatedAtSeconds
            ) {
              exploreDebug(
                `⏭️ [Explore] Skipping older NIP-34 event: existing=${new Date(
                  existingEventCreatedAtSeconds * 1000
                ).toISOString()}, new=${new Date(
                  newEventCreatedAtSeconds * 1000
                ).toISOString()}`
              );
              return; // Skip older events
            }

            // CRITICAL: Replace with newer version from Nostr (no merging for proper versioning)
            // Only preserve user-set logoUrl (not from Nostr events)
            const updatedRepo = {
              ...repo, // Use newest Nostr version as base
              // Preserve local logoUrl ONLY if it was user-set (not from Nostr)
              logoUrl:
                existingRepo?.logoUrl &&
                !existingRepo?.logoUrl?.startsWith("http")
                  ? existingRepo.logoUrl
                  : repo.logoUrl,
              // Preserve local unpushed edits flag (local state)
              hasUnpushedEdits: existingRepo?.hasUnpushedEdits || false,
              // Use newest event ID and created_at
              // CRITICAL: Store in SECONDS (Nostr format) - not milliseconds
              nostrEventId: event.id,
              lastNostrEventId: event.id,
              lastNostrEventCreatedAt: event.created_at, // Store in seconds (NIP-34 format)
              syncedFromNostr: true,
              createdAt: (() => {
                const existingSec = nostrTimestampToSeconds(
                  existingRepo?.createdAt
                );
                const fromEvent = event.created_at * 1000;
                if (!existingSec || existingSec > event.created_at) {
                  return fromEvent;
                }
                return existingRepo?.createdAt || fromEvent;
              })(),
              // Extract earliest unique commit from "r" tag if present (may not be in Repo type but exists at runtime)
              ...(repoData.earliestUniqueCommit ||
              (existingRepo as any)?.earliestUniqueCommit
                ? {
                    earliestUniqueCommit:
                      repoData.earliestUniqueCommit ||
                      (existingRepo as any)?.earliestUniqueCommit,
                  }
                : {}),
            };
            existingRepos[existingIndex] = updatedRepo;
            exploreDebug(
              "🔄 [Explore] Updated existing repo with newer Nostr version:",
              {
                repo: repoData.repositoryName,
                oldUpdatedAt: existingRepo?.updatedAt
                  ? new Date(existingRepo.updatedAt).toISOString()
                  : "unknown",
                newUpdatedAt: repo.updatedAt
                  ? new Date(repo.updatedAt).toISOString()
                  : "unknown",
                eventId: event.id.slice(0, 16),
                eventCreatedAt: new Date(event.created_at * 1000).toISOString(),
              }
            );
          } else {
            // New repo - store with event ID and created_at
            // CRITICAL: Store in SECONDS (Nostr format) - not milliseconds
            const newRepo = {
              ...repo,
              nostrEventId: event.id,
              lastNostrEventId: event.id,
              lastNostrEventCreatedAt: event.created_at, // Store in seconds (NIP-34 format)
              syncedFromNostr: true,
              earliestUniqueCommit: repoData.earliestUniqueCommit,
            };
            existingRepos.push(newRepo);
          }

          // Persist best-effort; always refresh UI from session catalog
          // (never reload from localStorage alone — that stuck Explore at ~180).
          commitExploreCatalog(existingRepos);
          setTimeout(() => {
            checkShouldStopSyncing();
          }, 100);
        } catch (error: any) {
          console.error("Error processing repo event:", error);
        }
      }
    };

    const unsub = subscribe(
      filters,
      immediateRelays,
      onExploreEvent,
      undefined,
      (relayInfo, minCreatedAt) => {
        if (!alive) return;
        const relayUrl =
          typeof relayInfo === "string"
            ? relayInfo
            : relayInfo &&
              typeof relayInfo === "object" &&
              "url" in (relayInfo as object) &&
              typeof (relayInfo as { url: string }).url === "string"
            ? (relayInfo as { url: string }).url
            : "";
        const relayName = relayUrl || String(relayInfo ?? "unknown");
        if (exploreDebugEnabled() && nip34EventsByRepo.size > 0) {
          exploreDebug(
            `📡 [Explore] EOSE from ${relayName} — ${nip34EventsByRepo.size} NIP-34 repo key(s) this wave`
          );
          nip34EventsByRepo.clear();
        }

        exploreDebug(
          "✅ [Explore] EOSE from relay:",
          relayName,
          "minCreatedAt:",
          minCreatedAt
        );

        if (relayUrl) {
          const nk = normRelay(relayUrl);
          eoseReceived.add(nk);
          if (graspRelayNorms.has(nk)) {
            graspRelaysReceived.add(nk);
            exploreDebug("🎯 [Explore] GRASP relay responded:", relayUrl);
          }
        }

        if (exploreDebugEnabled()) {
          const allRepos = readExploreCatalog();
          const foreignRepos = pubkey
            ? allRepos.filter(
                (r: any) => r.ownerPubkey && r.ownerPubkey !== pubkey
              )
            : allRepos;
          const ownRepos = pubkey
            ? allRepos.filter((r: any) => r.ownerPubkey === pubkey)
            : [];
          exploreDebug("📊 [Explore] Summary after EOSE:", {
            relay: relayName,
            totalRepos: allRepos.length,
            foreignRepos: foreignRepos.length,
            ownRepos: ownRepos.length,
            currentUserPubkey: pubkey ? pubkey.slice(0, 8) : "none",
            fromNostr: foreignRepos.length > 0 ? "✅" : "❌",
            eoseCount: eoseReceived.size,
            graspRelaysReceived: graspRelaysReceived.size,
            sampleForeignRepos: foreignRepos.slice(0, 3).map((r: any) => ({
              owner: r.ownerPubkey?.slice(0, 8),
              repo: r.repo || r.slug || r.name,
            })),
          });
        }

        checkShouldStopSyncing();
      }
    );

    if (deferredRelays.length > 0) {
      const socialTimer = setTimeout(() => {
        if (!alive) return;
        exploreDebug(
          "📡 [Explore] Opening social relays after discovery sockets:",
          deferredRelays
        );
        extraUnsubs.push(subscribe(filters, deferredRelays, onExploreEvent));
      }, 1500);
      extraUnsubs.push(() => clearTimeout(socialTimer));
    }

    return () => {
      alive = false;
      if (unsub) unsub();
      for (const extra of extraUnsubs) {
        try {
          extra();
        } catch {
          /* ignore */
        }
      }
      if (eoseTimeout) clearTimeout(eoseTimeout);
      if (minRelaysTimeout) clearTimeout(minRelaysTimeout);
    };
  }, [
    subscribe,
    defaultRelays,
    addRelay,
    readExploreCatalog,
    commitExploreCatalog,
  ]);

  const sorted = useMemo(() => {
    // CRITICAL: Ensure all repos have entity BEFORE sorting
    // Derive entity from ownerPubkey if missing
    const reposWithEntity = repos.map((r) => {
      if (!r.entity || r.entity === "user") {
        if (r.ownerPubkey && /^[0-9a-f]{64}$/i.test(r.ownerPubkey)) {
          const derivedEntity = nip19.npubEncode(r.ownerPubkey);
          return {
            ...r,
            entity: derivedEntity,
            entityDisplayName: r.entityDisplayName || derivedEntity,
          };
        }
      }
      return r;
    });

    // CRITICAL: Sort by latest event date (lastNostrEventCreatedAt) if available, otherwise by createdAt
    // This ensures repos with recent updates appear first
    // Note: lastNostrEventCreatedAt is in SECONDS (NIP-34 format), createdAt/updatedAt are in MILLISECONDS
    return reposWithEntity.slice().sort((a, b) => {
      const toMs = (r: (typeof reposWithEntity)[number]) => {
        const fromNostr = nostrTimestampToMs(
          (r as any).lastNostrEventCreatedAt
        );
        if (fromNostr > 0) return fromNostr;
        return (
          nostrTimestampToMs(r.updatedAt) ||
          nostrTimestampToMs(r.createdAt) ||
          0
        );
      };
      return toMs(b) - toMs(a);
    });
  }, [repos]);

  const filteredRepos = useMemo(() => {
    // Load list of locally-deleted repos (user deleted them, don't show)
    if (typeof window === "undefined") return repos;
    const deletedRepos = JSON.parse(
      localStorage.getItem("gittr_deleted_repos") || "[]"
    ) as Array<{ entity: string; repo: string; deletedAt: number }>;

    // Helper function to check if repo is deleted (robust matching)
    const isRepoDeleted = (r: any): boolean => {
      const repo = r.repo || r.slug || "";
      const entity = r.entity || "";

      // Check direct match by entity (npub format)
      const repoKey = `${entity}/${repo}`.toLowerCase();
      if (
        deletedRepos.some(
          (d) => `${d.entity}/${d.repo}`.toLowerCase() === repoKey
        )
      )
        return true;

      // Check by ownerPubkey (most reliable - handles npub entity mismatches)
      if (r.ownerPubkey && /^[0-9a-f]{64}$/i.test(r.ownerPubkey)) {
        const ownerPubkey = r.ownerPubkey.toLowerCase();
        // Check if deleted entity is npub for same pubkey
        if (
          deletedRepos.some((d) => {
            if (d.entity.startsWith("npub")) {
              try {
                const dDecoded = nip19.decode(d.entity);
                if (
                  dDecoded.type === "npub" &&
                  (dDecoded.data as string).toLowerCase() === ownerPubkey
                ) {
                  return d.repo.toLowerCase() === repo.toLowerCase();
                }
              } catch {}
            }
            return false;
          })
        )
          return true;
      }

      return false;
    };

    const result = sorted.filter((r) => {
      // CRITICAL: Exclude repos with "gittr.space" entity FIRST (corrupted repos)
      if (r.entity === "gittr.space") {
        exploreDebug(
          "❌ [Explore] Filtering out corrupted repo with entity 'gittr.space':",
          {
            repo: r.slug || r.repo,
            ownerPubkey: r.ownerPubkey?.slice(0, 16),
          }
        );
        return false; // Always exclude - these are corrupted
      }

      // CRITICAL: Entity must be npub format (starts with "npub")
      // Domain names are NOT valid entities
      if (r.entity && !r.entity.startsWith("npub")) {
        exploreDebug(
          "❌ [Explore] Filtering out repo with invalid entity format (not npub):",
          {
            repo: r.slug || r.repo,
            entity: r.entity,
            ownerPubkey: r.ownerPubkey?.slice(0, 16),
          }
        );
        return false; // Only npub format is valid
      }

      // CRITICAL: Filter out deleted repos FIRST (before other checks)
      // Skip if locally deleted (completely hidden from explore - no note shown)
      if (isRepoDeleted(r)) return false;

      // Skip if owner marked as deleted/archived on Nostr (completely hidden from explore - no note shown)
      if (r.deleted === true || r.archived === true) return false;

      // Filter out private repos unless current user has private access.
      // NOTE: Repos without publicRead field (undefined) are treated as public (default)
      if (r.publicRead === false) {
        const repoOwnerPubkey =
          r.ownerPubkey ||
          (r.entity && r.entity.startsWith("npub")
            ? (() => {
                try {
                  const decoded = nip19.decode(r.entity);
                  return decoded.type === "npub"
                    ? (decoded.data as string)
                    : null;
                } catch {
                  return null;
                }
              })()
            : null);
        const hasAccess = hasPrivateRepoAccess(
          pubkey,
          r.contributors || [],
          repoOwnerPubkey,
          (r as any).maintainers || []
        );
        if (!hasAccess) {
          return false; // Hide private repos from unauthorized users
        }
      }

      // NOTE: Don't filter out repos without files - they may be newly created or files may load later
      // Repos from Nostr may not have files in the initial event, but they're still valid repos

      // CRITICAL: Ensure entity is set - derive from ownerPubkey if missing
      // This handles repos from Nostr that might not have entity set initially
      // DON'T MUTATE - just check if entity is valid
      if (!r.entity || r.entity === "user") {
        if (r.ownerPubkey && /^[0-9a-f]{64}$/i.test(r.ownerPubkey)) {
          // Entity should have been derived in sorted useMemo - if not, skip this repo
          // (it will be fixed on next repos update, but we shouldn't mutate here)
          const derivedEntity = nip19.npubEncode(r.ownerPubkey);
          exploreDebug(
            "🔧 [Explore] Repo missing entity (should be fixed in sorted):",
            {
              repo: r.slug || r.repo,
              derivedEntity: derivedEntity.slice(0, 12) + "...",
              ownerPubkey: r.ownerPubkey.slice(0, 8),
            }
          );
          // Still allow it through - sorted should have fixed it
        } else {
          // No ownerPubkey - can't display this repo
          exploreDebug(
            "⚠️ [Explore] Filtered out repo (no entity, no ownerPubkey):",
            {
              slug: r.slug,
              repo: r.repo,
              name: r.name,
              hasOwnerPubkey: !!r.ownerPubkey,
              entity: r.entity,
            }
          );
          return false;
        }
      }

      // Filter out test/profile repos (common noise)
      const repoName = (r.repo || r.slug || r.name || "").toLowerCase();
      const isTestRepo =
        repoName.startsWith("test") ||
        repoName.includes("test-") ||
        repoName === "test";
      const isProfileRepo =
        repoName === "profile" ||
        repoName === "profile-page" ||
        repoName.includes("profile-");
      if (isTestRepo || isProfileRepo) {
        return false; // Filter out test/profile repos
      }

      // Filter by user/entity if user param provided
      if (userFilter) {
        const entity = r.entity || "";
        const entityDisplayName = r.entityDisplayName || "";
        const matches =
          entity.toLowerCase().includes(userFilter.toLowerCase()) ||
          entityDisplayName.toLowerCase().includes(userFilter.toLowerCase()) ||
          (userFilter.length >= 4 &&
            entity.toLowerCase().startsWith(userFilter.toLowerCase()));
        if (!matches) {
          exploreDebug(
            "🔍 [Explore] Filtered out repo (user filter):",
            r.slug || r.repo || r.name
          );
        }
        return matches;
      }

      // Filter by search query - search in multiple fields
      if (q) {
        const entity = r.entity || "";
        const repo = r.repo || r.slug || "";
        const name = r.name || repo;
        const description = (r.description || "").toLowerCase();
        const topics = (Array.isArray(r.topics) ? r.topics : [])
          .map((t: string) => String(t || "").toLowerCase())
          .join(" ");

        // Get owner name from metadata if available
        const ownerPubkey = getRepoOwnerPubkey(r as any, entity);
        let ownerName = "";
        if (ownerPubkey) {
          const normalizedPubkey = ownerPubkey.toLowerCase();
          const meta =
            ownerMetadata[normalizedPubkey] || ownerMetadata[ownerPubkey];
          if (meta) {
            ownerName = (meta.name || meta.display_name || "").toLowerCase();
          }
        }
        // Fallback to entityDisplayName if metadata not available
        if (!ownerName && r.entityDisplayName) {
          ownerName = r.entityDisplayName.toLowerCase();
        }

        // Search in: repo name, description, topics, entity/repo path, and owner name
        const matches =
          `${entity}/${repo}`.toLowerCase().includes(q) ||
          name.toLowerCase().includes(q) ||
          description.includes(q) ||
          topics.includes(q) ||
          ownerName.includes(q);
        if (!matches) {
          exploreDebug(
            "🔍 [Explore] Filtered out repo (search filter):",
            r.slug || r.repo || r.name
          );
        }
        return matches;
      }

      return true;
    });

    // Log filtering results for debugging - show foreign vs own repos
    const removed = sorted.length - result.length;
    const foreignRepos = pubkey
      ? result.filter((r) => r.ownerPubkey && r.ownerPubkey !== pubkey).length
      : result.length;
    const ownRepos = pubkey
      ? result.filter((r) => r.ownerPubkey === pubkey).length
      : 0;

    if (removed > 0 || result.length > 0) {
      exploreDebug("📊 [Explore] Filtered repos:", {
        total: sorted.length,
        filtered: result.length,
        removed: removed,
        foreignRepos: foreignRepos,
        ownRepos: ownRepos,
        fromNostr: foreignRepos > 0 ? "✅" : "❌",
      });
    }

    // CRITICAL: Deduplicate repos by ownerPubkey + normalized repo name
    // This ensures we only show one instance of each repo even if stored multiple times
    const normalizeRepoName = (name: string): string => {
      if (!name) return "";
      return name.toLowerCase().replace(/[_-]/g, "");
    };

    const dedupeMap = new Map<string, any>();
    const deduplicated: any[] = [];

    result.forEach((r: any) => {
      // Create unique key: ownerPubkey + normalized repo name
      const ownerKey = r.ownerPubkey
        ? r.ownerPubkey.toLowerCase()
        : (r.entity || "").toLowerCase();
      const repoNormalized = normalizeRepoName(
        r.repo || r.slug || r.name || ""
      );
      const uniqueKey = `${ownerKey}/${repoNormalized}`;

      const existing = dedupeMap.get(uniqueKey);
      if (!existing) {
        dedupeMap.set(uniqueKey, r);
        deduplicated.push(r);
      } else {
        // If duplicate found, keep the MOST RECENT one from Nostr (by updatedAt)
        // CRITICAL: No merging - just pick the newest version for proper versioning
        const existingUpdatedAt = existing.updatedAt || existing.createdAt || 0;
        const rUpdatedAt = r.updatedAt || r.createdAt || 0;

        if (rUpdatedAt > existingUpdatedAt) {
          // Replace with newer version
          const index = deduplicated.indexOf(existing);
          if (index >= 0) {
            exploreDebug(
              `🔄 [Explore] Replacing duplicate repo with newer version:`,
              {
                repo: r.repo || r.slug,
                owner: r.ownerPubkey?.slice(0, 8),
                existingUpdatedAt: new Date(existingUpdatedAt).toISOString(),
                newUpdatedAt: new Date(rUpdatedAt).toISOString(),
                existingEntity: existing.entity,
                newEntity: r.entity,
              }
            );
            deduplicated[index] = r;
            dedupeMap.set(uniqueKey, r);
          }
        } else {
          // Keep existing (it's newer or same)
          exploreDebug(
            `⏭️ [Explore] Keeping existing duplicate (newer or same):`,
            {
              repo: r.repo || r.slug,
              owner: r.ownerPubkey?.slice(0, 8),
              existingUpdatedAt: new Date(existingUpdatedAt).toISOString(),
              newUpdatedAt: new Date(rUpdatedAt).toISOString(),
            }
          );
        }
      }
    });

    if (deduplicated.length < result.length) {
      exploreDebug(
        `🔍 [Explore] Deduplicated repos: ${result.length} -> ${
          deduplicated.length
        } (removed ${result.length - deduplicated.length} duplicates)`
      );
    }

    return deduplicated;
  }, [sorted, q, userFilter, pubkey, ownerMetadata]); // Include ownerMetadata so filteredRepos updates when metadata loads

  // Valid cards only (same pre-filter as the grid), then Load-more window.
  const displayableRepos = useMemo(() => {
    return filteredRepos.filter((r) => {
      if (!r || !r.entity) return false;
      const entity = r.entity;
      const repo =
        r.repo ||
        (r.slug && typeof r.slug === "string" && r.slug.includes("/")
          ? r.slug.split("/")[1]
          : r.slug || "");
      const ownerPubkey = getRepoOwnerPubkey(r, entity);
      if (!ownerPubkey || !repo || !entity) return false;
      return Boolean(String(repo).trim());
    });
  }, [filteredRepos]);

  const visibleExploreRepos = displayableRepos.slice(0, visibleRepoCount);

  // Render repo cards directly (like homepage) - React will handle updates efficiently
  // Don't use useMemo here as it can cause issues with constant re-renders blocking clicks

  return (
    <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
      <h1 className="text-2xl font-bold mb-4">
        {userFilter
          ? `Repositories by ${userFilter}`
          : qRaw.trim()
          ? `Search: ${qRaw.trim()}`
          : "Repos"}
      </h1>
      {openRepoInNewTab && (
        <p className="text-sm text-gray-400 mb-4">
          Repo links open in a new tab so these results stay here.
        </p>
      )}
      {userFilter && (
        <p className="text-gray-400 mb-4">
          Showing public repositories for this user
        </p>
      )}
      {/* Debug panel - shows repo counts and allows cache clearing */}
      <div className="mb-4 p-3 border border-[#383B42] rounded bg-[#22262C] text-xs text-gray-400">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
          <div>
            Total repos:{" "}
            <span className="text-white font-bold">{repos.length}</span>
          </div>
          <div>
            Filtered:{" "}
            <span className="text-white font-bold">{filteredRepos.length}</span>
          </div>
          <div>
            Foreign:{" "}
            <span className="text-white font-bold">
              {pubkey
                ? filteredRepos.filter(
                    (r) => r.ownerPubkey && r.ownerPubkey !== pubkey
                  ).length
                : filteredRepos.length}
            </span>
          </div>
          <div>
            Syncing:{" "}
            <span className={syncing ? "text-yellow-400" : "text-green-400"}>
              {syncing ? "Yes" : "No"}
            </span>
          </div>
        </div>
        <button
          onClick={() => {
            if (
              confirm(
                "Clear localStorage cache and reload? This will force a fresh fetch from Nostr relays."
              )
            ) {
              localStorage.removeItem("gittr_repos");
              window.location.reload();
            }
          }}
          className="px-3 py-1 bg-[#22262C] hover:bg-[#383B42] border border-[#383B42] text-white rounded text-xs"
        >
          Clear Cache & Reload
        </button>
      </div>
      {/* Loading indicator */}
      {(isLoadingRepos || isLoadingMetadata) && (
        <div className="mb-4 p-4 border border-[#383B42] rounded bg-[#171B21]">
          <div className="flex items-center gap-2 text-gray-400">
            <div className="animate-spin h-4 w-4 border-2 border-purple-500 border-t-transparent rounded-full theme-border" />
            <span className="text-sm">
              {isLoadingRepos
                ? "Loading repositories..."
                : "Loading repository icons..."}
            </span>
          </div>
        </div>
      )}
      {syncing &&
        !isLoadingRepos &&
        typeof window !== "undefined" &&
        (() => {
          const repoCount =
            exploreCatalogRef.current?.length ?? loadStoredRepos().length;
          return (
            <div className="mb-4 p-4 border border-purple-500/50 rounded bg-[#171B21]">
              <div className="flex items-center gap-2 text-purple-400">
                <div className="animate-spin h-4 w-4 border-2 border-purple-500 border-t-transparent rounded-full theme-border" />
                <span className="text-sm">
                  🔄 Syncing from Nostr relays… ({repoCount.toLocaleString()}{" "}
                  cached repo rows in this browser from the network so far,{" "}
                  {defaultRelays?.length || 0} relays)
                </span>
              </div>
              <div className="text-xs text-gray-500 mt-2">
                This count is everything stored under gittr_repos (discovery
                cache), not only your repos. Trim with My Repositories → Flush
                others&apos; repos cache. The syncing indicator hides when
                enough relays respond or after 15 seconds; the subscription
                keeps listening.
              </div>
            </div>
          );
        })()}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
        {!isLoadingRepos &&
          visibleExploreRepos
            .map((r) => {
              // Use entity/repo structure if available, otherwise parse from slug
              const entity = r.entity!;
              // CRITICAL: For URLs, use slugified version (repo/slug/repositoryName)
              // For display, use original name (r.name)
              const repoForUrl =
                r.repo ||
                r.slug ||
                (r.slug && typeof r.slug === "string" && r.slug.includes("/")
                  ? r.slug.split("/")[1]
                  : r.slug || "");
              const repoDisplayName = r.name || repoForUrl; // CRITICAL: Use original name for display

              // CRITICAL: Resolve full owner pubkey and get display name from metadata
              const ownerPubkey = getRepoOwnerPubkey(r, entity);

              // CRITICAL: Use npub format for URL (GRASP protocol standard)
              // Convert ownerPubkey to npub format for consistent URLs
              let href: string;
              if (!ownerPubkey) {
                // This should never happen due to pre-filter, but TypeScript needs this check
                return null;
              }
              try {
                // Convert full pubkey to npub format
                const npub = nip19.npubEncode(ownerPubkey);
                const cleanRepo = String(repoForUrl).trim();
                if (!cleanRepo) {
                  // This should never happen due to pre-filter, but TypeScript needs this check
                  return null;
                }
                // CRITICAL: URL-encode repo name to handle spaces and special characters
                // e.g., "Swarm Relay" -> "Swarm%20Relay"
                href = `/${npub}/${encodeURIComponent(cleanRepo)}`;
              } catch (error) {
                console.error("⚠️ [Explore] Failed to encode npub:", {
                  ownerPubkey,
                  error,
                });
                // Fallback to entity format if npub encoding fails
                const cleanEntity = String(entity).trim();
                const cleanRepo = String(repoForUrl).trim();
                if (!cleanEntity || !cleanRepo) {
                  return null;
                }
                // CRITICAL: URL-encode repo name to handle spaces and special characters
                href = `/${cleanEntity}/${encodeURIComponent(cleanRepo)}`;
              }

              // CRITICAL: Use ownerMetadata directly (not ref) so React re-renders when metadata loads
              // React will handle re-renders efficiently - we want updates when metadata arrives!
              // CRITICAL: Always use getEntityDisplayName to show username, not shortened pubkey
              // CRITICAL: Normalize pubkey to lowercase for metadata lookup
              const normalizedOwnerPubkey =
                ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey)
                  ? ownerPubkey.toLowerCase()
                  : null;
              const entityDisplayName = normalizedOwnerPubkey
                ? getEntityDisplayName(
                    normalizedOwnerPubkey,
                    ownerMetadata,
                    entity
                  )
                : r.entityDisplayName || entity;

              // Resolve icons - always show fallback if icon fails (matches homepage pattern)
              let iconUrl: string | null = null;
              let ownerPicture: string | undefined = undefined;
              try {
                iconUrl = resolveRepoIcon(r);
                if (normalizedOwnerPubkey) {
                  // CRITICAL: Use normalized pubkey for metadata lookup
                  ownerPicture =
                    ownerMetadata[normalizedOwnerPubkey]?.picture ||
                    ownerMetadata[ownerPubkey]?.picture;
                }
              } catch (error) {
                console.error("⚠️ [Explore] Error resolving icons:", error);
              }

              // CRITICAL: Use unique key that matches deduplication logic
              // Normalize repo name to match deduplication (handles underscores vs hyphens, case-insensitive)
              const normalizeRepoName = (name: string): string => {
                if (!name) return "";
                return name.toLowerCase().replace(/[_-]/g, "");
              };
              const ownerKey = r.ownerPubkey
                ? r.ownerPubkey.toLowerCase()
                : (r.entity || "").toLowerCase();
              const repoNormalized = normalizeRepoName(
                r.repo || r.slug || r.name || ""
              );
              const uniqueKey = `${ownerKey}/${repoNormalized}`;

              // Skip rendering if href is invalid
              if (!href || href === "#") {
                return null;
              }

              return (
                <a
                  key={uniqueKey}
                  href={href}
                  target={openRepoInNewTab ? "_blank" : undefined}
                  rel={openRepoInNewTab ? "noopener noreferrer" : undefined}
                  onClick={
                    openRepoInNewTab
                      ? undefined
                      : (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          // Use window.location for navigation since Next.js Link isn't working
                          window.location.href = href;
                        }
                  }
                  className="border p-4 hover:bg-white/5 transition-colors block cursor-pointer rounded"
                >
                  <div className="flex items-center gap-3">
                    {/* Stacked icons: broken top layers hide; /logo.svg always underneath */}
                    <div className="flex-shrink-0">
                      <div className="relative h-6 w-6 rounded-full overflow-hidden bg-[#22262C]">
                        <img
                          src="/logo.svg"
                          alt=""
                          className="h-6 w-6 rounded-full object-contain absolute inset-0"
                          loading="lazy"
                        />
                        {ownerPicture ? (
                          <img
                            src={ownerPicture}
                            alt={entityDisplayName}
                            className="h-6 w-6 rounded-full object-cover absolute inset-0"
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        ) : null}
                        {iconUrl ? (
                          <img
                            src={iconUrl}
                            alt="repo"
                            className="h-6 w-6 rounded-full object-cover absolute inset-0"
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        ) : null}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xl font-semibold truncate">
                        {repoDisplayName}
                      </div>
                      <div className="opacity-70 truncate">
                        {entityDisplayName}/{repoDisplayName}
                      </div>
                      {(() => {
                        const cardDesc = repoCardDescriptionText(
                          r.description,
                          repoDisplayName
                        );
                        return cardDesc ? (
                          <div className="text-sm opacity-60 mt-1 truncate">
                            {cardDesc}
                          </div>
                        ) : null;
                      })()}
                    </div>
                  </div>
                </a>
              );
            })
            .filter(Boolean)}
        {!isLoadingRepos && (
          <LoadMoreButton
            visibleCount={visibleExploreRepos.length}
            totalCount={displayableRepos.length}
            pageSize={REPO_LIST_PAGE_SIZE}
            onLoadMore={() =>
              setVisibleRepoCount((n) => n + REPO_LIST_PAGE_SIZE)
            }
          />
        )}
        {!isLoadingRepos &&
          !syncing &&
          filteredRepos.length === 0 &&
          repos.length === 0 && (
            <div className="col-span-2 p-8 text-center text-gray-400">
              {userFilter ? (
                <p>No public repositories found for this user.</p>
              ) : q ? (
                <p>No repositories found matching &quot;{qRaw.trim()}&quot;.</p>
              ) : (
                <p>No repositories yet.</p>
              )}
            </div>
          )}
        {!isLoadingRepos &&
          !syncing &&
          filteredRepos.length === 0 &&
          repos.length > 0 &&
          (q || userFilter) && (
            <div className="col-span-2 p-8 text-center text-gray-400">
              {userFilter ? (
                <p>No public repositories found for this user.</p>
              ) : (
                <p>No repositories found matching &quot;{qRaw.trim()}&quot;.</p>
              )}
            </div>
          )}
        {!isLoadingRepos &&
          syncing &&
          filteredRepos.length === 0 &&
          repos.length === 0 && (
            <div className="col-span-2 p-8 text-center text-gray-400">
              <p>Looking up repositories on Nostr relays…</p>
            </div>
          )}
        {!isLoadingRepos &&
          syncing &&
          filteredRepos.length === 0 &&
          repos.length > 0 &&
          (q || userFilter) && (
            <div className="col-span-2 p-8 text-center text-gray-400">
              <p>
                Still syncing… {repos.length} repos loaded so far
                {q ? ` (no match for “${qRaw.trim()}” yet)` : ""}.
              </p>
            </div>
          )}
      </div>
    </div>
  );
}

export default function ExplorePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-black text-white p-8">Loading...</div>
      }
    >
      <ExplorePageContent />
    </Suspense>
  );
}
