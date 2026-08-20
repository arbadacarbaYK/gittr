"use client";

import {
  type MouseEvent,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadMoreButton } from "@/components/ui/load-more-button";
import { getUserActivities } from "@/lib/activity-tracking";
import {
  isPublisherBlocklisted,
  isRepoFromBlocklistedOwner,
} from "@/lib/moderation/publisher-blocklist";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { usableCloneUrls } from "@/lib/nostr/clone-url-quality";
import { KIND_REPOSITORY, KIND_REPOSITORY_NIP34 } from "@/lib/nostr/events";
import {
  formatPushRepoSuccessAlert,
  pushRepoToNostr,
} from "@/lib/nostr/push-repo-to-nostr";
import {
  CLONE_REPUBLISH_BADGE_LABEL,
  CLONE_REPUBLISH_BADGE_TITLE,
  cloneListNeedsRepublish,
  formatCloneRepublishRepoNames,
  repairHostOnlyCloneAnnounces,
} from "@/lib/nostr/repair-host-only-clones";
import { applyDeletionMarkersToRepoData } from "@/lib/nostr/repo-deleted";
import {
  NO_SIGNING_METHOD_MESSAGE,
  resolveNostrSigner,
} from "@/lib/nostr/signer";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import useSession from "@/lib/nostr/useSession";
import { ensurePushPaymentAuthorization } from "@/lib/payments/push-paywall";
import { isOwner } from "@/lib/repo-permissions";
import {
  clearDeletedRepoTombstones,
  isDeletedRepoTombstoned,
} from "@/lib/repos/deleted-repo-tombstones";
import { mergeProfileRepoList } from "@/lib/repos/merge-profile-repos";
import { repoCardDescriptionText } from "@/lib/repos/repo-about-text";
import {
  type StoredRepo,
  clearForeignReposFromStorage,
  clearOwnReposFromStorage,
  loadStoredRepos,
  previewForeignReposFlush,
  previewOwnReposFlush,
  saveStoredRepos,
} from "@/lib/repos/storage";
import { REPO_LIST_PAGE_SIZE } from "@/lib/ui/list-pagination";
import { coalesceMetadataList } from "@/lib/utils/coalesce-metadata-list";
import { formatDateTime24h } from "@/lib/utils/date-format";
import { getRepoStorageKey } from "@/lib/utils/entity-normalizer";
import { getRepoOwnerPubkey } from "@/lib/utils/entity-resolver";
import { nip34TagValuesFromRow } from "@/lib/utils/nip34-tag-values";
import { normalizeGithubSourceUrl } from "@/lib/utils/normalize-github-source-url";
import {
  isRepoCorrupted,
  validateRepoForForkOrSign,
} from "@/lib/utils/repo-corruption-check";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";
import {
  checkBridgeExists,
  getRepoStatus,
  getStatusBadgeStyle,
  isPublishedRepoStatus,
  repoHasNostrAnnounce,
  statusNeedsPushAction,
} from "@/lib/utils/repo-status";

import { Globe, Loader2, Lock, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import type { OnEvent } from "nostr-relaypool";
import { type Event as NostrEvent, nip19 } from "nostr-tools";

// Force dynamic rendering - this page uses localStorage which is not available during static generation
export const dynamic = "force-dynamic";

type Repo = {
  slug: string;
  entity?: string;
  entityDisplayName?: string;
  repo?: string;
  name: string;
  sourceUrl?: string;
  forkedFrom?: string;
  readme?: string;
  files?: Array<{ type: string; path: string; size?: number }>;
  stars?: number;
  forks?: number;
  languages?: Record<string, number>;
  topics?: string[];
  contributors?: Array<{
    pubkey?: string;
    name?: string;
    picture?: string;
    weight: number;
    githubLogin?: string;
  }>;
  defaultBranch?: string;
  branches?: Array<{ name: string; commit?: string }>;
  releases?: Array<{
    tag: string;
    name: string;
    description?: string;
    createdAt?: number;
  }>;
  logoUrl?: string;
  createdAt: number;
  publicRead?: boolean;
  ownerPubkey?: string; // Full 64-char pubkey of the repository owner
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
  clone?: string[];
  relays?: string[];
};

export default function RepositoriesPage() {
  // CRITICAL: Prevent SSR - return empty content during server-side rendering
  const [mounted, setMounted] = useState(false);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showClearForeignConfirm, setShowClearForeignConfirm] = useState(false);
  const [syncing, setSyncing] = useState(false);
  /** False until profile-repos / relay EOSE so we do not cache activity stubs as Local. */
  const [nostrOwnedListReady, setNostrOwnedListReady] = useState(false);
  const [pushingRepos, setPushingRepos] = useState<Set<string>>(new Set());
  const [repairingCloneUrls, setRepairingCloneUrls] = useState(false);
  const [clickedRepo, setClickedRepo] = useState<string | null>(null); // Track which repo is being navigated to
  const [visibleRepoCount, setVisibleRepoCount] = useState(REPO_LIST_PAGE_SIZE);
  const syncedFromActivitiesRef = useRef<Set<string>>(new Set()); // Track which repos we've already synced
  /** Session catalog so My Repositories stays usable when localStorage quota blocks writes. */
  const reposCatalogRef = useRef<Repo[] | null>(null);
  const router = useRouter();
  const { name: userName, isLoggedIn } = useSession();
  const { subscribe, publish, defaultRelays, pubkey, remoteSigner } =
    useNostrContext();

  const persistReposCatalog = useCallback(
    (list: Repo[]) => {
      reposCatalogRef.current = list;
      return saveStoredRepos(list as StoredRepo[], {
        quiet: true,
        preferOwnerPubkey: pubkey || undefined,
      });
    },
    [pubkey]
  );

  const foreignFlushPreview = useMemo(() => {
    if (!mounted || !pubkey) return null;
    return previewForeignReposFlush(pubkey, {
      preserveUnpushedEdits: true,
      preserveWithMetadata: false,
    });
  }, [mounted, pubkey, repos]);

  const ownFlushPreview = useMemo(() => {
    if (!mounted || !pubkey) return null;
    return previewOwnReposFlush(pubkey);
  }, [mounted, pubkey, repos]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setNostrOwnedListReady(false);
  }, [pubkey]);

  // Clear clicked repo state when navigation completes
  useEffect(() => {
    if (!clickedRepo) return;

    // Clear on window focus (navigation likely completed)
    const handleFocus = () => {
      setTimeout(() => setClickedRepo(null), 100);
    };

    // Clear on visibility change (tab switch)
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        setTimeout(() => setClickedRepo(null), 100);
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [clickedRepo]);

  // DEBUG: Log relay configuration
  useEffect(() => {
    console.log("🔌 Relay configuration:", {
      relayCount: defaultRelays.length,
      relays: defaultRelays,
      currentUserPubkey: pubkey ? pubkey.slice(0, 8) : "none (logged out)",
      isLoggedIn: !!pubkey,
    });
  }, [defaultRelays, pubkey]);

  // Get owner metadata for all repos (for profile pictures)
  // CRITICAL: Always use FULL pubkeys for metadata fetching, never 8-char prefixes
  // PERFORMANCE: Limit ownerPubkeys to first 100 unique owners to prevent excessive metadata requests
  // This prevents the page from making 600+ metadata requests which causes severe slowdown
  const ownerPubkeys = useMemo(() => {
    const pubkeys = new Set<string>();

    // Limit to first 200 repos to reduce metadata requests (still covers most visible repos)
    const reposToProcess = repos.slice(0, 200);

    for (const repo of reposToProcess) {
      if (!repo.entity || repo.entity === "user") continue;

      // Use getRepoOwnerPubkey to resolve full pubkey (handles all cases)
      const fullPubkey = getRepoOwnerPubkey(repo as any, repo.entity);
      if (fullPubkey && /^[0-9a-f]{64}$/i.test(fullPubkey)) {
        pubkeys.add(fullPubkey);
        // Stop if we've collected 100 unique pubkeys
        if (pubkeys.size >= 100) break;
      }
    }

    return Array.from(pubkeys);
  }, [repos]);

  const ownerMetadata = useContributorMetadata(ownerPubkeys);

  // Resolve missing ownerPubkeys from Nostr (runs in useEffect, not useMemo)
  // This ensures all repos have ownerPubkey set for proper metadata fetching
  useEffect(() => {
    if (typeof window === "undefined") return; // Don't run during SSR
    if (!subscribe || !defaultRelays || defaultRelays.length === 0) return;

    const reposToResolve = repos.filter((repo: any) => {
      if (!repo.entity || repo.entity === "user") return false;
      if (repo.ownerPubkey && /^[0-9a-f]{64}$/i.test(repo.ownerPubkey))
        return false; // Already resolved
      // Only try to resolve if entity is NOT npub format (backward compatibility for old repos)
      return !repo.entity.startsWith("npub");
    });

    if (reposToResolve.length === 0) return;

    let resolvedCount = 0;
    const unsub = subscribe(
      [{ kinds: [KIND_REPOSITORY, KIND_REPOSITORY_NIP34] }], // Support both gitnostr and NIP-34
      defaultRelays,
      (event, isAfterEose, relayURL) => {
        if (typeof window === "undefined") return; // Don't access localStorage during SSR
        if (
          ((event.kind as number) === KIND_REPOSITORY ||
            (event.kind as number) === KIND_REPOSITORY_NIP34) &&
          !isAfterEose &&
          /^[0-9a-f]{64}$/i.test(event.pubkey)
        ) {
          try {
            let repoData;
            try {
              repoData = JSON.parse(event.content);
            } catch (parseError) {
              console.warn(
                `[Repositories] Failed to parse repo event content as JSON:`,
                parseError,
                `Content: ${event.content?.substring(0, 50)}...`
              );
              return; // Skip this event if content is not valid JSON
            }

            // Find matching repo
            const matchingRepo = reposToResolve.find(
              (r: any) =>
                repoData.repositoryName === (r.repo || r.slug) &&
                event.pubkey.toLowerCase().startsWith(r.entity.toLowerCase())
            );

            if (matchingRepo) {
              // Update repo with ownerPubkey
              const allRepos = loadStoredRepos();
              const repoIndex = allRepos.findIndex(
                (r) =>
                  r.entity === matchingRepo.entity &&
                  (r.repo === matchingRepo.repo || r.slug === matchingRepo.slug)
              );

              if (
                repoIndex >= 0 &&
                allRepos[repoIndex] &&
                !allRepos[repoIndex].ownerPubkey
              ) {
                allRepos[repoIndex].ownerPubkey = event.pubkey;

                // Ensure owner is in contributors with full pubkey
                if (
                  !allRepos[repoIndex].contributors ||
                  !Array.isArray(allRepos[repoIndex].contributors)
                ) {
                  allRepos[repoIndex].contributors = [];
                }
                const ownerExists = allRepos[repoIndex].contributors.some(
                  (c: any) => c.pubkey === event.pubkey
                );
                if (!ownerExists) {
                  allRepos[repoIndex].contributors.unshift({
                    pubkey: event.pubkey,
                    weight: 100,
                    role: "owner",
                  });
                } else {
                  // Update existing owner contributor to ensure it has full pubkey
                  const ownerIndex = allRepos[repoIndex].contributors.findIndex(
                    (c: any) => c.pubkey === event.pubkey
                  );
                  if (ownerIndex >= 0) {
                    allRepos[repoIndex].contributors[ownerIndex] = {
                      ...allRepos[repoIndex].contributors[ownerIndex],
                      pubkey: event.pubkey,
                      weight: 100,
                      role: "owner",
                    };
                  }
                }

                persistReposCatalog(allRepos as Repo[]);
                setRepos([...allRepos] as Repo[]);
                resolvedCount++;

                // If all resolved, we can unsubscribe early
                if (resolvedCount >= reposToResolve.length && unsub) {
                  unsub();
                }
              }
            }
          } catch (e) {
            console.error("Error resolving ownerPubkey from Nostr:", e);
          }
        }
      },
      undefined,
      (_relayUrl: string, _minCreatedAt: number) => {
        // EOSE - done resolving
        if (unsub) unsub();
      }
    );

    // Timeout after 10 seconds
    const timeout = setTimeout(() => {
      if (unsub) unsub();
    }, 10000);

    return () => {
      clearTimeout(timeout);
      if (unsub) unsub();
    };
  }, [repos, subscribe, defaultRelays, persistReposCatalog]);

  // Helper removed - use getRepoOwnerPubkey from entity-resolver instead

  // Function to resolve repo icon with priority (memoized to react to ownerMetadata changes):
  // 1. Stored logoUrl (user-set in repo settings)
  // 2. Logo file from repo (if files list has logo.*)
  // 3. Owner Nostr profile picture (last fallback)
  const resolveRepoIcon = useCallback(
    (repo: Repo): string | null => {
      // Priority 1: Stored logoUrl
      if (repo.logoUrl && repo.logoUrl.trim().length > 0) {
        return repo.logoUrl;
      }

      // Priority 2: Logo file from repo (search all directories, handle multiple formats/names)
      if (repo.files && repo.files.length > 0) {
        // Find all potential icon files - search in ALL directories, handle various naming patterns:
        // 1. Files with "logo" in name (highest priority)
        // 2. Files named after the repo (e.g., "tides.png" for tides repo)
        // 3. Common icon names in root (repo.png, icon.png, etc.)
        // - Multiple formats: .png, .jpg, .jpeg, .gif, .webp, .svg, .ico
        const repoName = (repo.repo || repo.slug || repo.name || "")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
        const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"];

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
              aParts[aParts.length - 1]
                ?.replace(/\.[^.]+$/, "")
                .toLowerCase() || "";
            const bName =
              bParts[bParts.length - 1]
                ?.replace(/\.[^.]+$/, "")
                .toLowerCase() || "";
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
          if (!ownerRepo) {
            const ownerPubkey = repo.entity
              ? getRepoOwnerPubkey(repo as any, repo.entity)
              : null;
            const repoDataAny = repo as any;
            let repoName =
              repoDataAny?.repositoryName ||
              repo.repo ||
              repo.slug ||
              repo.name;

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

            if (
              ownerPubkey &&
              /^[0-9a-f]{64}$/i.test(ownerPubkey) &&
              repoName &&
              logoPath
            ) {
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
        const metadata = ownerMetadata[ownerPubkey];
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
    },
    [ownerMetadata]
  );

  // Load from localStorage first and listen for updates
  const loadRepos = useCallback(() => {
    if (typeof window === "undefined") {
      setRepos([]);
      return; // Don't access localStorage during SSR
    }
    try {
      // Prefer session catalog (survives quota-full writes) then localStorage.
      let list = reposCatalogRef.current ?? (loadStoredRepos() as Repo[]);

      // CRITICAL: Clean up corrupted repos on page load using general corruption check
      const beforeCount = list.length;
      list = list.filter((r: any) => {
        const repoForValidation = {
          repositoryName: r.repositoryName || r.repo || r.slug || r.name || "",
          entity: r.entity || "",
          ownerPubkey: r.ownerPubkey || "",
        };

        const eventId = r.nostrEventId || r.lastNostrEventId;

        if (isRepoCorrupted(repoForValidation, eventId)) {
          return false; // Remove corrupted repos
        }

        // Remove if entity is "gittr.space" or not npub format
        if (
          r.entity === "gittr.space" ||
          (r.entity && !r.entity.startsWith("npub"))
        ) {
          return false;
        }

        return true;
      });

      if (list.length < beforeCount) {
        const removed = beforeCount - list.length;
        console.log(
          `🧹 [Repositories] Cleaned up ${removed} corrupted repo(s) on page load`
        );
        persistReposCatalog(list);
      }

      // Debug: Check for tides repo (case-insensitive)
      const tidesRepo = list.find((r) => {
        const repoName = r.repo || r.slug || r.name || "";
        return repoName.toLowerCase() === "tides";
      });
      if (tidesRepo) {
        console.log("🔍 [Repositories] Found tides repo in localStorage:", {
          entity: tidesRepo.entity,
          entityLength: tidesRepo.entity?.length,
          entityIsNpub: tidesRepo.entity?.startsWith("npub"),
          repo: tidesRepo.repo,
          slug: tidesRepo.slug,
          name: tidesRepo.name,
          ownerPubkey: (tidesRepo as any).ownerPubkey?.slice(0, 16),
          ownerPubkeyLength: (tidesRepo as any).ownerPubkey?.length,
          ownerPubkeyIs64Char: (tidesRepo as any).ownerPubkey?.length === 64,
          hasContributors: !!(
            tidesRepo.contributors && Array.isArray(tidesRepo.contributors)
          ),
          contributorsCount: tidesRepo.contributors?.length || 0,
          ownerContributor: tidesRepo.contributors?.find(
            (c: any) => c.weight === 100
          ),
          currentUserPubkey: pubkey?.slice(0, 16),
          ownerMatches:
            pubkey && (tidesRepo as any).ownerPubkey
              ? (tidesRepo as any).ownerPubkey.toLowerCase() ===
                pubkey.toLowerCase()
              : false,
        });
      } else if (list.length === 0) {
        console.log(
          "⚠️ [Repositories] localStorage empty (Total repos: 0) — waiting for Nostr / profile-repos refill"
        );
      }

      // Load list of locally-deleted repos (user deleted them, don't re-add from Nostr)
      const deletedRepos = JSON.parse(
        localStorage.getItem("gittr_deleted_repos") || "[]"
      ) as Array<{
        entity: string;
        repo: string;
        deletedAt: number;
        ownerPubkey?: string;
      }>;
      const deletedReposSet = new Set(
        deletedRepos.map((d) => `${d.entity}/${d.repo}`.toLowerCase())
      );

      // AUTO-FIX: Delete test_repo_icon_check_fork
      const filtered = list.filter((r) => {
        const repoName = r.repo || r.slug || r.name || "";

        if (repoName === "test_repo_icon_check_fork") return false;

        // Filter out locally-deleted repos
        const entity = r.entity || "";
        const repo = r.repo || r.slug || "";
        const repoKey = `${entity}/${repo}`.toLowerCase();
        if (deletedReposSet.has(repoKey)) return false;

        // Filter out repos marked as deleted/archived on Nostr (owner's deletion request)
        if ((r as any).deleted === true || (r as any).archived === true)
          return false;

        if (isRepoFromBlocklistedOwner(r)) return false;

        return true;
      });

      // AUTO-FIX: Fix tides repo ownership if it belongs to current user
      const fixed = filtered.map((r) => {
        const repoName = r.repo || r.slug || r.name || "";

        // Fix tides repo if it exists and belongs to current user
        if (repoName === "tides" && pubkey) {
          // Check if it's actually the user's repo (has sourceUrl from GitHub import)
          if (
            (r as any).sourceUrl &&
            (r as any).sourceUrl.includes("github.com")
          ) {
            // This is an imported repo - ensure ownerPubkey is set correctly
            if (!(r as any).ownerPubkey || (r as any).ownerPubkey !== pubkey) {
              const updated = { ...r } as any;
              updated.ownerPubkey = pubkey;

              // Ensure owner is in contributors
              if (
                !updated.contributors ||
                !Array.isArray(updated.contributors)
              ) {
                updated.contributors = [];
              }
              const ownerExists = updated.contributors.some(
                (c: any) => c.pubkey === pubkey
              );
              if (!ownerExists) {
                updated.contributors.unshift({
                  pubkey: pubkey,
                  weight: 100,
                  role: "owner",
                });
              } else {
                updated.contributors = updated.contributors.map((c: any) =>
                  c.pubkey === pubkey ? { ...c, weight: 100, role: "owner" } : c
                );
              }

              // Ensure entity is npub format (GRASP protocol standard)
              if (!updated.entity || updated.entity === "user") {
                try {
                  updated.entity = nip19.npubEncode(pubkey);
                } catch (e) {
                  console.error("Failed to encode npub for entity:", e);
                }
              }

              console.log("🔧 Auto-fixed tides repo ownership");
              return updated;
            }
          }
        }

        return r;
      });

      // CRITICAL: Don't set entityDisplayName to current user's name - it should be the owner's display name
      // The actual owner's name will be fetched via useContributorMetadata hook
      // Only set entityDisplayName if it's missing (for backward compatibility)
      const updated = fixed.map((r) => {
        // If entityDisplayName is missing, set a temporary display name
        // This will be overridden by ownerMetadata when it loads
        if (!r.entityDisplayName) {
          // For npub format, use shortened version for display only
          // For full pubkey, encode to npub first, then shorten for display
          const displayName = r.entity?.startsWith("npub")
            ? r.entity.slice(0, 12) + "..." // Shortened npub for display
            : r.ownerPubkey && /^[0-9a-f]{64}$/i.test(r.ownerPubkey)
            ? nip19.npubEncode(r.ownerPubkey).slice(0, 12) + "..." // Encode to npub, then shorten
            : r.entity || "";
          return { ...r, entityDisplayName: displayName };
        }
        return r;
      });

      // Save if anything changed (never throw on quota — keep UI list)
      if (
        updated.length !== list.length ||
        updated.some((r, i) => JSON.stringify(r) !== JSON.stringify(list[i]))
      ) {
        persistReposCatalog(updated);
        if (updated.length !== list.length) {
          console.log(
            `✅ Auto-deleted test_repo_icon_check_fork (removed ${
              list.length - updated.length
            } instance(s))`
          );
        }
      } else {
        reposCatalogRef.current = updated;
      }
      setRepos(updated);
    } catch (e) {
      console.error("Error loading repos:", e);
      // Quota / parse failures must not blank My Repositories.
      try {
        const fallback =
          reposCatalogRef.current ?? (loadStoredRepos() as Repo[]);
        if (fallback.length > 0) {
          setRepos(fallback);
          return;
        }
      } catch {
        /* ignore */
      }
      // Keep whatever is already on screen (do not setRepos([])).
    }
  }, [pubkey, persistReposCatalog]);

  /** Same-tab LS writes never fire `storage` — debounce UI reload after Nostr merges. */
  const uiReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleUiReloadFromNostr = useCallback(() => {
    if (typeof window === "undefined") return;
    if (uiReloadTimerRef.current) clearTimeout(uiReloadTimerRef.current);
    uiReloadTimerRef.current = setTimeout(() => {
      loadRepos();
      try {
        window.dispatchEvent(new Event("gittr:repos-updated"));
      } catch {
        /* ignore */
      }
    }, 450);
  }, [loadRepos]);

  useEffect(() => {
    if (typeof window === "undefined") return; // Don't run during SSR
    loadRepos();

    // Listen for storage changes (when repos are created/imported in other tabs)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "gittr_repos") {
        console.log(
          "📦 [Repositories] Storage event detected, reloading repos..."
        );
        loadRepos();
      }
    };

    // Listen for custom events when repos are created/imported
    const handleRepoUpdate = (event: Event) => {
      const customEvent = event as CustomEvent;
      console.log(
        "📦 [Repositories] Custom event detected (repo-created/imported), reloading repos...",
        {
          hasDetail: !!customEvent?.detail,
          reposInDetail: customEvent?.detail?.repos?.length || 0,
        }
      );
      // Small delay to ensure localStorage is updated
      setTimeout(() => {
        loadRepos();
      }, 100);
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener(
      "gittr:repo-created",
      handleRepoUpdate as EventListener
    );
    window.addEventListener(
      "gittr:repo-imported",
      handleRepoUpdate as EventListener
    );

    // Bridge readiness so badges move off "Published, live soon" when bare repo exists
    let bridgeTimer: ReturnType<typeof setTimeout> | null = null;
    const checkBridges = () => {
      if (!pubkey) return;
      const all = loadStoredRepos();
      for (const r of all) {
        if (
          !(r as any).ownerPubkey ||
          (r as any).ownerPubkey.toLowerCase() !== pubkey.toLowerCase()
        ) {
          continue;
        }
        const hasEventId = !!(
          (r as any).nostrEventId ||
          (r as any).lastNostrEventId ||
          (r as any).stateEventId ||
          (r as any).lastStateEventId
        );
        const repoName =
          (r as any).repositoryName || r.repo || r.slug || r.name;
        const ownerPubkey = (r as any).ownerPubkey as string;
        if (
          hasEventId &&
          (r as any).bridgeProcessed !== true &&
          /^[0-9a-f]{64}$/i.test(ownerPubkey) &&
          repoName &&
          r.entity
        ) {
          void checkBridgeExists(ownerPubkey, repoName, r.entity).then(() => {
            loadRepos();
          });
        }
      }
    };
    const scheduleBridgeCheck = () => {
      if (bridgeTimer) clearTimeout(bridgeTimer);
      bridgeTimer = setTimeout(checkBridges, 400);
    };
    scheduleBridgeCheck();
    window.addEventListener("ngit:repo-created", scheduleBridgeCheck);
    window.addEventListener("ngit:repo-imported", scheduleBridgeCheck);

    return () => {
      if (bridgeTimer) clearTimeout(bridgeTimer);
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener(
        "gittr:repo-created",
        handleRepoUpdate as EventListener
      );
      window.removeEventListener(
        "gittr:repo-imported",
        handleRepoUpdate as EventListener
      );
      window.removeEventListener("ngit:repo-created", scheduleBridgeCheck);
      window.removeEventListener("ngit:repo-imported", scheduleBridgeCheck);
    };
  }, [loadRepos, pubkey]);

  // Sync this user's own repos from Nostr. Do NOT ingest everyone else's 30617s
  // into gittr_repos here — that refill undoes "Flush others" and the popup
  // counts never match the cards (Explore is the place for other people's repos).
  useEffect(() => {
    if (typeof window === "undefined") return; // Don't run during SSR
    if (!mounted) return; // Wait for client-side mount
    if (!subscribe || !defaultRelays || defaultRelays.length === 0) return;
    if (!pubkey) return;

    setSyncing(true);

    // CRITICAL: For NIP-34 replaceable events, collect ALL events per repo and pick the latest
    // Map: repoKey (pubkey + d tag) -> array of events
    const nip34EventsByRepo = new Map<
      string,
      Array<{ event: any; relayURL?: string }>
    >();

    const unsub = subscribe(
      [
        {
          kinds: [KIND_REPOSITORY, KIND_REPOSITORY_NIP34],
          authors: [pubkey],
          limit: 2000,
        },
      ],
      defaultRelays,
      (event, isAfterEose, relayURL) => {
        // CRITICAL: For NIP-34 replaceable events, collect ALL events first
        // Don't process immediately - wait for EOSE to pick the latest one
        if ((event.kind as number) === KIND_REPOSITORY_NIP34) {
          if (isPublisherBlocklisted(event.pubkey)) return;
          const dTag = event.tags?.find(
            (t: any) => Array.isArray(t) && t[0] === "d"
          );
          const repoName = dTag?.[1];
          if (repoName && event.pubkey) {
            const repoKey = `${event.pubkey}/${repoName}`;
            if (!nip34EventsByRepo.has(repoKey)) {
              nip34EventsByRepo.set(repoKey, []);
            }
            nip34EventsByRepo.get(repoKey)!.push({ event, relayURL });
            console.log(
              `📦 [Repos] Collected NIP-34 event for ${repoKey}: id=${event.id.slice(
                0,
                8
              )}..., created_at=${event.created_at}, total=${
                nip34EventsByRepo.get(repoKey)!.length
              }`
            );
            // Don't return - continue to process it normally too (for immediate display)
            // But we'll ensure the latest one is used when storing
          }
        }

        // Process ALL events, not just before EOSE (EOSE just means "end of stored events", but new events can still arrive)
        if (
          (event.kind as number) === KIND_REPOSITORY ||
          (event.kind as number) === KIND_REPOSITORY_NIP34
        ) {
          if (isPublisherBlocklisted(event.pubkey)) return;
          if (
            pubkey &&
            String(event.pubkey).toLowerCase() !== pubkey.toLowerCase()
          ) {
            return;
          }
          try {
            let repoData: any;
            if ((event.kind as number) === KIND_REPOSITORY_NIP34) {
              // NIP-34 format: Parse from tags
              repoData = {
                repositoryName: "",
                description: "",
                clone: [],
                relays: [],
                topics: [],
              };
              if (event.tags && Array.isArray(event.tags)) {
                for (const tag of event.tags) {
                  if (!Array.isArray(tag) || tag.length < 2) continue;
                  const tagName = tag[0];
                  const tagValue = tag[1];
                  if (tagName === "d") repoData.repositoryName = tagValue;
                  else if (tagName === "name" && !repoData.repositoryName)
                    repoData.repositoryName = tagValue;
                  else if (tagName === "description")
                    repoData.description = tagValue;
                  else if (tagName === "clone" && tagValue)
                    repoData.clone.push(tagValue);
                  else if (tagName === "relays" && tagValue) {
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
                        if (!repoData.relays.includes(normalized)) {
                          repoData.relays.push(normalized);
                        }
                      });
                    } else {
                      // Single relay per tag - add directly
                      const normalized =
                        tagValue.startsWith("wss://") ||
                        tagValue.startsWith("ws://")
                          ? tagValue
                          : `wss://${tagValue}`;
                      if (!repoData.relays.includes(normalized)) {
                        repoData.relays.push(normalized);
                      }
                    }
                  } else if (tagName === "t" && tagValue)
                    repoData.topics.push(tagValue);
                  else if (tagName === "r" && tagValue && tag[2] === "euc") {
                    // Extract earliest unique commit from "r" tag with "euc" marker
                    repoData.earliestUniqueCommit = tagValue;
                  } else if (tagName === "public-read" && tagValue) {
                    // gittr extension on 30617 — required so Private survives localStorage clear
                    repoData.publicRead = tagValue.toLowerCase() !== "false";
                  } else if (tagName === "public-write" && tagValue) {
                    repoData.publicWrite = tagValue.toLowerCase() === "true";
                  }
                }
              }
              // Missing privacy tags => public read (legacy announcements)
              if (repoData.publicRead === undefined) {
                repoData.publicRead = true;
              }
              if (repoData.publicWrite === undefined) {
                repoData.publicWrite = false;
              }
              // gittr soft-delete on 30617 (content JSON and/or tags)
              applyDeletionMarkersToRepoData(repoData, event);
            } else {
              try {
                repoData = JSON.parse(event.content);
              } catch (parseError) {
                console.warn(
                  `[Repositories] Failed to parse repo event content as JSON:`,
                  parseError,
                  `Content: ${event.content?.substring(0, 50)}...`
                );
                return; // Skip this event if content is not valid JSON
              }
            }

            // Ensure repoData is defined before proceeding
            if (!repoData) {
              console.warn(
                `[Repositories] repoData is undefined after parsing`
              );
              return;
            }

            // Ensure repositoryName exists (required field)
            if (!repoData.repositoryName) {
              console.warn(
                `[Repositories] repositoryName is missing from event`,
                {
                  kind: event.kind,
                  eventId: event.id?.slice(0, 16),
                  hasContent: !!event.content,
                  hasTags: !!event.tags,
                }
              );
              return; // Skip events without repositoryName
            }

            // GRASP-01: Parse clone, relays, topics, contributors, source, and forkedFrom from event.tags
            const cloneTags: string[] = [];
            const relaysTags: string[] = [];
            const topicTags: string[] = [];
            const contributorTags: Array<{
              pubkey: string;
              weight: number;
              role?: string;
            }> = [];
            let sourceUrlFromTag: string | undefined;
            let forkedFromFromTag: string | undefined;

            if (event.tags && Array.isArray(event.tags)) {
              for (const tag of event.tags) {
                if (Array.isArray(tag) && tag.length >= 2) {
                  const tagName = tag[0];
                  const tagValue = tag[1];

                  if (tagName === "clone") {
                    for (const v of nip34TagValuesFromRow(tag)) {
                      cloneTags.push(v);
                    }
                  } else if (tagName === "relays") {
                    for (const v of nip34TagValuesFromRow(tag)) {
                      relaysTags.push(v);
                    }
                  } else if (tagName === "t" && tagValue) {
                    topicTags.push(tagValue);
                  } else if (tagName === "source" && tagValue) {
                    // Extract sourceUrl from "source" tag (used in push-repo-to-nostr.ts)
                    sourceUrlFromTag = tagValue;
                  } else if (tagName === "forkedFrom" && tagValue) {
                    // Extract forkedFrom from "forkedFrom" tag
                    forkedFromFromTag = tagValue;
                  } else if (tagName === "p") {
                    // Extract contributors from "p" tags: ["p", pubkey, weight, role]
                    const pubkey = tagValue;
                    const weight =
                      tag.length > 2 ? parseInt(tag[2] as string) || 0 : 0;
                    const role =
                      tag.length > 3 ? (tag[3] as string) : undefined;

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

            // DEBUG: Log ALL repos received (for debugging)
            const isForeignRepo = pubkey && event.pubkey !== pubkey;
            const isOwnRepo = pubkey && event.pubkey === pubkey;
            console.log("📦 Repo event received:", {
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

            if (typeof window === "undefined") return; // Don't access localStorage during SSR
            // Load existing repos
            const existingRepos = JSON.parse(
              localStorage.getItem("gittr_repos") || "[]"
            ) as Repo[];

            // Check if this repo was locally deleted (user deleted it, don't re-add from Nostr)
            const deletedRepos = JSON.parse(
              localStorage.getItem("gittr_deleted_repos") || "[]"
            ) as Array<{
              entity: string;
              repo: string;
              deletedAt: number;
              ownerPubkey?: string;
            }>;
            // CRITICAL: Use npub format for entity (GRASP protocol standard)
            let entity: string;
            try {
              entity = nip19.npubEncode(event.pubkey);
            } catch {
              entity = event.pubkey; // Fallback to full pubkey if encoding fails
            }
            const repoKey =
              `${entity}/${repoData.repositoryName}`.toLowerCase();

            // CRITICAL: Respect deletion events from Nostr (both our own and others')
            // If repo owner marked it as deleted/archived on Nostr, respect it and don't re-add
            // This is the authoritative source - if owner says it's deleted, respect it
            if (repoData.deleted === true || repoData.archived === true) {
              console.log(
                `⏭️ Skipping owner-deleted/archived repo from Nostr: ${repoKey}`,
                {
                  deleted: repoData.deleted,
                  archived: repoData.archived,
                  owner: entity.slice(0, 12) + "...",
                }
              );
              // Also mark in deletion list as a safety mechanism (prevents re-adding if event hasn't propagated)
              const deletedReposForMarking = JSON.parse(
                localStorage.getItem("gittr_deleted_repos") || "[]"
              ) as Array<{
                entity: string;
                repo: string;
                deletedAt: number;
                ownerPubkey?: string;
              }>;
              const deletedRepoKey =
                `${entity}/${repoData.repositoryName}`.toLowerCase();
              if (
                !deletedReposForMarking.some((d) => {
                  // Check by ownerPubkey field (most reliable)
                  if (
                    d.ownerPubkey &&
                    d.ownerPubkey.toLowerCase() === event.pubkey.toLowerCase()
                  ) {
                    return (
                      d.repo.toLowerCase() ===
                      repoData.repositoryName.toLowerCase()
                    );
                  }
                  const dKey = `${d.entity}/${d.repo}`.toLowerCase();
                  if (dKey === deletedRepoKey) return true;
                  // Also check by ownerPubkey via npub decoding
                  if (d.entity.startsWith("npub")) {
                    try {
                      const dDecoded = nip19.decode(d.entity);
                      if (
                        dDecoded.type === "npub" &&
                        (dDecoded.data as string).toLowerCase() ===
                          event.pubkey.toLowerCase()
                      ) {
                        return (
                          d.repo.toLowerCase() ===
                          repoData.repositoryName.toLowerCase()
                        );
                      }
                    } catch {}
                  }
                  return false;
                })
              ) {
                deletedReposForMarking.push({
                  entity: entity,
                  repo: repoData.repositoryName,
                  deletedAt: Date.now(),
                  ownerPubkey: event.pubkey, // Store ownerPubkey for robust matching
                });
                localStorage.setItem(
                  "gittr_deleted_repos",
                  JSON.stringify(deletedReposForMarking)
                );
              }
              return;
            }

            // Check if repo was locally deleted (user deleted it themselves, before deletion event propagated)
            const isDeleted = deletedRepos.some((d) => {
              // Priority 1: Check by ownerPubkey field (most reliable - works across all entity formats)
              if (
                d.ownerPubkey &&
                d.ownerPubkey.toLowerCase() === event.pubkey.toLowerCase()
              ) {
                return (
                  d.repo.toLowerCase() === repoData.repositoryName.toLowerCase()
                );
              }
              // Priority 2: Check by npub entity
              const dEntityMatch =
                d.entity.toLowerCase() === entity.toLowerCase();
              if (
                dEntityMatch &&
                d.repo.toLowerCase() === repoData.repositoryName.toLowerCase()
              )
                return true;
              // Priority 3: Check if deleted entity is npub for same pubkey
              if (d.entity.startsWith("npub")) {
                try {
                  const dDecoded = nip19.decode(d.entity);
                  if (
                    dDecoded.type === "npub" &&
                    (dDecoded.data as string).toLowerCase() ===
                      event.pubkey.toLowerCase()
                  ) {
                    return (
                      d.repo.toLowerCase() ===
                      repoData.repositoryName.toLowerCase()
                    );
                  }
                } catch {}
              }
              // Priority 4: Check by ownerPubkey directly (if deleted entry has pubkey format in entity field)
              if (
                d.entity &&
                /^[0-9a-f]{64}$/i.test(d.entity) &&
                d.entity.toLowerCase() === event.pubkey.toLowerCase()
              ) {
                return (
                  d.repo.toLowerCase() === repoData.repositoryName.toLowerCase()
                );
              }
              return false;
            });

            // Local tombstone from a prior Delete/flush — only a *newer* 30617
            // (created after deletedAt) may reopen. Older relay events stay hidden.
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
                console.log(
                  `⏭️ [Sync] Keeping flush/delete tombstone for ${repoKey} (announcement not newer than local hide)`
                );
                return;
              }
              console.log(
                `♻️ [Sync] Live announcement newer than tombstone for ${repoKey} — cleared ${cleared}, accepting`
              );
            }

            // Check if this repo already exists (same semantics as findRepoByEntityAndName)
            const existingRepoMatch = findRepoByEntityAndName(
              existingRepos,
              entity,
              repoData.repositoryName
            );
            const existingIndex = existingRepoMatch
              ? existingRepos.indexOf(existingRepoMatch)
              : -1;

            // The actual owner's name will be fetched via useContributorMetadata hook
            const entityDisplayName = entity; // Will be overridden by ownerMetadata when it loads
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
              console.log(
                `📋 [Repos] Extracted ${contributors.length} contributors from "p" tags`
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
              console.log(
                `📋 [Repos] Merged ${repoData.contributors.length} contributors from JSON content`
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
                if (existingIndex >= 0 && contributors[existingIndex]) {
                  // Merge: keep pubkey/weight/role from tags/content, but preserve name/picture from existing
                  contributors[existingIndex] = {
                    ...contributors[existingIndex],
                    weight: contributors[existingIndex].weight || 0,
                    name:
                      existingContributor.name ||
                      contributors[existingIndex].name,
                    picture:
                      existingContributor.picture ||
                      contributors[existingIndex].picture,
                    githubLogin:
                      existingContributor.githubLogin ||
                      contributors[existingIndex].githubLogin,
                  };
                } else {
                  // Add contributor that exists locally but not in event
                  contributors.push(existingContributor);
                }
              }
            }

            // CRITICAL: Always ensure owner (event.pubkey) is in contributors with weight 100 and role owner
            const ownerInContributors = contributors.some(
              (c: any) =>
                c.pubkey &&
                c.pubkey.toLowerCase() === event.pubkey.toLowerCase()
            );
            if (!ownerInContributors) {
              contributors = [
                { pubkey: event.pubkey, weight: 100, role: "owner" },
                ...contributors,
              ];
            } else {
              // Ensure owner has weight 100 and role owner (override any other values)
              contributors = contributors.map((c: any) =>
                c.pubkey &&
                c.pubkey.toLowerCase() === event.pubkey.toLowerCase()
                  ? { ...c, weight: 100, role: "owner" }
                  : c
              );
            }

            console.log(
              `✅ [Repos] Final contributors list: ${contributors.length} total`,
              {
                owners: contributors.filter(
                  (c) => c.weight === 100 || c.role === "owner"
                ).length,
                maintainers: contributors.filter(
                  (c) =>
                    c.role === "maintainer" ||
                    (c.weight >= 50 && c.weight < 100)
                ).length,
                contributors: contributors.filter(
                  (c) =>
                    c.role === "contributor" || (c.weight > 0 && c.weight < 50)
                ).length,
              }
            );

            // CRITICAL: Set sourceUrl from clone URLs if sourceUrl is missing
            // Priority 1: Use sourceUrl from event tags ("source" tag), event content, or existing repo
            let finalSourceUrl =
              sourceUrlFromTag || repoData.sourceUrl || existingRepo?.sourceUrl;
            // Priority 2: If no sourceUrl, try to find GitHub/GitLab/Codeberg clone URL (preferred)
            // CRITICAL: Only use GitHub/GitLab/Codeberg URLs as sourceUrl - Nostr git servers are handled by multi-source fetcher
            if (!finalSourceUrl && cloneTags.length > 0) {
              const gitCloneUrl = cloneTags.find(
                (url: string) =>
                  url.includes("github.com") ||
                  url.includes("gitlab.com") ||
                  url.includes("codeberg.org")
              );
              if (gitCloneUrl) {
                finalSourceUrl = gitCloneUrl.replace(/\.git$/, "");
              }
            }
            // Also check existing repo's clone URLs if still no sourceUrl
            if (
              !finalSourceUrl &&
              existingRepo?.clone &&
              Array.isArray(existingRepo.clone) &&
              existingRepo.clone.length > 0
            ) {
              const gitCloneUrl = existingRepo.clone.find(
                (url: string) =>
                  url.includes("github.com") ||
                  url.includes("gitlab.com") ||
                  url.includes("codeberg.org")
              );
              if (gitCloneUrl) {
                finalSourceUrl = gitCloneUrl.replace(/\.git$/, "");
              }
            }
            // Note: We don't use Nostr git server URLs (gittr.space, etc.) as sourceUrl
            // Those are handled by the multi-source fetcher or git-nostr-bridge

            if (finalSourceUrl && typeof finalSourceUrl === "string") {
              finalSourceUrl = normalizeGithubSourceUrl(finalSourceUrl);
            }

            // CRITICAL: Validate entity is not a domain name
            if (
              !entity ||
              entity === "gittr.space" ||
              (entity.includes(".") && !entity.startsWith("npub"))
            ) {
              console.error(
                "❌ [Repositories] Invalid entity detected from Nostr event, skipping:",
                {
                  entity,
                  eventId: event.id.slice(0, 8),
                  repoName: repoData.repositoryName,
                  eventPubkey: event.pubkey.slice(0, 8),
                }
              );
              return; // Skip this repo - invalid entity
            }

            // CRITICAL: Validate repositoryName matches what we expect (prevent name corruption)
            if (
              repoData.repositoryName &&
              repoData.repositoryName.toLowerCase() === "tides" &&
              repoData.repositoryName !== repoData.repositoryName
            ) {
              console.error(
                "❌ [Repositories] Repository name mismatch detected, skipping:",
                {
                  repositoryName: repoData.repositoryName,
                  eventId: event.id.slice(0, 8),
                  entity,
                  eventPubkey: event.pubkey.slice(0, 8),
                }
              );
              return; // Skip this repo - name corruption detected
            }

            // CRITICAL: Never use entity from repoData - it might be corrupted (e.g., "gittr.space")
            // Always use entity derived from event.pubkey (the actual owner)
            // Remove any entity field from repoData if it exists
            // This prevents other Nostr clients from publishing corrupted entity values
            if (repoData.entity) {
              console.warn(
                "⚠️ [Repositories] Ignoring entity from repoData (using event.pubkey instead):",
                {
                  repoDataEntity: repoData.entity,
                  correctEntity: entity,
                  eventId: event.id.slice(0, 8),
                }
              );
            }
            const { entity: _, ...cleanRepoData } = repoData;

            // Merge ALL metadata from Nostr event
            const repo: any = {
              slug: repoData.repositoryName,
              entity: entity, // ALWAYS use npub format derived from event.pubkey (GRASP protocol standard)
              entityDisplayName: entityDisplayName, // Will be overridden by ownerMetadata when fetched
              repo: repoData.repositoryName,
              // CRITICAL: Use human-readable name from event content if available, otherwise use repositoryName
              name: repoData.name || repoData.repositoryName,
              // CRITICAL: Set ownerPubkey to event.pubkey (the actual owner, not current user!)
              ownerPubkey: event.pubkey,
              // Mark as synced from Nostr = "live"
              syncedFromNostr: true,
              nostrEventId: event.id,
              description: repoData.description,
              // Sync ALL extended metadata
              sourceUrl:
                finalSourceUrl ||
                sourceUrlFromTag ||
                repoData.sourceUrl ||
                undefined,
              // Event tags are source of truth — do not keep a stale forkedFrom
              // from a previous same-name row after delete+recreate.
              forkedFrom: forkedFromFromTag || repoData.forkedFrom || undefined,
              readme:
                repoData.readme !== undefined
                  ? repoData.readme
                  : existingRepo?.readme !== undefined
                  ? existingRepo.readme
                  : "",
              files:
                repoData.files !== undefined
                  ? repoData.files
                  : existingRepo?.files !== undefined
                  ? existingRepo.files
                  : [],
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
              contributors: contributors, // Include owner with weight 100 and full pubkey
              defaultBranch:
                repoData.defaultBranch || existingRepo?.defaultBranch,
              branches: repoData.branches || existingRepo?.branches,
              releases: coalesceMetadataList(
                repoData.releases,
                existingRepo?.releases
              ),
              logoUrl: existingRepo?.logoUrl, // Preserve local-only
              createdAt: existingRepo?.createdAt || event.created_at * 1000,
              // CRITICAL: Preserve deletion markers from Nostr (owner's deletion request)
              deleted: repoData.deleted,
              archived: repoData.archived,
              // CRITICAL: Preserve privacy status from NIP-34 tags
              publicRead:
                repoData.publicRead !== undefined
                  ? repoData.publicRead
                  : (existingRepo as any)?.publicRead !== undefined
                  ? (existingRepo as any).publicRead
                  : true,
              publicWrite:
                repoData.publicWrite !== undefined
                  ? repoData.publicWrite
                  : (existingRepo as any)?.publicWrite !== undefined
                  ? (existingRepo as any).publicWrite
                  : false,
              // Repository links
              links: repoData.links || existingRepo?.links,
              // GRASP-01: Store clone and relays tags from event.tags
              // Keep unusable clones (host-only / localhost) so My Repositories can
              // show "Please republish". Discovery (HP/explore) filters separately.
              // Prefer existing usable clones over a newer event that only has
              // host-only / empty clones (relay lag after a successful republish).
              clone: (() => {
                const fromEvent =
                  cloneTags.length > 0
                    ? cloneTags.filter((url: string) => !!url?.trim())
                    : (repoData.clone || []).filter(
                        (url: string) => !!url?.trim()
                      );
                const existing = (existingRepo?.clone || []).filter(
                  (url: string) => !!url?.trim()
                );
                if (
                  usableCloneUrls(fromEvent).length === 0 &&
                  usableCloneUrls(existing).length > 0
                ) {
                  return existing;
                }
                if (fromEvent.length > 0) return fromEvent;
                return existing;
              })(),
              relays:
                relaysTags.length > 0
                  ? relaysTags
                  : repoData.relays || existingRepo?.relays,
            };

            // Merge with existing data
            // CRITICAL: Always update ownerPubkey even for existing repos (fixes repos synced before the fix)
            if (existingIndex >= 0 && existingRepos[existingIndex]) {
              // CRITICAL: For NIP-34 replaceable events, only update if this event is newer
              // Check if existing repo has a newer event already stored
              // NIP-34 uses Unix timestamps in SECONDS - compare in seconds
              const existingRepo = existingRepos[existingIndex];
              const existingEventCreatedAtSeconds =
                (existingRepo as any)?.lastNostrEventCreatedAt ||
                ((existingRepo as any)?.updatedAt
                  ? Math.floor((existingRepo as any).updatedAt / 1000)
                  : 0);
              const newEventCreatedAtSeconds = event.created_at; // Already in seconds (Nostr format)

              if (
                (event.kind as number) === KIND_REPOSITORY_NIP34 &&
                newEventCreatedAtSeconds <= existingEventCreatedAtSeconds
              ) {
                console.log(
                  `⏭️ [Repos] Skipping older NIP-34 event: existing=${new Date(
                    existingEventCreatedAtSeconds * 1000
                  ).toISOString()}, new=${new Date(
                    newEventCreatedAtSeconds * 1000
                  ).toISOString()}`
                );
                return; // Skip older events
              }

              // CRITICAL: Validate existing repo entity is not corrupted
              const existingEntity = existingRepos[existingIndex].entity;
              if (
                existingEntity === "gittr.space" ||
                (!existingEntity?.startsWith("npub") &&
                  existingEntity?.includes("."))
              ) {
                console.error(
                  "❌ [Repositories] Existing repo has corrupted entity, fixing:",
                  {
                    oldEntity: existingEntity,
                    newEntity: entity,
                    repoName: repoData.repositoryName,
                    eventId: event.id.slice(0, 8),
                  }
                );
                // Replace corrupted entity with correct one
                repo.entity = entity;
              }

              // CRITICAL: Validate BEFORE updating existing repo using centralized corruption check
              const repoToValidate = {
                entity,
                repositoryName: repoData.repositoryName,
                repo: repoData.repositoryName,
                slug: repoData.repositoryName,
                name: repoData.name || repoData.repositoryName,
                ownerPubkey: event.pubkey,
              };

              if (isRepoCorrupted(repoToValidate, event.id)) {
                console.error(
                  "❌ [Repositories] Blocking corrupted repo update:",
                  {
                    eventId: event.id,
                    repoName: repoData.repositoryName,
                    ownerPubkey: event.pubkey.slice(0, 8),
                    entity,
                  }
                );
                return; // Don't update with corrupted repos
              }

              // CRITICAL: Preserve existing sourceUrl if new one is not available
              // This prevents losing GitHub/GitLab/Codeberg sourceUrl when syncing from Nostr
              const preservedSourceUrl =
                repo.sourceUrl || existingRepos[existingIndex].sourceUrl;

              // CRITICAL: ALWAYS use entity derived from event.pubkey (never trust existing repo.entity or repoData.entity)
              // This prevents corruption where entity might be "gittr.space" or other invalid values
              // The entity variable is derived from event.pubkey at line 789-794, which is the authoritative source
              const correctEntity = entity; // Always use the entity derived from event.pubkey

              existingRepos[existingIndex] = {
                ...existingRepos[existingIndex],
                ...repo,
                // CRITICAL: ALWAYS overwrite entity with the one derived from event.pubkey
                // Never preserve existing entity - it might be corrupted ("gittr.space", etc.)
                entity: correctEntity,
                // Preserve sourceUrl if it was set (don't overwrite with undefined)
                sourceUrl: preservedSourceUrl,
                // Force update ownerPubkey and contributors to fix old repos
                ownerPubkey: event.pubkey,
                contributors: contributors,
                // Store latest event ID and created_at
                // CRITICAL: Store in SECONDS (Nostr format) - not milliseconds
                nostrEventId: event.id,
                lastNostrEventId: event.id,
                lastNostrEventCreatedAt: event.created_at, // Store in seconds (NIP-34 format)
                // Extract earliest unique commit from "r" tag if present (may not be in Repo type but exists at runtime)
                ...(repoData.earliestUniqueCommit ||
                (existingRepos[existingIndex] as any)?.earliestUniqueCommit
                  ? {
                      earliestUniqueCommit:
                        repoData.earliestUniqueCommit ||
                        (existingRepos[existingIndex] as any)
                          ?.earliestUniqueCommit,
                    }
                  : {}),
              };
            } else {
              // New repo - validate BEFORE storing using general corruption check
              const repoForValidation = {
                repositoryName: repoData.repositoryName,
                entity: entity,
                ownerPubkey: event.pubkey,
              };

              if (isRepoCorrupted(repoForValidation, event.id)) {
                // Silently reject - don't spam console for corrupted repos
                return; // Don't store corrupted repos
              }

              // Store with event ID and created_at
              // CRITICAL: Store in SECONDS (NIP-34 format) - not milliseconds
              const newRepo = {
                ...repo,
                nostrEventId: event.id,
                lastNostrEventId: event.id,
                lastNostrEventCreatedAt: event.created_at, // Store in seconds (NIP-34 format)
                earliestUniqueCommit: repoData.earliestUniqueCommit,
              };
              existingRepos.push(newRepo);
            }

            // CRITICAL: Clean up corrupted repos using general corruption check
            const cleanedRepos = existingRepos.filter((r: any) => {
              // Use general corruption check - no special handling for specific repo names
              const repoForValidation = {
                repositoryName:
                  r.repositoryName || r.repo || r.slug || r.name || "",
                entity: r.entity || "",
                ownerPubkey: r.ownerPubkey || "",
              };

              const eventId = r.nostrEventId || r.lastNostrEventId;

              if (isRepoCorrupted(repoForValidation, eventId)) {
                // Silently remove - don't spam console
                return false; // Remove corrupted repos
              }

              return true;
            });

            // Log how many were removed
            const removedCount = existingRepos.length - cleanedRepos.length;
            if (removedCount > 0) {
              console.log(
                `🧹 [Repositories] Cleaned up ${removedCount} repo(s) with corrupted/invalid entity`
              );
            }

            // Persist without throwing on quota; session catalog keeps UI usable.
            persistReposCatalog(cleanedRepos);

            // Debounced React refresh (same-tab storage events do not fire).
            scheduleUiReloadFromNostr();
          } catch (error) {
            console.error("Failed to process repo event from Nostr:", error);
          }
        }

        // EOSE is called per relay - don't set syncing=false here, wait for all relays
        // We'll track EOSE separately and only mark as complete when all relays are done
        if (isAfterEose) {
          // DEBUG: Log summary after EOSE from this relay
          if (typeof window === "undefined") return; // Don't access localStorage during SSR
          const allRepos = JSON.parse(
            localStorage.getItem("gittr_repos") || "[]"
          );
          const foreignRepos = pubkey
            ? allRepos.filter(
                (r: any) => r.ownerPubkey && r.ownerPubkey !== pubkey
              )
            : allRepos;
          const foreignReposWithFiles = foreignRepos.filter(
            (r: any) => r.files && r.files.length > 0
          );
          const reposWithOwnerPubkeys = allRepos.filter(
            (r: any) => r.ownerPubkey && /^[0-9a-f]{64}$/i.test(r.ownerPubkey)
          ).length;
          console.log("📊 EOSE from relay:", {
            relay: relayURL,
            totalRepos: allRepos.length,
            foreignRepos: foreignRepos.length,
            foreignReposWithFiles: foreignReposWithFiles.length,
            reposWithOwnerPubkeys: reposWithOwnerPubkeys,
            currentUserPubkey: pubkey ? pubkey.slice(0, 8) : "none",
          });
        }
      },
      undefined,
      (_relayUrl: string, _minCreatedAt: number) => {
        // Final EOSE callback - all events from all relays received
        // Note: This is called per relay, so we need to track when ALL relays are done
        // For now, we'll use a delay to ensure all relays have sent EOSE
        setTimeout(() => {
          if (typeof window === "undefined") return; // Don't access localStorage during SSR
          setSyncing(false);
          setNostrOwnedListReady(true);
          const allRepos = JSON.parse(
            localStorage.getItem("gittr_repos") || "[]"
          );
          const foreignRepos = pubkey
            ? allRepos.filter(
                (r: any) => r.ownerPubkey && r.ownerPubkey !== pubkey
              )
            : allRepos;
          const foreignReposWithFiles = foreignRepos.filter(
            (r: any) => r.files && r.files.length > 0
          );

          // Count repos with valid owner pubkeys (for profile pics)
          const reposWithOwnerPubkeys = allRepos.filter(
            (r: any) => r.ownerPubkey && /^[0-9a-f]{64}$/i.test(r.ownerPubkey)
          ).length;

          console.log("✅ Nostr sync complete (all relays):", {
            totalRepos: allRepos.length,
            foreignRepos: foreignRepos.length,
            foreignReposWithFiles: foreignReposWithFiles.length,
            reposWithOwnerPubkeys: reposWithOwnerPubkeys,
            relays: defaultRelays.length,
            relayList: defaultRelays,
            currentUserPubkey: pubkey ? pubkey.slice(0, 8) : "none",
          });

          // CRITICAL: Reload repos from localStorage after all events are processed
          // This updates the UI without causing infinite loops (only called once after EOSE)
          loadRepos();
        }, 2000); // Wait 2 seconds after last EOSE to ensure all relays have finished
      },
      { allowDuplicateEvents: false }
    );

    // If relays never EOSE, still refresh UI from whatever landed in LS.
    const eoseFailsafe = window.setTimeout(() => {
      setSyncing(false);
      setNostrOwnedListReady(true);
      loadRepos();
    }, 8000);

    return () => {
      unsub();
      clearTimeout(eoseFailsafe);
      if (uiReloadTimerRef.current) clearTimeout(uiReloadTimerRef.current);
    };
  }, [
    mounted,
    subscribe,
    pubkey,
    defaultRelays,
    userName,
    loadRepos,
    scheduleUiReloadFromNostr,
    persistReposCatalog,
  ]); // Own-author only — foreign 30617s belong on Explore, not this catalog.

  // After Clear Local / empty cache: refill *my* repos via server profile-repos API
  // (more reliable than waiting on browser EOSE alone).
  useEffect(() => {
    if (!mounted || !pubkey || !/^[0-9a-f]{64}$/i.test(pubkey)) return;
    let cancelled = false;

    void (async () => {
      try {
        const existing = loadStoredRepos();
        const mine = existing.filter((r) => {
          const owner = String(r.ownerPubkey || "").toLowerCase();
          if (owner && owner === pubkey.toLowerCase()) return true;
          const entity = String((r as { entity?: string }).entity || "");
          if (entity.startsWith("npub")) {
            try {
              const decoded = nip19.decode(entity);
              if (
                decoded.type === "npub" &&
                String(decoded.data).toLowerCase() === pubkey.toLowerCase()
              ) {
                return true;
              }
            } catch {
              /* ignore */
            }
          }
          return false;
        });
        const mineMissingAnnounce = mine.filter(
          (r) => !repoHasNostrAnnounce(r)
        );
        // Skip only when we already have several owned rows that look published.
        if (mine.length >= 3 && mineMissingAnnounce.length === 0) {
          setNostrOwnedListReady(true);
          return;
        }

        const res = await fetch(
          `/api/nostr/profile-repos?ownerPubkey=${encodeURIComponent(pubkey)}`,
          { cache: "no-store" }
        );
        if (!res.ok || cancelled) {
          if (!cancelled) setNostrOwnedListReady(true);
          return;
        }
        const data = (await res.json()) as {
          repos?: Array<{
            entity: string;
            repo: string;
            name: string;
            description?: string;
            ownerPubkey: string;
            lastActivity: number;
            lastNostrEventId?: string;
            lastNostrEventCreatedAt?: number;
            stateEventId?: string;
            sourceUrl?: string;
            forkedFrom?: string;
            clone?: string[];
            publicRead?: boolean;
          }>;
        };
        if (
          !Array.isArray(data.repos) ||
          data.repos.length === 0 ||
          cancelled
        ) {
          if (!cancelled) setNostrOwnedListReady(true);
          return;
        }

        const rows = data.repos
          .filter((row) => {
            const announcedAtMs =
              typeof row.lastNostrEventCreatedAt === "number"
                ? row.lastNostrEventCreatedAt * 1000
                : typeof row.lastActivity === "number"
                  ? row.lastActivity
                  : undefined;
            // Flush/delete tombstones must survive profile-repos refill of old 30617s.
            if (
              isDeletedRepoTombstoned({
                entity: row.entity,
                repo: row.repo,
                ownerPubkey: row.ownerPubkey,
                announcedAtMs,
              })
            ) {
              return false;
            }
            return true;
          })
          .map((row) => ({
          slug: row.repo,
          entity: row.entity,
          repo: row.repo,
          name: row.name || row.repo,
          description: row.description || "",
          ownerPubkey: row.ownerPubkey,
          createdAt: row.lastActivity,
          updatedAt: row.lastActivity,
          lastNostrEventCreatedAt: row.lastNostrEventCreatedAt,
          lastNostrEventId: row.lastNostrEventId,
          stateEventId: row.stateEventId,
          sourceUrl: row.sourceUrl,
          forkedFrom: row.forkedFrom,
          clone: row.clone,
          syncedFromNostr: true,
          fromNostr: true,
          publicRead: row.publicRead !== false,
        }));

        if (rows.length === 0) {
          if (!cancelled) setNostrOwnedListReady(true);
          return;
        }

        const base = reposCatalogRef.current ?? (loadStoredRepos() as any[]);
        const merged = mergeProfileRepoList(base, rows);
        persistReposCatalog(merged as Repo[]);
        if (!cancelled) {
          setNostrOwnedListReady(true);
          loadRepos();
          console.log(
            `✅ [Repositories] Refilled ${rows.length} owned repo(s) from profile-repos API (${data.repos.length - rows.length} hidden by local flush/delete)`
          );
        }
      } catch (e) {
        console.warn("[Repositories] profile-repos refill failed:", e);
        if (!cancelled) setNostrOwnedListReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mounted, pubkey, loadRepos, persistReposCatalog]);

  // Make findCorruptedRepos and deleteCorruptedTidesRepos available in console for debugging
  // Note: General corruption detection is handled by isRepoCorrupted() throughout the codebase
  useEffect(() => {
    if (typeof window !== "undefined" && mounted) {
      // Dynamic import to avoid SSR issues
      (async () => {
        try {
          import("./find-corrupted-repos").then(({ findCorruptedRepos }) => {
            (window as any).findCorruptedRepos = findCorruptedRepos;
            (window as any).findCorruptTidesRepos = findCorruptedRepos; // Backward compatibility
            console.log(
              "💡 Run findCorruptedRepos() in console to find all corrupted repos (uses general corruption detection)"
            );
          });

          // Make deleteCorruptedTidesRepos and findCorruptedEventPublishers available if user has publish and defaultRelays
          if (publish && defaultRelays && defaultRelays.length > 0) {
            import("@/lib/nostr/delete-corrupted-events")
              .then(({ deleteCorruptedTidesRepos }) => {
                (window as any).deleteCorruptedTidesRepos = () => {
                  return deleteCorruptedTidesRepos(publish, defaultRelays);
                };
                console.log(
                  "💡 Run deleteCorruptedTidesRepos() in console to publish NIP-09 deletion events for corrupted tides repos"
                );
                console.log(
                  "⚠️  WARNING: This only works if you have the private key that published the original events"
                );
                console.log(
                  "⚠️  If events were published by someone else, you cannot delete them - contact relay operators"
                );
              })
              .catch((e) => {
                console.warn(
                  "Failed to load delete-corrupted-events utility:",
                  e
                );
              });

            import("@/lib/nostr/find-corrupted-event-publisher")
              .then(({ findCorruptedEventPublishers }) => {
                (window as any).findCorruptedEventPublishers = () => {
                  return findCorruptedEventPublishers(defaultRelays);
                };
                console.log(
                  "💡 Run findCorruptedEventPublishers() in console to find who published the corrupted tides events"
                );
              })
              .catch((e) => {
                console.warn(
                  "Failed to load find-corrupted-event-publisher utility:",
                  e
                );
              });
          }
        } catch (e) {
          console.error("Failed to load utility functions:", e);
        }
      })();
    }
  }, [mounted, publish, defaultRelays]);

  // After Nostr hydrate: only then backfill truly unpublished local creates from activities.
  // Writing those stubs first is what painted every card Local for ~15s after Flush.
  useEffect(() => {
    if (typeof window === "undefined") return; // Don't access localStorage during SSR
    if (!pubkey) return; // Not logged in = can't sync
    if (!nostrOwnedListReady) return;

    try {
      const allRepos = JSON.parse(
        localStorage.getItem("gittr_repos") || "[]"
      ) as any[];

      // Debug: Check for tides in allRepos
      const tidesInAllRepos = allRepos.filter((r: any) => {
        const repoName = r.repo || r.slug || r.name || "";
        return repoName.toLowerCase() === "tides";
      });
      if (tidesInAllRepos.length > 0) {
        console.log(
          "🔍 [Repositories] Found tides in allRepos BEFORE filter:",
          tidesInAllRepos.length,
          tidesInAllRepos.map((r: any) => ({
            entity: r.entity,
            repo: r.repo,
            slug: r.slug,
            name: r.name,
            ownerPubkey: r.ownerPubkey?.slice(0, 16),
          }))
        );
      } else {
        console.log("⚠️ [Repositories] tides NOT in allRepos before filter");
      }

      // Filter repos owned by current user
      // CRITICAL: Match the structure created by /new and /import pages:
      // - entity: npub format (GRASP protocol standard)
      // - ownerPubkey: full 64-char pubkey
      // - contributors: array with owner having weight 100
      const userReposList = allRepos.filter((r: any) => {
        // CRITICAL: Exclude repos with "gittr.space" entity (the corruption bug)
        // These are corrupted repos that should never exist - exclude them completely
        if (r.entity === "gittr.space") {
          const repoName = r.repo || r.slug || r.name || "";
          console.log(
            "❌ [Repositories] Excluding repo with corrupted entity 'gittr.space':",
            {
              repo: repoName,
              ownerPubkey: r.ownerPubkey?.slice(0, 16),
              nostrEventId: r.nostrEventId?.slice(0, 16),
              lastNostrEventId: r.lastNostrEventId?.slice(0, 16),
            }
          );
          return false; // Always exclude - these are corrupted
        }

        if (!r.entity || r.entity === "user") {
          const repoName = r.repo || r.slug || r.name || "";
          if (repoName.toLowerCase() === "tides") {
            console.log(
              "❌ [Repositories] tides excluded - invalid entity:",
              r.entity
            );
          }
          return false;
        }

        // CRITICAL: Entity must be npub format (starts with "npub")
        // Domain names like "gittr.space" are NOT valid entities
        if (!r.entity.startsWith("npub")) {
          const repoName = r.repo || r.slug || r.name || "";
          console.log(
            "❌ [Repositories] Excluding repo with invalid entity format (not npub):",
            {
              repo: repoName,
              entity: r.entity,
              ownerPubkey: r.ownerPubkey?.slice(0, 16),
            }
          );
          return false; // Only npub format is valid
        }

        const repoName = r.repo || r.slug || r.name || "";
        const isTides = repoName.toLowerCase() === "tides";

        if (isTides) {
          // Try to decode npub to show pubkey in logs
          let decodedEntityPubkey: string | null = null;
          if (r.entity?.startsWith("npub")) {
            try {
              const decoded = nip19.decode(r.entity);
              if (decoded.type === "npub") {
                decodedEntityPubkey = decoded.data as string;
              }
            } catch {}
          }
          console.log("🔍 [Repositories] Filtering tides repo - START:", {
            entity: r.entity,
            entityLength: r.entity?.length,
            entityIsNpub: r.entity?.startsWith("npub"),
            decodedEntityPubkey: decodedEntityPubkey?.slice(0, 16),
            ownerPubkey: r.ownerPubkey?.slice(0, 16),
            ownerPubkeyLength: r.ownerPubkey?.length,
            ownerPubkeyIs64Char: r.ownerPubkey?.length === 64,
            currentUserPubkey: pubkey?.slice(0, 16),
            currentUserPubkeyLength: pubkey?.length,
            hasContributors: !!(
              r.contributors && Array.isArray(r.contributors)
            ),
            contributorsCount: r.contributors?.length || 0,
            ownerContributor: r.contributors?.find(
              (c: any) => c.weight === 100
            ),
          });
        }

        // Priority 1: Check direct ownerPubkey match (most reliable)
        if (r.ownerPubkey && typeof r.ownerPubkey === "string") {
          const ownerPubkey = r.ownerPubkey;
          if (ownerPubkey.toLowerCase() === pubkey.toLowerCase()) {
            if (isTides)
              console.log(
                "✅ [Repositories] tides matched by direct ownerPubkey:",
                ownerPubkey.slice(0, 8)
              );
            return true;
          }
        }

        // Priority 2: Check getRepoOwnerPubkey (uses ownerPubkey or contributors)
        const repoOwnerPubkey = getRepoOwnerPubkey(r, r.entity);
        if (
          repoOwnerPubkey &&
          repoOwnerPubkey.toLowerCase() === pubkey.toLowerCase()
        ) {
          if (isTides)
            console.log(
              "✅ [Repositories] tides matched by repoOwnerPubkey:",
              repoOwnerPubkey.slice(0, 8)
            );
          return true;
        }

        // Priority 3: Check entity match (npub format - decode and compare)
        if (r.entity && r.entity.startsWith("npub")) {
          try {
            const decoded = nip19.decode(r.entity);
            if (decoded.type === "npub") {
              const entityPubkey = decoded.data as string;
              if (entityPubkey.toLowerCase() === pubkey.toLowerCase()) {
                if (isTides)
                  console.log(
                    "✅ [Repositories] tides matched by npub entity:",
                    r.entity
                  );
                return true;
              } else {
                if (isTides)
                  console.log(
                    "❌ [Repositories] tides - npub entity decoded but pubkey doesn't match:",
                    {
                      entity: r.entity,
                      decodedPubkey: entityPubkey.slice(0, 16),
                      currentUserPubkey: pubkey.slice(0, 16),
                    }
                  );
              }
            }
          } catch (e) {
            if (isTides)
              console.log(
                "❌ [Repositories] tides - invalid npub format:",
                r.entity,
                e
              );
          }
        } else if (r.entity) {
          if (isTides)
            console.log(
              "❌ [Repositories] tides - entity is not npub format:",
              {
                entity: r.entity,
                entityLength: r.entity?.length,
                entityIsNpub: r.entity?.startsWith("npub"),
              }
            );
        }

        // Priority 4: Check contributors for owner with matching pubkey
        if (r.contributors && Array.isArray(r.contributors)) {
          const ownerContributor = r.contributors.find(
            (c: any) =>
              c.pubkey &&
              typeof c.pubkey === "string" &&
              c.pubkey.toLowerCase() === pubkey.toLowerCase() &&
              (c.weight === 100 || c.role === "owner")
          );
          if (ownerContributor) {
            if (isTides)
              console.log(
                "✅ [Repositories] tides matched by contributor:",
                ownerContributor
              );
            return true;
          } else {
            if (isTides) {
              const allContributors = r.contributors.map((c: any) => ({
                pubkey: c.pubkey?.slice(0, 16),
                pubkeyLength: c.pubkey?.length,
                weight: c.weight,
                role: c.role,
              }));
              console.log(
                "❌ [Repositories] tides - no matching contributor found. All contributors:",
                allContributors
              );
            }
          }
        } else {
          if (isTides)
            console.log("❌ [Repositories] tides - no contributors array");
        }

        if (isTides) {
          console.log(
            "❌ [Repositories] tides NOT matched - all checks failed:",
            {
              entity: r.entity,
              repoOwnerPubkey: repoOwnerPubkey?.slice(0, 16),
              directOwnerPubkey: r.ownerPubkey?.slice(0, 16),
              currentUser: pubkey.slice(0, 16),
              hasContributors: !!(
                r.contributors && Array.isArray(r.contributors)
              ),
              ownerContributor: r.contributors?.find(
                (c: any) => c.weight === 100
              ),
            }
          );
        }
        return false;
      });

      // Get repo activities for current user
      const repoActivitiesForSync = getUserActivities(pubkey).filter(
        (a) => a.type === "repo_created" || a.type === "repo_imported"
      );

      // Debug: Check for tides in activities
      const tidesActivity = repoActivitiesForSync.find((a) => {
        const [activityEntity, activityRepo] = (a.repo || "").split("/");
        return activityRepo && activityRepo.toLowerCase() === "tides";
      });
      if (tidesActivity) {
        console.log("🔍 [Repositories] Found tides in activities:", {
          type: tidesActivity.type,
          repo: tidesActivity.repo,
          entity: tidesActivity.entity,
          user: tidesActivity.user?.slice(0, 8),
        });
      } else {
        console.log("⚠️ [Repositories] tides NOT found in activities");
      }

      // Check if any activities don't have corresponding repos
      const missingRepos = repoActivitiesForSync.filter((activity) => {
        if (!activity.repo) return false;
        const [activityEntity, activityRepo] = activity.repo.split("/");
        const found = userReposList.some((r: any) => {
          const rEntity = r.entity || "";
          const rRepo = r.repo || r.slug || "";
          return rEntity === activityEntity && rRepo === activityRepo;
        });
        if (!found && activityRepo && activityRepo.toLowerCase() === "tides") {
          console.log(
            "⚠️ [Repositories] tides activity found but repo missing from userReposList"
          );
        }
        return !found;
      });

      if (missingRepos.length > 0) {
        console.log(
          `⚠️ [Repositories] Found ${missingRepos.length} repo activities without matching repos (${userReposList.length} already found). Syncing missing ones...`
        );
      }

      if (missingRepos.length > 0) {
        console.log(
          `⚠️ [Repositories] Found ${missingRepos.length} repo activities without matching repos (${userReposList.length} already found). Syncing missing ones...`
        );

        const syncedRepos: any[] = [];
        missingRepos.forEach((activity) => {
          if (!activity.repo || !activity.entity) return;

          const [activityEntity, activityRepo] = activity.repo.split("/");
          if (!activityEntity || !activityRepo) return;

          // Check if we've already synced this repo in this session
          const syncKey = `${activityEntity}/${activityRepo}`;
          if (syncedFromActivitiesRef.current.has(syncKey)) {
            return; // Already synced, skip
          }

          // CRITICAL: Use findRepoByEntityAndName to handle npub format matching
          // This ensures we don't create duplicates when entity formats differ
          // Also check in userReposList (already filtered) to avoid duplicates
          const existingRepo = findRepoByEntityAndName(
            allRepos,
            activityEntity,
            activityRepo
          );
          const existsInAllRepos = !!existingRepo;

          // Also check if it's already in userReposList (might have been added but filtered out)
          const existsInUserRepos = userReposList.some((r: any) => {
            const rEntity = r.entity || "";
            const rRepo = r.repo || r.slug || "";
            return rEntity === activityEntity && rRepo === activityRepo;
          });

          const exists = existsInAllRepos || existsInUserRepos;

          if (!exists) {
            console.log(
              `📦 [Repositories] Syncing missing repo from activity: ${activityRepo}`,
              {
                activityEntity,
                activityRepo,
                activityUser: activity.user?.slice(0, 8),
              }
            );

            // CRITICAL: Resolve ownerPubkey from activity data
            let ownerPubkey = activity.user; // Start with activity.user (should be full pubkey)

            // CRITICAL: Only handle npub format or full 64-char pubkey - NO 8-char prefixes
            if (activityEntity.startsWith("npub")) {
              try {
                const decoded = nip19.decode(activityEntity);
                if (decoded.type === "npub") {
                  ownerPubkey = decoded.data as string; // Use decoded pubkey as owner
                }
              } catch {}
            } else if (/^[0-9a-f]{64}$/i.test(activityEntity)) {
              // If activityEntity is already a full pubkey, use it
              ownerPubkey = activityEntity;
            }

            // CRITICAL: Ensure ownerPubkey is valid (64-char hex)
            if (!ownerPubkey || !/^[0-9a-f]{64}$/i.test(ownerPubkey)) {
              // If we still don't have a valid ownerPubkey, use current user's pubkey if available
              if (pubkey && /^[0-9a-f]{64}$/i.test(pubkey)) {
                ownerPubkey = pubkey;
              } else {
                console.warn(
                  `⚠️ [Repositories] Cannot resolve ownerPubkey for ${activityRepo}, skipping sync`
                );
                return; // Skip this repo if we can't resolve owner
              }
            }

            // CRITICAL: Ensure entity is in npub format (GRASP protocol standard)
            let entityNpub = activityEntity;
            if (!activityEntity.startsWith("npub")) {
              // Convert to npub if not already
              try {
                entityNpub = nip19.npubEncode(ownerPubkey);
              } catch (e) {
                console.error(`Failed to encode npub for ${activityRepo}:`, e);
                entityNpub = activityEntity; // Fallback to original
              }
            }

            const syncedRepo: any = {
              slug: activityRepo,
              entity: entityNpub, // Use npub format
              repo: activityRepo,
              name: activity.repoName || activityRepo,
              ownerPubkey: ownerPubkey, // Always set to full 64-char pubkey
              contributors: [
                { pubkey: ownerPubkey, weight: 100, role: "owner" },
              ], // Ensure owner is in contributors
              createdAt: activity.timestamp,
              description: activity.metadata?.description,
            };

            // CRITICAL: Log synced repo structure for tides
            if (activityRepo.toLowerCase() === "tides") {
              console.log("✅ [Repositories] Synced tides repo structure:", {
                entity: syncedRepo.entity,
                entityIsNpub: syncedRepo.entity?.startsWith("npub"),
                ownerPubkey: syncedRepo.ownerPubkey?.slice(0, 16),
                ownerPubkeyLength: syncedRepo.ownerPubkey?.length,
                ownerPubkeyIs64Char: syncedRepo.ownerPubkey?.length === 64,
                currentUserPubkey: pubkey?.slice(0, 16),
                ownerMatches:
                  pubkey && syncedRepo.ownerPubkey
                    ? syncedRepo.ownerPubkey.toLowerCase() ===
                      pubkey.toLowerCase()
                    : false,
                hasContributors: !!(
                  syncedRepo.contributors &&
                  Array.isArray(syncedRepo.contributors)
                ),
                contributorsCount: syncedRepo.contributors?.length || 0,
                ownerContributor: syncedRepo.contributors?.find(
                  (c: any) => c.weight === 100
                ),
              });
            }

            syncedRepos.push(syncedRepo);
            allRepos.push(syncedRepo);
            syncedFromActivitiesRef.current.add(syncKey); // Mark as synced
          }
        });

        if (syncedRepos.length > 0) {
          console.log(
            `✅ [Repositories] Synced ${syncedRepos.length} repos from activities to localStorage`
          );
          persistReposCatalog(allRepos as Repo[]);

          // CRITICAL: Don't call setRepos directly - let loadRepos() handle filtering
          // This ensures repos are properly filtered and displayed
          setTimeout(() => {
            loadRepos();
          }, 100);
        }
      }
    } catch (error) {
      console.error("Failed to sync repos from activities:", error);
    }
  }, [pubkey, persistReposCatalog, loadRepos, nostrOwnedListReady]); // After Nostr hydrate so activity stubs are not the cache

  // Soft client nav remounts this page with mounted=false briefly. Do not swap the
  // whole page for a thin Loading shell (that reads as bare Header + Footer).
  // Keep the real chrome; list area shows Loading until client mount / data load.
  const showReposLoading = !mounted;

  return (
    <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-start mb-4">
        <h1 className="text-2xl font-bold shrink-0">Your repositories</h1>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {syncing && (
            <span className="text-xs text-gray-400 w-full sm:w-auto">
              Syncing from Nostr...
            </span>
          )}
          {pubkey && (
            <button
              onClick={() => setShowClearConfirm(true)}
              className="border border-purple-500/50 bg-purple-900/20 hover:bg-purple-900/30 text-purple-300 px-2.5 py-1.5 sm:px-3 sm:py-1 rounded transition-colors text-xs sm:text-sm leading-snug max-w-full"
              title="Flush only your own repos from this browser’s cache (not from Nostr). They stay hidden until you publish a newer 30617 after the flush — old announcements on relays will not bring them back. Unpushed local-only work is lost. Other people’s cached repos stay."
            >
              <span className="sm:hidden">
                Flush my repos
                {ownFlushPreview && ownFlushPreview.clearedRepos > 0
                  ? ` (${ownFlushPreview.clearedRepos})`
                  : ""}
              </span>
              <span className="hidden sm:inline">
                Flush my own repos cache
                {ownFlushPreview && ownFlushPreview.clearedRepos > 0
                  ? ` (${ownFlushPreview.clearedRepos})`
                  : ""}
              </span>
            </button>
          )}

          {pubkey && (
            <button
              onClick={() => setShowClearForeignConfirm(true)}
              className="border border-orange-500/50 bg-orange-900/20 hover:bg-orange-900/30 text-orange-300 px-2.5 py-1.5 sm:px-3 sm:py-1 rounded transition-colors text-xs sm:text-sm leading-snug max-w-full"
              title="Flush other people’s repos from this browser’s cache (Explore/import leftovers). Your own repos stay. Safe anytime — they can be re-fetched from Nostr."
            >
              <span className="sm:hidden">
                Flush others
                {foreignFlushPreview && foreignFlushPreview.clearedRepos > 0
                  ? ` (${foreignFlushPreview.clearedRepos})`
                  : ""}
              </span>
              <span className="hidden sm:inline">
                Flush others&apos; repos cache
                {foreignFlushPreview && foreignFlushPreview.clearedRepos > 0
                  ? ` (${foreignFlushPreview.clearedRepos})`
                  : ""}
              </span>
            </button>
          )}

          {/* Flush others' repos cache Confirmation Modal */}
          {showClearForeignConfirm && (
            <div
              className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
              onClick={() => setShowClearForeignConfirm(false)}
            >
              <div
                className="bg-[#0E1116] border border-[#383B42] rounded-lg p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto"
                onClick={(e: MouseEvent) => e.stopPropagation()}
              >
                <h2 className="text-xl font-bold mb-4 text-orange-400">
                  Flush others&apos; repos cache?
                </h2>

                <div className="space-y-4 mb-6">
                  <div className="bg-yellow-900/20 border border-yellow-600/50 rounded p-4">
                    <p className="font-semibold text-yellow-300 mb-2">
                      What will be removed from this browser:
                    </p>
                    <ul className="list-disc list-inside space-y-1 text-sm text-yellow-200/90">
                      <li>Cached copies of repos you don&apos;t own</li>
                      <li>
                        Imported files, issues, PRs, and commits for those repos
                      </li>
                      <li>Explore leftovers from other people&apos;s repos</li>
                    </ul>
                    {foreignFlushPreview && (
                      <p className="text-sm text-yellow-100 mt-3">
                        This will remove{" "}
                        <strong>{foreignFlushPreview.clearedRepos}</strong>{" "}
                        other people&apos;s repo
                        {foreignFlushPreview.clearedRepos === 1 ? "" : "s"}
                        {foreignFlushPreview.duplicateRowsCollapsed > 0
                          ? ` (plus ${foreignFlushPreview.duplicateRowsCollapsed} duplicate cache rows of the same repos)`
                          : ""}
                        {foreignFlushPreview.clearedKeys > 0
                          ? ` and ${foreignFlushPreview.clearedKeys} related file/issue cache entries`
                          : ""}
                        . Your {foreignFlushPreview.keptOwnRepos} repo
                        {foreignFlushPreview.keptOwnRepos === 1 ? "" : "s"} stay
                        {foreignFlushPreview.keptOwnRepos === 1 ? "s" : ""}.
                        {foreignFlushPreview.keptForeignLocal > 0
                          ? ` ${foreignFlushPreview.keptForeignLocal} other-people repo(s) with unpushed local edits are kept.`
                          : ""}
                      </p>
                    )}
                  </div>

                  <div className="bg-green-900/20 border border-green-600/50 rounded p-4">
                    <p className="font-semibold text-green-300 mb-2">
                      ✅ What stays:
                    </p>
                    <ul className="list-disc list-inside space-y-1 text-sm text-green-200/90">
                      <li>Your own repositories in this browser</li>
                      <li>Files / issues / PRs for your own repos</li>
                      <li>Everything already on Nostr (unchanged)</li>
                    </ul>
                  </div>

                  <div className="bg-blue-900/20 border border-blue-600/50 rounded p-4">
                    <p className="font-semibold text-blue-300 mb-2">
                      When to use this:
                    </p>
                    <ul className="list-disc list-inside space-y-1 text-sm text-blue-200/90">
                      <li>
                        After Explore/import filled the cache with others&apos;
                        repos
                      </li>
                      <li>To free space so your own repos keep syncing</li>
                      <li>
                        Anytime — other people&apos;s repos can be re-fetched
                      </li>
                    </ul>
                  </div>

                  <div className="bg-red-900/20 border border-red-600/50 rounded p-4">
                    <p className="font-semibold text-red-300 mb-2">⚠️ Note:</p>
                    <p className="text-sm text-red-200/90">
                      This only clears other people&apos;s repos from your
                      browser. Opening those repos again will download a fresh
                      copy from Nostr. Your own repos stay.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => setShowClearForeignConfirm(false)}
                    className="border border-[#383B42] bg-[#22262C] hover:bg-[#2a2e35] px-4 py-2 rounded transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (!pubkey) {
                        alert(
                          "Error: Not logged in. Cannot identify other people's cached repos."
                        );
                        setShowClearForeignConfirm(false);
                        return;
                      }

                      try {
                        if (typeof window === "undefined") return;

                        const result = clearForeignReposFromStorage(pubkey, {
                          preserveUnpushedEdits: true,
                          preserveWithMetadata: false,
                        });

                        console.log("✅ Flushed others' repos cache:", result);

                        setShowClearForeignConfirm(false);

                        alert(
                          [
                            "✅ Others' repos cache flushed!",
                            "",
                            `• Removed ${
                              result.clearedRepos
                            } other people's repo${
                              result.clearedRepos === 1 ? "" : "s"
                            }`,
                            result.duplicateRowsCollapsed > 0
                              ? `• Collapsed ${result.duplicateRowsCollapsed} duplicate cache rows (same repo listed more than once)`
                              : "",
                            `• Removed ${result.clearedKeys} related file/issue cache entries`,
                            `• Kept ${result.keptOwnRepos} of your repos`,
                            result.keptForeignLocal > 0
                              ? `• Kept ${result.keptForeignLocal} other-people repo(s) with unpushed local edits`
                              : "",
                            "",
                            "This page will not refill other people's repos. Opening them in Explore downloads a fresh copy.",
                          ]
                            .filter(Boolean)
                            .join("\n")
                        );

                        reposCatalogRef.current = null;
                        // Stay on My Repositories (reload can restore a prior repo tab via bfcache).
                        window.location.assign("/repositories");
                      } catch (error) {
                        console.error(
                          "Failed to flush others' repos cache:",
                          error
                        );
                        alert(
                          `❌ Error flushing others' repos cache: ${error}`
                        );
                        setShowClearForeignConfirm(false);
                      }
                    }}
                    className="border border-orange-500/50 bg-orange-900/20 hover:bg-orange-900/30 text-orange-300 px-4 py-2 rounded transition-colors font-semibold"
                  >
                    Yes, flush others&apos; repos
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Flush my own repos cache Confirmation Modal */}
          {showClearConfirm && (
            <div
              className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
              onClick={() => setShowClearConfirm(false)}
            >
              <div
                className="bg-[#0E1116] border border-[#383B42] rounded-lg p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto"
                onClick={(e: MouseEvent) => e.stopPropagation()}
              >
                <h2 className="text-xl font-bold mb-4 text-red-400">
                  Flush my own repos cache?
                </h2>

                <div className="space-y-4 mb-6">
                  <div className="bg-yellow-900/20 border border-yellow-600/50 rounded p-4">
                    <p className="font-semibold text-yellow-300 mb-2">
                      What will be removed from this browser:
                    </p>
                    <ul className="list-disc list-inside space-y-1 text-sm text-yellow-200/90">
                      <li>Your own cached repos and imported file trees</li>
                      <li>Cached issues, PRs, and commits for your repos</li>
                      <li>
                        Unpushed local-only work on your repos (not yet on
                        Nostr)
                      </li>
                    </ul>
                    {ownFlushPreview && (
                      <p className="text-sm text-yellow-100 mt-3">
                        This will remove{" "}
                        <strong>{ownFlushPreview.clearedRepos}</strong> of your
                        repo
                        {ownFlushPreview.clearedRepos === 1 ? "" : "s"}
                        {ownFlushPreview.duplicateRowsCollapsed > 0
                          ? ` (plus ${ownFlushPreview.duplicateRowsCollapsed} duplicate cache rows)`
                          : ""}
                        {ownFlushPreview.clearedKeys > 0
                          ? ` and ${ownFlushPreview.clearedKeys} related file/issue cache entries`
                          : ""}
                        . Already-pushed ones re-fetch from Nostr after reload.
                      </p>
                    )}
                  </div>

                  <div className="bg-green-900/20 border border-green-600/50 rounded p-4">
                    <p className="font-semibold text-green-300 mb-2">
                      ✅ What stays:
                    </p>
                    <ul className="list-disc list-inside space-y-1 text-sm text-green-200/90">
                      <li>
                        Other people&apos;s repos still cached in this browser
                      </li>
                      <li>
                        Anything already pushed to Nostr (your own repos
                        re-fetch after reload)
                      </li>
                      <li>Data on the Nostr network itself</li>
                    </ul>
                  </div>

                  <div className="bg-blue-900/20 border border-blue-600/50 rounded p-4">
                    <p className="font-semibold text-blue-300 mb-2">
                      When to use this:
                    </p>
                    <ul className="list-disc list-inside space-y-1 text-sm text-blue-200/90">
                      <li>
                        After push already happened — safe way to refresh your
                        own list
                      </li>
                      <li>
                        After import when you want a clean refetch from relays
                      </li>
                      <li>
                        If your own repos look stale (use &quot;Flush
                        others&apos; repos cache&quot; to free space from
                        Explore leftovers)
                      </li>
                    </ul>
                  </div>

                  <div className="bg-red-900/20 border border-red-600/50 rounded p-4">
                    <p className="font-semibold text-red-300 mb-2">
                      ⚠️ Important:
                    </p>
                    <p className="text-sm text-red-200/90">
                      Only flush after you&apos;ve pushed (or you don&apos;t
                      need unpushed local work). Unpushed local-only repos
                      cannot be recovered from Nostr.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => setShowClearConfirm(false)}
                    className="border border-[#383B42] bg-[#22262C] hover:bg-[#2a2e35] px-4 py-2 rounded transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (!pubkey) {
                        alert(
                          "Error: Not logged in. Cannot identify your own cached repos."
                        );
                        setShowClearConfirm(false);
                        return;
                      }

                      try {
                        if (typeof window === "undefined") return;

                        const result = clearOwnReposFromStorage(pubkey);

                        console.log("✅ Flushed my own repos cache:", result);

                        setShowClearConfirm(false);

                        alert(
                          [
                            "✅ My own repos cache flushed!",
                            "",
                            `• Removed ${result.clearedRepos} of your repo${
                              result.clearedRepos === 1 ? "" : "s"
                            }`,
                            result.duplicateRowsCollapsed > 0
                              ? `• Collapsed ${result.duplicateRowsCollapsed} duplicate cache rows (same repo listed more than once)`
                              : "",
                            `• Removed ${result.clearedKeys} related file/issue cache entries`,
                            `• Kept ${result.keptRepos} other people's repo${
                              result.keptRepos === 1 ? "" : "s"
                            } in cache`,
                            "",
                            "These repos stay hidden until you publish a newer 30617 after this flush. Old announcements still on relays will not bring them back. Unpushed local-only work is gone.",
                          ]
                            .filter(Boolean)
                            .join("\n")
                        );

                        reposCatalogRef.current = null;
                        // Hard navigate to this page so we never land back on a repo tab from history/bfcache.
                        window.location.assign("/repositories");
                      } catch (error) {
                        console.error(
                          "Failed to flush my own repos cache:",
                          error
                        );
                        alert(`❌ Error flushing my own repos cache: ${error}`);
                        setShowClearConfirm(false);
                      }
                    }}
                    className="border border-red-500/50 bg-red-900/20 hover:bg-red-900/30 text-red-300 px-4 py-2 rounded transition-colors font-semibold"
                  >
                    Yes, flush my own repos
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="space-y-2">
        {showReposLoading && <p className="text-gray-400">Loading...</p>}
        {!showReposLoading &&
          repos.filter((r: Repo) => {
            // CRITICAL: Filter out corrupted repos FIRST (before any other checks)
            if (
              isRepoCorrupted(
                r,
                (r as any).nostrEventId || (r as any).lastNostrEventId
              )
            ) {
              return false; // Never show corrupted repos
            }

            // CRITICAL: "Your repositories" should ONLY show repos owned by the current user
            if (!pubkey) return false; // Not logged in = no repos

            // Priority 1: Check direct ownerPubkey match (most reliable)
            if (
              (r as any).ownerPubkey &&
              (r as any).ownerPubkey.toLowerCase() === pubkey.toLowerCase()
            )
              return true;

            // Priority 2: Check via getRepoOwnerPubkey (uses ownerPubkey or contributors)
            const repoOwnerPubkey = getRepoOwnerPubkey(r as any, r.entity);
            if (
              repoOwnerPubkey &&
              repoOwnerPubkey.toLowerCase() === pubkey.toLowerCase()
            )
              return true;

            // Priority 3: Check contributors for owner with matching pubkey
            if (r.contributors && Array.isArray(r.contributors)) {
              const ownerContributor = r.contributors.find(
                (c: any) =>
                  c.pubkey &&
                  c.pubkey.toLowerCase() === pubkey.toLowerCase() &&
                  (c.weight === 100 || c.role === "owner")
              );
              if (ownerContributor) return true;
            }

            // Priority 4: Check if entity (npub format) matches current user's pubkey
            if (r.entity && r.entity.startsWith("npub")) {
              try {
                const decoded = nip19.decode(r.entity);
                if (decoded.type === "npub") {
                  const entityPubkey = decoded.data as string;
                  if (entityPubkey.toLowerCase() === pubkey.toLowerCase()) {
                    // Additional check: ensure ownerPubkey matches if it exists
                    if (
                      (r as any).ownerPubkey &&
                      (r as any).ownerPubkey.toLowerCase() !==
                        pubkey.toLowerCase()
                    )
                      return false;
                    return true;
                  }
                }
              } catch {}
            }

            return false;
          }).length === 0 && <p>No repositories yet.</p>}
        {!showReposLoading &&
          (() => {
            // Load list of locally-deleted repos (user deleted them, don't show)
            const deletedRepos =
              typeof window === "undefined"
                ? []
                : (JSON.parse(
                    localStorage.getItem("gittr_deleted_repos") || "[]"
                  ) as Array<{
                    entity: string;
                    repo: string;
                    deletedAt: number;
                    ownerPubkey?: string;
                  }>);

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
                          (dDecoded.data as string).toLowerCase() ===
                            ownerPubkey
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

            // Filter, sort, and deduplicate repos
            const filtered = repos.filter((r: Repo) => {
              // CRITICAL: Exclude corrupted repos using general corruption check
              const repoForValidation = {
                repositoryName:
                  (r as any).repositoryName || r.repo || r.slug || r.name || "",
                entity: r.entity || "",
                ownerPubkey: (r as any).ownerPubkey || "",
              };

              const eventId =
                (r as any).nostrEventId || (r as any).lastNostrEventId;

              if (isRepoCorrupted(repoForValidation, eventId)) {
                // Silently filter out - don't spam console
                return false; // Always exclude corrupted repos
              }

              // Get repo name for filtering logic
              const repoName =
                (r as any).repositoryName || r.repo || r.slug || r.name || "";
              const isTides = repoName.toLowerCase() === "tides";

              // CRITICAL: Filter out duplicate/corrupted tides repos
              // If there are multiple tides repos with the same entity but different ownerPubkeys, exclude all but one
              // This handles the case where corrupted repos were created with wrong ownerPubkey
              if (isTides && pubkey) {
                // Check if ownerPubkey matches current user - if not, exclude it
                const ownerPubkey = (r as any).ownerPubkey;
                if (
                  ownerPubkey &&
                  ownerPubkey.toLowerCase() !== pubkey.toLowerCase()
                ) {
                  // Also check if entity matches current user
                  try {
                    if (r.entity && r.entity.startsWith("npub")) {
                      const decoded = nip19.decode(r.entity);
                      if (decoded.type === "npub") {
                        const entityPubkey = decoded.data as string;
                        if (
                          entityPubkey.toLowerCase() !== pubkey.toLowerCase()
                        ) {
                          console.log(
                            "❌ [Repositories] Filtering out tides repo - owner doesn't match:",
                            {
                              repo: repoName,
                              entity: r.entity,
                              entityPubkey: entityPubkey.slice(0, 16),
                              ownerPubkey: ownerPubkey.slice(0, 16),
                              currentUser: pubkey.slice(0, 16),
                            }
                          );
                          return false; // Exclude if neither entity nor ownerPubkey matches
                        }
                      }
                    }
                  } catch {}
                }
              }

              // CRITICAL: Filter out deleted repos FIRST (before ownership checks)
              // Skip if locally deleted (completely hidden - no note shown)
              if (isRepoDeleted(r)) return false;

              // Skip if owner marked as deleted/archived on Nostr (completely hidden - no note shown)
              if ((r as any).deleted === true || (r as any).archived === true)
                return false;

              // CRITICAL: "Your repositories" should ONLY show repos owned by the current user
              if (!pubkey) return false; // Not logged in = no repos

              // repoName already defined above in the filter
              const repoOwnerPubkey = getRepoOwnerPubkey(r as any, r.entity);
              const directOwnerPubkey = (r as any).ownerPubkey;

              // Debug logging for tides repo
              if (repoName.toLowerCase() === "tides") {
                console.log("🔍 [Repositories] Filtering tides repo:", {
                  repoName,
                  entity: r.entity,
                  repoOwnerPubkey: repoOwnerPubkey?.slice(0, 8),
                  directOwnerPubkey: directOwnerPubkey?.slice(0, 8),
                  currentUserPubkey: pubkey?.slice(0, 8),
                  hasContributors: !!(
                    r.contributors && Array.isArray(r.contributors)
                  ),
                  ownerContributor: r.contributors?.find(
                    (c: any) => c.weight === 100
                  ),
                });
              }

              // Priority 1: Check direct ownerPubkey match (most reliable)
              if (
                directOwnerPubkey &&
                directOwnerPubkey.toLowerCase() === pubkey.toLowerCase()
              ) {
                if (repoName.toLowerCase() === "tides")
                  console.log(
                    "✅ [Repositories] tides matched by direct ownerPubkey"
                  );
                return true;
              }

              // Priority 2: Check via getRepoOwnerPubkey (uses ownerPubkey or contributors)
              if (
                repoOwnerPubkey &&
                repoOwnerPubkey.toLowerCase() === pubkey.toLowerCase()
              ) {
                if (repoName.toLowerCase() === "tides")
                  console.log(
                    "✅ [Repositories] tides matched by repoOwnerPubkey"
                  );
                return true;
              }

              // Priority 3: Check contributors for owner with matching pubkey
              if (r.contributors && Array.isArray(r.contributors)) {
                const ownerContributor = r.contributors.find(
                  (c: any) =>
                    c.pubkey &&
                    c.pubkey.toLowerCase() === pubkey.toLowerCase() &&
                    (c.weight === 100 || c.role === "owner")
                );
                if (ownerContributor) {
                  if (repoName.toLowerCase() === "tides")
                    console.log(
                      "✅ [Repositories] tides matched by contributor"
                    );
                  return true;
                }
              }

              // Priority 4: Check if entity (npub format) matches current user's pubkey (fallback)
              if (r.entity && r.entity.startsWith("npub")) {
                try {
                  const decoded = nip19.decode(r.entity);
                  if (decoded.type === "npub") {
                    const entityPubkey = decoded.data as string;
                    if (entityPubkey.toLowerCase() === pubkey.toLowerCase()) {
                      // Additional check: ensure ownerPubkey matches if it exists
                      if (
                        directOwnerPubkey &&
                        directOwnerPubkey.toLowerCase() !== pubkey.toLowerCase()
                      ) {
                        if (repoName.toLowerCase() === "tides")
                          console.log(
                            "❌ [Repositories] tides excluded - npub entity matches but ownerPubkey doesn't"
                          );
                        return false;
                      }
                      if (repoName.toLowerCase() === "tides")
                        console.log(
                          "✅ [Repositories] tides matched by npub entity"
                        );
                      return true;
                    }
                  }
                } catch (e) {
                  if (repoName.toLowerCase() === "tides")
                    console.log(
                      "❌ [Repositories] tides - failed to decode npub entity:",
                      r.entity
                    );
                }
              }

              // Filter out repos without valid entity (npub format required)
              if (
                !r.entity ||
                r.entity === "user" ||
                !r.entity.startsWith("npub")
              ) {
                // Try one more time to migrate if user is now logged in AND repo belongs to them
                if (
                  isLoggedIn &&
                  userName &&
                  userName !== "Anonymous Nostrich" &&
                  pubkey
                ) {
                  // CRITICAL: Only migrate if repo belongs to current user (check ownerPubkey)
                  const isUserRepo =
                    (r as any).ownerPubkey === pubkey ||
                    (r.contributors &&
                      r.contributors.some(
                        (c: any) => c.pubkey === pubkey && c.weight === 100
                      ));

                  if (isUserRepo) {
                    // Use npub format for entity (GRASP protocol standard)
                    let entityNpub: string;
                    try {
                      entityNpub = nip19.npubEncode(pubkey);
                    } catch (e) {
                      console.error(
                        "Failed to encode npub for entity migration:",
                        e
                      );
                      return false; // Can't migrate without valid npub
                    }
                    const updated = repos.map((rr: Repo) =>
                      rr === r
                        ? {
                            ...rr,
                            entity: entityNpub,
                            entityDisplayName:
                              userName || entityNpub.slice(0, 12) + "...", // Use userName or shortened npub for display
                            ownerPubkey: pubkey, // Ensure ownerPubkey is set
                          }
                        : rr
                    );
                    localStorage.setItem(
                      "gittr_repos",
                      JSON.stringify(updated)
                    );
                    // Return true to show it this time, but it will be properly migrated next render
                    return false; // Still filter it out this render
                  }
                }
                return false; // Filter out invalid repos
              }

              // All checks above should have caught it - if we get here, it's not the user's repo
              return false;
            });

            // CRITICAL: Sort by latest event date (lastNostrEventCreatedAt) if available, otherwise by createdAt
            // This ensures repos with recent updates appear first
            // Note: lastNostrEventCreatedAt is in SECONDS (NIP-34 format), createdAt/updatedAt are in MILLISECONDS
            const sorted = filtered.sort((a: Repo, b: Repo) => {
              // Get latest event date in milliseconds for comparison
              const aLatest = (a as any).lastNostrEventCreatedAt
                ? (a as any).lastNostrEventCreatedAt * 1000 // Convert seconds to milliseconds
                : (a as any).updatedAt || a.createdAt || 0;
              const bLatest = (b as any).lastNostrEventCreatedAt
                ? (b as any).lastNostrEventCreatedAt * 1000 // Convert seconds to milliseconds
                : (b as any).updatedAt || b.createdAt || 0;
              return bLatest - aLatest; // Newest first
            });

            // Deduplicate repos by entity/repo combination
            // CRITICAL: Merge local and Nostr versions intelligently:
            // - If both exist, merge them (preserve local logoUrl, keep Nostr metadata)
            // - Only show local version if it has unpushed edits
            const dedupeMap = new Map<string, any>();
            sorted.forEach((r: any) => {
              const entity = (r.entity || "").trim();
              const repo = (r.repo || r.slug || r.name || "").trim();
              // Normalize repo name for matching (handle variations like bitcoin_meetup_calendar vs bitcoin-meetup-calendar)
              const normalizedRepo = repo.toLowerCase().replace(/[_-]/g, "");
              const key = `${entity}/${normalizedRepo}`.toLowerCase(); // Case-insensitive comparison
              const existing = dedupeMap.get(key);

              if (!existing) {
                dedupeMap.set(key, r);
              } else {
                // Merge repos: preserve local logoUrl, keep Nostr metadata
                const status = getRepoStatus(r);
                const existingStatus = getRepoStatus(existing);

                // If one is local and one is published, merge them
                if (
                  (status === "local" &&
                    isPublishedRepoStatus(existingStatus)) ||
                  (existingStatus === "local" && isPublishedRepoStatus(status))
                ) {
                  // Merge: keep Nostr version as base, but preserve local logoUrl and unpushed edits
                  const localVersion = status === "local" ? r : existing;
                  const nostrVersion = status === "local" ? existing : r;

                  const merged = {
                    ...nostrVersion, // Use Nostr version as base (has all metadata)
                    // Preserve local logoUrl if it exists and is different from Nostr
                    logoUrl: localVersion.logoUrl || nostrVersion.logoUrl,
                    // Preserve local unpushed edits flag
                    hasUnpushedEdits:
                      localVersion.hasUnpushedEdits ||
                      nostrVersion.hasUnpushedEdits,
                    // Keep the most recent modification time
                    lastModifiedAt: Math.max(
                      localVersion.lastModifiedAt || 0,
                      nostrVersion.lastModifiedAt || 0
                    ),
                    // Keep both event IDs if they exist
                    nostrEventId:
                      nostrVersion.nostrEventId || localVersion.nostrEventId,
                    lastNostrEventId:
                      nostrVersion.lastNostrEventId ||
                      localVersion.lastNostrEventId,
                    // Preserve local status if it has unpushed edits
                    status:
                      localVersion.hasUnpushedEdits ||
                      (localVersion.lastModifiedAt &&
                        nostrVersion.lastNostrEventCreatedAt &&
                        localVersion.lastModifiedAt >
                          nostrVersion.lastNostrEventCreatedAt * 1000)
                        ? "live_with_edits"
                        : nostrVersion.status || "live",
                  };

                  dedupeMap.set(key, merged);
                } else {
                  // Both are same type, keep the most recent one
                  if ((r.createdAt || 0) > (existing.createdAt || 0)) {
                    dedupeMap.set(key, r);
                  }
                }
              }
            });

            const deduplicatedRepos = Array.from(dedupeMap.values());
            const visibleRepos = deduplicatedRepos.slice(0, visibleRepoCount);

            const needsCloneRepublish = deduplicatedRepos.filter((r: any) =>
              cloneListNeedsRepublish(r.clone)
            );

            const runBatchCloneRepublish = async () => {
              if (!pubkey || !publish || !subscribe || !defaultRelays?.length) {
                alert("Sign in and wait for relays before republishing.");
                return;
              }
              if (needsCloneRepublish.length === 0) return;
              const nameList =
                formatCloneRepublishRepoNames(needsCloneRepublish);
              const ok = window.confirm(
                `${needsCloneRepublish.length} of your repo(s) only announce broken clone URLs (bare git.gittr.space, localhost, or private addresses):\n\n` +
                  `${nameList}\n\n` +
                  `This runs Push to Nostr once per repo — you may need to approve several signatures (nsec, browser extension, or remote signer). It can take a while.\n\n` +
                  `Republish all ${needsCloneRepublish.length} now?`
              );
              if (!ok) return;
              setRepairingCloneUrls(true);
              try {
                const signer = await resolveNostrSigner({ remoteSigner });
                if (!signer) {
                  alert(NO_SIGNING_METHOD_MESSAGE);
                  return;
                }
                const { repaired, failed } = await repairHostOnlyCloneAnnounces(
                  {
                    repoSlugs: needsCloneRepublish.map((r: any) => ({
                      entity: r.entity,
                      repoSlug: r.repositoryName || r.repo || r.slug,
                    })),
                    publish,
                    subscribe,
                    defaultRelays,
                    pubkey,
                    remoteSigner,
                    privateKey: signer.privateKey,
                    onProgress: (m) => console.log("[repair clone URLs]", m),
                  }
                );
                const updatedRepos = JSON.parse(
                  localStorage.getItem("gittr_repos") || "[]"
                );
                setRepos([...updatedRepos]);
                alert(
                  `Republished ${repaired.length} of ${needsCloneRepublish.length} repo(s).` +
                    (failed.length
                      ? `\nFailed: ${failed
                          .map((f) => `${f.repo}: ${f.error}`)
                          .join("; ")}`
                      : "")
                );
                window.dispatchEvent(new Event("storage"));
              } catch (e: any) {
                alert(`Republish failed: ${e?.message || e}`);
              } finally {
                setRepairingCloneUrls(false);
              }
            };

            return (
              <>
                {needsCloneRepublish.length > 0 && (
                  <div className="mb-3 rounded border border-amber-700/50 bg-amber-950/40 p-3 text-sm text-amber-100 flex flex-wrap items-center gap-3 justify-between">
                    <span>
                      {needsCloneRepublish.length} repo(s) need a republish —
                      clone URL is only a bare host, localhost, or similar:{" "}
                      <strong className="font-medium text-amber-50">
                        {formatCloneRepublishRepoNames(needsCloneRepublish)}
                      </strong>
                      . Hidden from explore until fixed. Each repo needs its own
                      Push / signatures; this can take a while, please leave the
                      tab open until finished.
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      disabled={repairingCloneUrls}
                      onClick={() => void runBatchCloneRepublish()}
                      className="shrink-0"
                    >
                      {repairingCloneUrls ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-1" />{" "}
                          Republishing…
                        </>
                      ) : (
                        `Republish broken clones (${needsCloneRepublish.length})`
                      )}
                    </Button>
                  </div>
                )}
                {visibleRepos.map((r: any, index: number) => {
                  // Entity is guaranteed to be valid here
                  const entity = r.entity!;
                  // CRITICAL: For URLs and bridge operations, use repositoryName from Nostr event (exact name used by git-nostr-bridge)
                  // Priority: repositoryName > repo > slug
                  // For display, use original name (r.name)
                  const rAny = r;
                  const repoForUrl =
                    rAny?.repositoryName || r.repo || r.slug || "unnamed-repo";
                  const displayName = r.name || repoForUrl; // CRITICAL: Use original name for display

                  // CRITICAL: Resolve full owner pubkey for proper metadata fetching
                  const ownerPubkey = getRepoOwnerPubkey(r, entity);

                  // CRITICAL: Use npub format for URLs (GRASP protocol standard)
                  // Convert ownerPubkey to npub format for consistent URLs
                  let repoHref: string;

                  if (ownerPubkey) {
                    try {
                      const npub = nip19.npubEncode(ownerPubkey);
                      repoHref = `/${npub}/${repoForUrl}`;
                    } catch (error) {
                      console.error(
                        "⚠️ [Repositories] Failed to encode npub:",
                        {
                          ownerPubkey,
                          error,
                        }
                      );
                      // Fallback to entity format if npub encoding fails
                      repoHref = `/${entity}/${repoForUrl}`;
                    }
                  } else {
                    // Fallback if no ownerPubkey
                    repoHref = `/${entity}/${repoForUrl}`;
                  }

                  // Fetch owner metadata using full pubkey
                  const ownerMeta = ownerPubkey
                    ? ownerMetadata[ownerPubkey]
                    : undefined;

                  // Use owner's Nostr metadata name if available, otherwise fallback to entity (npub format)
                  // CRITICAL: Never use r.entityDisplayName - it might be wrong (set to current user's name)
                  const entityDisplay =
                    ownerMeta?.name ||
                    ownerMeta?.display_name ||
                    (entity.startsWith("npub")
                      ? entity.slice(0, 12) + "..."
                      : entity);

                  // Resolve icon - this will update reactively when ownerMetadata changes
                  const iconUrl = resolveRepoIcon(r);

                  const status = getRepoStatus(r);
                  const waitingForNostr =
                    !nostrOwnedListReady && !repoHasNostrAnnounce(r);
                  const needsRepublish = cloneListNeedsRepublish(r.clone);
                  const isLocal =
                    !waitingForNostr &&
                    (statusNeedsPushAction(status) || needsRepublish);
                  const isPushing = pushingRepos.has(`${entity}/${repoForUrl}`);

                  const repoKey = `${entity}/${repoForUrl}`;
                  const isNavigating = clickedRepo === repoKey;

                  return (
                    <div
                      key={`${entity}/${repoForUrl}-${index}`}
                      className={`border p-3 transition-all duration-200 ${
                        isNavigating
                          ? "bg-purple-500/20 border-purple-500/50 shadow-lg"
                          : "hover:bg-white/5"
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                        <div
                          className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                          onClick={(e: MouseEvent) => {
                            // CRITICAL: Use window.location for immediate navigation (bypasses React completely)
                            // This ensures navigation happens instantly, even during heavy re-renders
                            e.preventDefault();
                            e.stopPropagation();

                            // Set clicked state immediately for visual feedback
                            setClickedRepo(repoKey);

                            // Navigate immediately using window.location (completely bypasses React)
                            window.location.href = repoHref;
                          }}
                        >
                          {/* Repo icon with fallback */}
                          {iconUrl ? (
                            <img
                              src={iconUrl}
                              alt="repo"
                              className="h-6 w-6 rounded-sm object-contain flex-shrink-0"
                              onError={(
                                e: SyntheticEvent<HTMLImageElement, Event>
                              ) => {
                                // Fallback to empty square on error
                                e.currentTarget.style.display = "none";
                                const parent = e.currentTarget.parentElement;
                                if (
                                  parent &&
                                  !parent.querySelector(".icon-fallback")
                                ) {
                                  const fallback =
                                    document.createElement("span");
                                  fallback.className =
                                    "icon-fallback inline-block h-6 w-6 rounded-sm bg-[#22262C] flex-shrink-0";
                                  parent.insertBefore(
                                    fallback,
                                    e.currentTarget
                                  );
                                }
                              }}
                            />
                          ) : (
                            <span className="inline-block h-6 w-6 rounded-sm bg-[#22262C] flex-shrink-0" />
                          )}
                          {/* Repo name and info - flex column to avoid wrapping issues */}
                          <div className="flex flex-col gap-1 min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <div className="font-semibold text-cyan-400 min-w-0 flex-1 flex items-center gap-2">
                                {isNavigating && (
                                  <Loader2 className="h-4 w-4 animate-spin text-purple-400 flex-shrink-0" />
                                )}
                                <span className="truncate">{displayName}</span>
                                <span className="opacity-70 hidden sm:inline">
                                  / {entityDisplay}
                                </span>
                              </div>
                              {/* Status badge — hide fake Local until Nostr hydrate finishes */}
                              {waitingForNostr
                                ? null
                                : (() => {
                                    const style = getStatusBadgeStyle(status);
                                    return (
                                      <span
                                        className={`text-xs px-2 py-0.5 rounded ${style.bg} ${style.text} flex-shrink-0`}
                                      >
                                        {style.label}
                                      </span>
                                    );
                                  })()}
                              {needsRepublish && (
                                <span
                                  className="text-xs px-2 py-0.5 rounded bg-amber-900/60 text-amber-200 border border-amber-700/50 flex-shrink-0"
                                  title={CLONE_REPUBLISH_BADGE_TITLE}
                                >
                                  {CLONE_REPUBLISH_BADGE_LABEL}
                                </span>
                              )}
                              <Badge className="border border-gray-600 text-gray-300 bg-transparent text-xs flex items-center gap-1 flex-shrink-0">
                                {r.publicRead !== false ? (
                                  <>
                                    <Globe className="h-3 w-3" />
                                    Public
                                  </>
                                ) : (
                                  <>
                                    <Lock className="h-3 w-3" />
                                    Private
                                  </>
                                )}
                              </Badge>
                            </div>
                            <div className="sm:hidden text-xs opacity-70 truncate">
                              {entityDisplay}
                            </div>
                            {(() => {
                              const cardDesc = repoCardDescriptionText(
                                r.description,
                                r.repo || r.slug || r.name || ""
                              );
                              return cardDesc ? (
                                <div className="text-sm opacity-70 line-clamp-2">
                                  {cardDesc}
                                </div>
                              ) : null;
                            })()}
                          </div>
                        </div>
                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:ml-4 flex-shrink-0 w-full sm:w-auto">
                          {/* Push button for local repos - only visible to owner */}
                          {isLocal &&
                            pubkey &&
                            isOwner(
                              pubkey,
                              r.contributors,
                              r.ownerPubkey,
                              r.entity
                            ) && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isPushing}
                                className="text-xs whitespace-nowrap w-full sm:w-auto"
                                onClick={async (e: MouseEvent) => {
                                  e.preventDefault();
                                  e.stopPropagation();

                                  if (
                                    !pubkey ||
                                    !publish ||
                                    !subscribe ||
                                    !defaultRelays
                                  ) {
                                    alert("Please log in to push repositories");
                                    return;
                                  }

                                  try {
                                    const signer = await resolveNostrSigner({
                                      remoteSigner,
                                    });
                                    if (!signer) {
                                      alert(NO_SIGNING_METHOD_MESSAGE);
                                      return;
                                    }
                                    const privateKey = signer.privateKey;

                                    // CRITICAL: Validate repo before pushing (prevent signing corrupted repos)
                                    const validation =
                                      validateRepoForForkOrSign(r);
                                    if (!validation.valid) {
                                      alert(
                                        `Cannot push corrupted repository: ${validation.error}`
                                      );
                                      return;
                                    }

                                    const ownerPubkey =
                                      getRepoOwnerPubkey(
                                        r as StoredRepo,
                                        entity
                                      ) ||
                                      r.ownerPubkey ||
                                      "";
                                    const paymentAuth =
                                      await ensurePushPaymentAuthorization({
                                        entity,
                                        repo: repoForUrl,
                                        ownerPubkey: ownerPubkey.toLowerCase(),
                                        payerPubkey: pubkey,
                                        privateKey: privateKey || undefined,
                                        signer: signer.signEvent,
                                      });
                                    if (!paymentAuth.ok) {
                                      alert(
                                        `Push blocked: ${
                                          paymentAuth.error ||
                                          "payment authorization failed"
                                        }`
                                      );
                                      return;
                                    }

                                    setPushingRepos((prev: Set<string>) =>
                                      new Set(prev).add(
                                        `${entity}/${repoForUrl}`
                                      )
                                    );

                                    const result = await pushRepoToNostr({
                                      repoSlug: repoForUrl,
                                      entity,
                                      publish,
                                      subscribe,
                                      defaultRelays,
                                      privateKey,
                                      pubkey,
                                      remoteSigner,
                                      onProgress: (message) => {
                                        console.log(
                                          `[Push ${repoForUrl}] ${message}`
                                        );
                                      },
                                    });

                                    if (result.success) {
                                      // Bridge sync already happens inside pushRepoToNostr.
                                      // Do not run a second bridge push from this page.
                                      // Reload repos to show updated status
                                      const updatedRepos = JSON.parse(
                                        localStorage.getItem("gittr_repos") ||
                                          "[]"
                                      );
                                      setRepos([...updatedRepos]);

                                      alert(formatPushRepoSuccessAlert(result));
                                    } else {
                                      alert(
                                        `❌ Failed to push: ${result.error}`
                                      );
                                    }
                                  } catch (error: any) {
                                    console.error(
                                      "Failed to push repo:",
                                      error
                                    );
                                    alert(
                                      `Failed to push: ${
                                        error.message || "Unknown error"
                                      }`
                                    );
                                  } finally {
                                    setPushingRepos((prev: Set<string>) => {
                                      const next = new Set(prev);
                                      next.delete(`${entity}/${repoForUrl}`);
                                      return next;
                                    });
                                  }
                                }}
                              >
                                <Upload className="h-3 w-3 mr-1" />
                                {isPushing
                                  ? "Pushing..."
                                  : needsRepublish
                                  ? "Republish"
                                  : "Push to Nostr"}
                              </Button>
                            )}
                          <div className="opacity-70 text-xs sm:text-sm whitespace-nowrap">
                            {r.lastNostrEventCreatedAt ? (
                              <>
                                <span>Last push: </span>
                                {formatDateTime24h(
                                  r.lastNostrEventCreatedAt * 1000
                                )}
                              </>
                            ) : r.lastPushAttempt ? (
                              <>
                                <span>Push attempted: </span>
                                {formatDateTime24h(r.lastPushAttempt)}
                              </>
                            ) : r.lastModifiedAt ? (
                              <>
                                <span>Modified: </span>
                                {formatDateTime24h(r.lastModifiedAt)}
                              </>
                            ) : (
                              <>
                                <span>Created: </span>
                                {formatDateTime24h(r.createdAt)}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <LoadMoreButton
                  visibleCount={visibleRepos.length}
                  totalCount={deduplicatedRepos.length}
                  pageSize={REPO_LIST_PAGE_SIZE}
                  onLoadMore={() =>
                    setVisibleRepoCount((n) => n + REPO_LIST_PAGE_SIZE)
                  }
                  className="flex justify-center pt-4 pb-2 w-full"
                />
              </>
            );
          })()}
      </div>
    </div>
  );
}
