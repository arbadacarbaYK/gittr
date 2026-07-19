"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RepoQRShare } from "@/components/ui/repo-qr-share";
import { showToast } from "@/components/ui/toast";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import {
  KIND_GIT_REPOSITORIES_LIST,
  KIND_REPOSITORY_NIP34,
  parseGitRepositoriesListEvent,
} from "@/lib/nostr/events";
import { getAllRelays } from "@/lib/nostr/getAllRelays";
import { isPublicReadFromEvent } from "@/lib/nostr/repo-public-read";
import { parseGitHubRepoSpec } from "@/lib/nostr/nip82-repository-links";
import {
  REPO_ANNOUNCEMENT_ID_EVENT,
  type RelaySubscribeFn,
  type RepoAnnouncementIdDetail,
  aggregateRepoStarReactions,
  cacheRepoAnnouncementEventId,
  isRepoStarReaction,
  publishStarReaction,
  queryRepoAnnouncementEventId,
  readCachedRepoAnnouncementEventId,
  removeStarReaction,
} from "@/lib/nostr/repo-stars";
import { useRepoNip57ZapBadgeTotal } from "@/lib/nostr/useRepoNip57ZapBadgeTotal";
import {
  canManageSettings,
  hasPrivateRepoAccess,
  isOwner,
} from "@/lib/repo-permissions";
import {
  repoNavHref,
  resolveSharedRepoBranch,
} from "@/lib/repos/repo-file-tree-branch";
import {
  findStoredRepoForRoute,
  hydrateRepoFromGithub,
} from "@/lib/repos/repo-github-hub";
import {
  type StoredContributor,
  type StoredRepo,
  loadStoredRepos,
} from "@/lib/repos/storage";
import { resolveGithubUpstreamForTabs } from "@/lib/repos/upstream-precedence";
import { isRepoUiNextPath } from "@/lib/ui/repo-ui-mode";
import {
  getRepoStorageKey,
  readRepoIssuesFromLocalStorage,
  readRepoPullsFromLocalStorage,
} from "@/lib/utils/entity-normalizer";
import { getRepoOwnerPubkey } from "@/lib/utils/entity-resolver";
import {
  normalizeIssueListStatus,
  normalizePrListStatus,
} from "@/lib/utils/issue-pr-status";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";
import { useEntityOwner } from "@/lib/utils/use-entity-owner";

import { clsx } from "clsx";
import {
  BarChart4,
  ChevronDown,
  CircleDot,
  Code,
  Eye,
  Folder,
  GitBranch,
  GitCommit,
  GitFork,
  GitPullRequest,
  Globe2,
  Layers,
  MessageCircle,
  MoreHorizontal,
  Settings,
  Share2,
  Star,
  Zap,
} from "lucide-react";
import Link from "next/link";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import {
  type Event as NostrEvent,
  type UnsignedEvent,
  nip19,
} from "nostr-tools";

const menuItems = [
  {
    link: "",
    name: "Code",
    icon: <Code className="mr-2 h-4 w-4" />,
  },
  {
    link: "issues",
    name: "Issues",
    icon: <CircleDot className="mr-2 h-4 w-4" />,
  },
  {
    link: "pulls",
    name: "Pull Requests",
    icon: <GitPullRequest className="mr-2 h-4 w-4" />,
  },
  {
    link: "commits",
    name: "Commits",
    icon: <GitCommit className="mr-2 h-4 w-4" />,
  },
  {
    link: "releases",
    name: "Releases",
    icon: <Globe2 className="mr-2 h-4 w-4" />,
  },
  {
    link: "architecture",
    name: "Architecture",
    icon: <Layers className="mr-2 h-4 w-4" />,
  },
  {
    link: "dependencies",
    name: "Dependencies",
    icon: <GitBranch className="mr-2 h-4 w-4" />,
  },
  {
    link: "projects",
    name: "ToDo",
    icon: <Folder className="mr-2 h-4 w-4" />,
  },
  {
    link: "discussions",
    name: "Discussions",
    icon: <MessageCircle className="mr-2 h-4 w-4" />,
  },
  {
    link: "insights",
    name: "Insights",
    icon: <BarChart4 className="mr-2 h-4 w-4" />,
  },
  {
    link: "settings",
    name: "Settings",
    icon: <Settings className="mr-2 h-4 w-4" />,
  },
];
// Conservative width estimates for top repo nav overflow calculation.
// The previous values were too large and pushed items into overflow too early.
const MENU_ITEM_WIDTH = 130;
const HEADER_RESERVED_WIDTH = 280;
const FORCED_OVERFLOW_LINKS = new Set(["discussions", "insights", "settings"]);

const WATCH_BUTTON_TITLE =
  "Watch / unwatch: followed repos (NIP-51 kind 10018). Separate from Star: NIP-25 kind 7 on the repo’s 30617 event, which is what your Stars page lists.";

export default function RepoLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const routeParams = useParams<{
    entity?: string;
    repo?: string;
    subpage?: string;
  }>();
  const resolvedParams = useMemo(
    () => ({
      entity: routeParams?.entity ?? "",
      repo: routeParams?.repo ?? "",
      subpage: routeParams?.subpage,
    }),
    [routeParams?.entity, routeParams?.repo, routeParams?.subpage]
  );
  const pathname = usePathname() || "";
  const searchParams = useSearchParams();
  const router = useRouter();
  // Use consistent default width on server and initial client render to prevent hydration mismatch
  const [windowWidth, setWindowWidth] = useState(1920);
  const { pubkey, publish, subscribe, defaultRelays, remoteSigner } =
    useNostrContext();
  const [isWatching, setIsWatching] = useState(false);
  const [githubStarCount, setGithubStarCount] = useState<number | null>(null);
  const [nostrStarEvents, setNostrStarEvents] = useState<NostrEvent[]>([]);
  const [forkCount, setForkCount] = useState<number>(0);
  const [issueCount, setIssueCount] = useState<number>(0);
  const [prCount, setPrCount] = useState<number>(0);
  const [showRepoQR, setShowRepoQR] = useState(false);
  const [repo, setRepo] = useState<any>(null);
  const [repoLogo, setRepoLogo] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [isOwnerUser, setIsOwnerUser] = useState(false);
  const githubHydrateKeyRef = useRef<string>("");
  const loadRepoAndLogoRef = useRef<() => void>(() => {});

  // Calculate safe initial display name that matches on server and client
  const safeInitialDisplayName = useMemo(() => {
    if (resolvedParams.entity?.startsWith("npub")) {
      return `${resolvedParams.entity.substring(0, 16)}...`;
    }
    return resolvedParams.entity || "Unknown";
  }, [resolvedParams.entity]);

  // Resolve owner using utility hook (needs repo to be loaded)
  // Note: ownerMetadata is fetched internally by the hook but not used directly here
  const {
    ownerPubkey: rawOwnerPubkey,
    ownerDisplayName: rawOwnerDisplayName,
    ownerPicture: rawOwnerPicture,
    ownerMetadata: rawOwnerMetadata,
  } = useEntityOwner({
    entity: resolvedParams.entity,
    repo: repo,
    repoName: resolvedParams.repo,
  });

  // Use safe initial values on server/initial render to prevent hydration mismatches
  // After mount, use actual values from hook
  const ownerPubkey = mounted ? rawOwnerPubkey : null;
  const ownerDisplayName = mounted
    ? rawOwnerDisplayName
    : safeInitialDisplayName;
  const ownerPicture = mounted ? rawOwnerPicture : null;
  const ownerBanner = useMemo(() => {
    if (!mounted || !ownerPubkey) return null;
    const meta = rawOwnerMetadata?.[ownerPubkey] as
      | { banner?: string }
      | undefined;
    const banner = meta?.banner?.trim();
    return banner || null;
  }, [mounted, ownerPubkey, rawOwnerMetadata]);
  const publicReadRaw = repo?.publicRead;
  const isPrivateRepo =
    publicReadRaw === false || publicReadRaw === "false" || publicReadRaw === 0;

  const canViewPrivateContent = useMemo(() => {
    if (!isPrivateRepo) return true;
    if (!pubkey || !repo) return false;
    const repoOwnerPubkey = getRepoOwnerPubkey(repo, resolvedParams.entity);
    const maintainers: string[] =
      (repo as { maintainers?: string[] }).maintainers || [];
    return hasPrivateRepoAccess(
      pubkey,
      repo.contributors,
      repoOwnerPubkey,
      maintainers
    );
  }, [isPrivateRepo, pubkey, repo, resolvedParams.entity]);

  const ownerHexForZaps = useMemo(() => {
    if (!ownerPubkey || !/^[0-9a-f]{64}$/i.test(ownerPubkey)) return "";
    return ownerPubkey.toLowerCase();
  }, [ownerPubkey]);

  const zapBadge = useRepoNip57ZapBadgeTotal({
    ownerHex: ownerHexForZaps,
    entity: resolvedParams.entity,
    repo: resolvedParams.repo,
    subscribe,
    defaultRelays,
    enabled: mounted && !!ownerHexForZaps,
  });

  const [relayRepoEventId, setRelayRepoEventId] = useState<string | null>(
    () => {
      if (typeof window === "undefined") return null;
      return readCachedRepoAnnouncementEventId(
        resolvedParams.entity,
        resolvedParams.repo
      );
    }
  );
  const [resolvingRepoEventId, setResolvingRepoEventId] = useState(false);

  const repoNostrEventId = useMemo(() => {
    const localId = repo?.lastNostrEventId || repo?.nostrEventId;
    const id = relayRepoEventId || localId;
    return typeof id === "string" && /^[0-9a-f]{64}$/i.test(id) ? id : null;
  }, [repo, relayRepoEventId]);

  const canStarOnNostr = useMemo(
    () =>
      !!(
        mounted &&
        ownerPubkey &&
        /^[0-9a-f]{64}$/i.test(ownerPubkey) &&
        repoNostrEventId
      ),
    [mounted, ownerPubkey, repoNostrEventId]
  );

  const githubUpstreamUrl = useMemo(
    () =>
      resolveGithubUpstreamForTabs(
        resolvedParams.entity,
        resolvedParams.repo,
        repo
      ),
    [
      resolvedParams.entity,
      resolvedParams.repo,
      repo?.sourceUrl,
      Array.isArray(repo?.clone) ? repo.clone.join("|") : "",
    ]
  );

  const githubSpec = useMemo(() => {
    if (!githubUpstreamUrl) return null;
    return parseGitHubRepoSpec(githubUpstreamUrl);
  }, [githubUpstreamUrl]);

  const nostrStarsAgg = useMemo(
    () => aggregateRepoStarReactions(nostrStarEvents),
    [nostrStarEvents]
  );
  const nostrStarCount = nostrStarsAgg.count;
  const isNostrStarred =
    !!pubkey && nostrStarsAgg.starers.includes(pubkey.toLowerCase());

  const importStarSnapshot =
    typeof repo?.stars === "number" && Number.isFinite(repo.stars)
      ? repo.stars
      : null;

  const hasUpstreamSourceUrl = !!repo?.sourceUrl?.trim();

  const sourceStarsDisplay = useMemo(() => {
    // GitHub mirror stats are public; do not require a published 30617 id (logged-in
    // localStorage often lacks nostrEventId while route still maps to github.com/entity/repo).
    if (githubSpec && githubStarCount !== null) {
      return {
        label: "GitHub",
        value: githubStarCount,
        href: `https://github.com/${githubSpec.owner}/${githubSpec.repo}/stargazers`,
        title: "Stargazers on GitHub (live)",
      } as const;
    }
    // No upstream URL → nothing to attribute; avoid bogus "Import 0" from local `stars`.
    if (!hasUpstreamSourceUrl && !githubSpec) {
      return null;
    }
    if (importStarSnapshot !== null && importStarSnapshot > 0 && githubSpec) {
      return {
        label: "GitHub",
        value: importStarSnapshot,
        href: `https://github.com/${githubSpec.owner}/${githubSpec.repo}/stargazers`,
        title: "Stars from last import (GitHub link for reference)",
      } as const;
    }
    if (importStarSnapshot !== null && importStarSnapshot > 0) {
      return {
        label: "Import",
        value: importStarSnapshot,
        href: null,
        title: "Stars count from last import or snapshot (not live)",
      } as const;
    }
    return null;
  }, [githubSpec, githubStarCount, importStarSnapshot, hasUpstreamSourceUrl]);

  const nostrStarButtonTitle = useMemo(() => {
    if (resolvingRepoEventId) {
      return "Looking up this repo on Nostr relays…";
    }
    if (!repoNostrEventId) {
      return "No kind 30617 repo announcement on relays yet. Owner must Push to Nostr (or publish with gn) before stars work.";
    }
    if (!pubkey) {
      return "Log in with Nostr to star on relays (NIP-25 kind 7).";
    }
    return "Star on Nostr (NIP-25 kind 7 on this repo’s 30617 event). First star works the same — no prior stars needed.";
  }, [repoNostrEventId, resolvingRepoEventId, pubkey]);

  const zapBadgeTitle = useMemo(
    () =>
      `Tips to this repo’s owner: ${zapBadge.totalSats} sats — ${zapBadge.networkSats} from Nostr zap receipts (kind 9735) seen on your relays for this repo, plus ${zapBadge.localExtraSats} from this browser (paid or a fresh unpaid invoice in the last 72h), not double-counted when a receipt matches the same zap.`,
    [zapBadge]
  );

  // Helper function to generate href for repo links (avoids duplication)
  // Use consistent href on initial render to prevent hydration mismatches
  const isRepoCodePath = useCallback(() => {
    const base = `/${resolvedParams.entity}/${resolvedParams.repo}`;
    return (
      pathname === base ||
      pathname === `${base}/` ||
      pathname === `${base}/next` ||
      pathname === `${base}/next/`
    );
  }, [pathname, resolvedParams.entity, resolvedParams.repo]);

  const isCodeTabActive = useMemo(() => {
    const base = `/${resolvedParams.entity}/${resolvedParams.repo}`;
    return (
      pathname === base ||
      pathname === `${base}/` ||
      pathname === `${base}/next` ||
      pathname === `${base}/next/`
    );
  }, [pathname, resolvedParams.entity, resolvedParams.repo]);

  const getRepoLink = useCallback(
    (subpath = "", preserveCodeSearchParams = false) => {
      const effectiveOwnerPubkey = mounted ? ownerPubkey : null;
      const basePath =
        effectiveOwnerPubkey && /^[0-9a-f]{64}$/i.test(effectiveOwnerPubkey)
          ? `/${nip19.npubEncode(effectiveOwnerPubkey)}/${resolvedParams.repo}${
              subpath ? `/${subpath}` : ""
            }`
          : `/${resolvedParams.entity}/${resolvedParams.repo}${
              subpath ? `/${subpath}` : ""
            }`;
      const sharedBranch = resolveSharedRepoBranch(searchParams, repo, {
        entity: resolvedParams.entity,
        repo: resolvedParams.repo,
      });
      if (preserveCodeSearchParams && isRepoCodePath() && searchParams) {
        return repoNavHref(basePath, sharedBranch, searchParams);
      }
      return repoNavHref(basePath, sharedBranch);
    },
    [
      mounted,
      ownerPubkey,
      resolvedParams.entity,
      resolvedParams.repo,
      searchParams,
      repo,
      isRepoCodePath,
    ]
  );

  /** Code URL with zap modal flag (append correctly when ?branch= is already present). */
  const getZapLink = useCallback(() => {
    const base = getRepoLink("", false);
    return `${base}${base.includes("?") ? "&" : "?"}zap=true`;
  }, [getRepoLink]);

  // Track mount state to prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Code tab file-fetch often resolves 30617 before this layout’s relay query finishes.
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<RepoAnnouncementIdDetail>).detail;
      if (!detail?.eventId) return;
      const entityMatch =
        detail.entity === resolvedParams.entity ||
        detail.entity?.toLowerCase() === resolvedParams.entity?.toLowerCase();
      const repoMatch =
        detail.repo === resolvedParams.repo ||
        detail.repo?.toLowerCase() === resolvedParams.repo?.toLowerCase();
      if (!entityMatch || !repoMatch) return;
      if (/^[0-9a-f]{64}$/i.test(detail.eventId)) {
        cacheRepoAnnouncementEventId(
          resolvedParams.entity,
          resolvedParams.repo,
          detail.eventId
        );
        setRelayRepoEventId(detail.eventId);
      }
    };
    window.addEventListener(REPO_ANNOUNCEMENT_ID_EVENT, handler);
    return () =>
      window.removeEventListener(REPO_ANNOUNCEMENT_ID_EVENT, handler);
  }, [resolvedParams.entity, resolvedParams.repo]);

  useEffect(() => {
    if (!mounted) return;
    const cached = readCachedRepoAnnouncementEventId(
      resolvedParams.entity,
      resolvedParams.repo
    );
    if (cached) setRelayRepoEventId((prev) => prev || cached);
  }, [mounted, resolvedParams.entity, resolvedParams.repo]);

  useEffect(() => {
    githubHydrateKeyRef.current = "";
  }, [resolvedParams.entity, resolvedParams.repo, githubUpstreamUrl]);

  // After localStorage clear (or cold anonymous visit), Public/Private badge still
  // needs public-read from the latest kind 30617 — local row alone is not enough.
  useEffect(() => {
    if (!mounted || !subscribe || !defaultRelays?.length) return;

    let ownerHex =
      ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey)
        ? ownerPubkey.toLowerCase()
        : "";
    if (!ownerHex && resolvedParams.entity?.startsWith("npub")) {
      try {
        const decoded = nip19.decode(resolvedParams.entity);
        if (decoded.type === "npub" && typeof decoded.data === "string") {
          ownerHex = decoded.data.toLowerCase();
        }
      } catch {
        /* ignore */
      }
    }
    if (!ownerHex) return;

    const repoName = decodeURIComponent(resolvedParams.repo || "");
    if (!repoName) return;

    let latest: { created_at?: number; tags?: string[][] } | null = null;
    let cancelled = false;
    const unsub = subscribe(
      [
        {
          kinds: [KIND_REPOSITORY_NIP34],
          authors: [ownerHex],
          "#d": [repoName],
          limit: 5,
        },
      ],
      getAllRelays(defaultRelays),
      (event) => {
        if (
          !latest ||
          (event.created_at || 0) >= (latest.created_at || 0)
        ) {
          latest = event;
        }
      },
      5000,
      () => {
        if (cancelled || !latest) return;
        const publicRead = isPublicReadFromEvent(latest as any);
        setRepo((prev: any) => {
          if (prev) {
            if (prev.publicRead === publicRead) return prev;
            return { ...prev, publicRead };
          }
          return {
            entity: resolvedParams.entity,
            repo: repoName,
            ownerPubkey: ownerHex,
            publicRead,
          };
        });
      }
    );

    return () => {
      cancelled = true;
      try {
        unsub?.();
      } catch {
        /* ignore */
      }
    };
  }, [
    mounted,
    subscribe,
    defaultRelays,
    ownerPubkey,
    resolvedParams.entity,
    resolvedParams.repo,
  ]);

  // Load repo data first (used by useEntityOwner hook)
  const loadRepoAndLogo = useCallback(() => {
    if (!mounted) return; // Don't access localStorage until mounted

    try {
      const repos = loadStoredRepos();
      const foundRepo = findRepoByEntityAndName<StoredRepo>(
        repos,
        resolvedParams.entity,
        resolvedParams.repo
      );
      setRepo((prev: any) => {
        if (foundRepo) {
          // Prefer explicit private from Nostr hydrate over a stale local public default
          if (
            prev &&
            prev.publicRead === false &&
            (foundRepo as { publicRead?: boolean }).publicRead !== false
          ) {
            return { ...foundRepo, publicRead: false };
          }
          return foundRepo;
        }
        // Keep Nostr-hydrated stub (badge/ACL) when there is no localStorage row
        if (prev && prev.publicRead !== undefined) return prev;
        return null;
      });
      setForkCount(
        foundRepo &&
          typeof (foundRepo as { forks?: unknown }).forks === "number"
          ? (foundRepo as { forks: number }).forks ?? 0
          : 0
      );

      // Check if current user is owner
      if (foundRepo && pubkey) {
        const repoOwnerPubkey = getRepoOwnerPubkey(
          foundRepo,
          resolvedParams.entity
        );
        const userIsOwner = isOwner(
          pubkey,
          foundRepo.contributors,
          repoOwnerPubkey
        );
        const canManage = canManageSettings(
          foundRepo.contributors?.find(
            (c: StoredContributor) =>
              c.pubkey && c.pubkey.toLowerCase() === pubkey.toLowerCase()
          ) || null
        );
        setIsOwnerUser(userIsOwner || canManage);
      } else {
        setIsOwnerUser(false);
      }

      // Load repo logo if available
      if (foundRepo) {
        // Priority 1: Stored logoUrl (runtime property, not in type)
        const repoAny = foundRepo as any;
        if (repoAny.logoUrl) {
          let logoUrl = repoAny.logoUrl.trim();
          // Auto-add https:// if missing
          if (
            !logoUrl.startsWith("http://") &&
            !logoUrl.startsWith("https://") &&
            !logoUrl.startsWith("data:") &&
            !logoUrl.startsWith("/") &&
            logoUrl.includes(".") &&
            !logoUrl.includes("@")
          ) {
            logoUrl = `https://${logoUrl}`;
          }
          if (
            logoUrl.startsWith("http://") ||
            logoUrl.startsWith("https://") ||
            logoUrl.startsWith("data:") ||
            logoUrl.startsWith("/")
          ) {
            setRepoLogo(logoUrl);
            return;
          }
        }

        // Priority 2: Logo files from repo
        const repoName = (foundRepo.name || foundRepo.repo || "")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
        const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"];

        const candidates = (foundRepo.files || [])
          .map((f: any) => f.path)
          .filter((p: string) => {
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

            // Match repo-name-based files (e.g., "gittr.png" for gittr repo)
            if (repoName && baseName === repoName) return true;

            // Match common icon names in root directory only
            if (
              isRoot &&
              (baseName === "repo" ||
                baseName === "icon" ||
                baseName === "favicon")
            )
              return true;

            return false;
          })
          .sort((a: string, b: string) => {
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

            // Priority 2: Repo-name-based files
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
            if (!bIsRoot && aIsRoot) return 1;

            // Priority 4: Format preference (png > svg > webp > jpg > gif > ico)
            const formatPriority: Record<string, number> = {
              png: 0,
              svg: 1,
              webp: 2,
              jpg: 3,
              jpeg: 3,
              gif: 4,
              ico: 5,
            };
            const aExt = a.split(".").pop()?.toLowerCase() || "";
            const bExt = b.split(".").pop()?.toLowerCase() || "";
            const aPrio = formatPriority[aExt] ?? 10;
            const bPrio = formatPriority[bExt] ?? 10;

            return aPrio - bPrio;
          });

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

        // Try each candidate logo file
        for (const logoPath of candidates) {
          // Try sourceUrl first
          const gitUrl: string | undefined = foundRepo.sourceUrl;
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
            foundRepo.clone &&
            Array.isArray(foundRepo.clone) &&
            foundRepo.clone.length > 0
          ) {
            // Find first GitHub/GitLab/Codeberg URL in clone array
            const gitCloneUrl = foundRepo.clone.find(
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
            const { owner, repo, hostname } = ownerRepo;
            const branch = foundRepo.defaultBranch || "main";

            if (hostname === "github.com" || hostname.includes("github.com")) {
              setRepoLogo(
                `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(
                  branch
                )}/${logoPath}`
              );
              return;
            } else if (
              hostname === "gitlab.com" ||
              hostname.includes("gitlab.com")
            ) {
              setRepoLogo(
                `https://gitlab.com/${owner}/${repo}/-/raw/${encodeURIComponent(
                  branch
                )}/${logoPath}`
              );
              return;
            } else if (
              hostname === "codeberg.org" ||
              hostname.includes("codeberg.org")
            ) {
              setRepoLogo(
                `https://codeberg.org/${owner}/${repo}/raw/branch/${encodeURIComponent(
                  branch
                )}/${logoPath}`
              );
              return;
            }
          }

          // For Nostr-native repos without sourceUrl, try bridge API directly
          // Get owner pubkey from entity or repo
          let ownerPubkeyForBridge: string | undefined;
          if (
            resolvedParams.entity &&
            resolvedParams.entity.length === 64 &&
            /^[0-9a-f]{64}$/i.test(resolvedParams.entity)
          ) {
            ownerPubkeyForBridge = resolvedParams.entity;
          } else if (
            foundRepo.ownerPubkey &&
            /^[0-9a-f]{64}$/i.test(foundRepo.ownerPubkey)
          ) {
            ownerPubkeyForBridge = foundRepo.ownerPubkey;
          } else if (ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey)) {
            ownerPubkeyForBridge = ownerPubkey;
          }

          // CRITICAL: Use repositoryName from Nostr event (exact name used by git-nostr-bridge)
          // Priority: repositoryName > name > repo > slug
          const repoDataAny = foundRepo as any;
          let repoName =
            repoDataAny?.repositoryName ||
            foundRepo.name ||
            foundRepo.repo ||
            foundRepo.slug;

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

          if (ownerPubkeyForBridge && repoName) {
            const branch = foundRepo.defaultBranch || "main";
            const bridgeApiUrl = `/api/nostr/repo/file-content?ownerPubkey=${encodeURIComponent(
              ownerPubkeyForBridge
            )}&repo=${encodeURIComponent(repoName)}&path=${encodeURIComponent(
              logoPath
            )}&branch=${encodeURIComponent(branch)}`;

            // For images, try using the API URL directly (browser can load it)
            setRepoLogo(bridgeApiUrl);
            return;
          }
        }
      }

      // No repo logo found
      setRepoLogo(null);
    } catch {}
  }, [
    resolvedParams.entity,
    resolvedParams.repo,
    mounted,
    ownerPubkey,
    pubkey,
  ]);

  // Initial load
  useEffect(() => {
    loadRepoAndLogo();
  }, [loadRepoAndLogo]);

  // Listen for repo updates and re-resolve logo
  useEffect(() => {
    if (!mounted) return;

    const handleRepoUpdate = () => {
      loadRepoAndLogo();
    };

    window.addEventListener("gittr:repos-updated", handleRepoUpdate);
    window.addEventListener("storage", (e) => {
      if (e.key === "gittr_repos") {
        loadRepoAndLogo();
      }
    });

    return () => {
      window.removeEventListener("gittr:repos-updated", handleRepoUpdate);
    };
  }, [mounted, loadRepoAndLogo]);

  // Load watch list from localStorage (NIP-51 kind 10018 is canonical on relays)
  useEffect(() => {
    if (!pubkey) return;
    try {
      const repoId = `${resolvedParams.entity}/${resolvedParams.repo}`;
      const watched = JSON.parse(
        localStorage.getItem("gittr_watched_repos") || "[]"
      ) as string[];
      setIsWatching(watched.includes(repoId));
    } catch {}
  }, [resolvedParams.entity, resolvedParams.repo, pubkey, repo]);

  // Live GitHub star count when `sourceUrl` points at github.com
  useEffect(() => {
    if (!mounted || !githubSpec) {
      setGithubStarCount(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/github/public-repo-stats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repos: [{ owner: githubSpec.owner, repo: githubSpec.repo }],
          }),
        });
        if (!r.ok) return;
        const j = (await r.json()) as {
          stats?: Record<string, { stars?: number }>;
        };
        const stat = j.stats?.[`${githubSpec.owner}/${githubSpec.repo}`];
        if (!cancelled && typeof stat?.stars === "number") {
          setGithubStarCount(stat.stars);
        }
      } catch {
        if (!cancelled) setGithubStarCount(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mounted, githubSpec?.owner, githubSpec?.repo]);

  // NIP-25 kind 7 reactions (#e = repo 30617 event, #k = 30617)
  useEffect(() => {
    if (!mounted || !subscribe || !defaultRelays?.length || !repoNostrEventId) {
      setNostrStarEvents([]);
      return;
    }
    setNostrStarEvents([]);
    const collected = new Map<string, NostrEvent>();
    const relays = getAllRelays(defaultRelays);
    const unsub = subscribe(
      [
        {
          kinds: [7],
          "#e": [repoNostrEventId],
          limit: 500,
        },
      ],
      relays,
      (event) => {
        if (!isRepoStarReaction(event as NostrEvent, repoNostrEventId)) return;
        collected.set(event.id, event as NostrEvent);
        setNostrStarEvents(Array.from(collected.values()));
      },
      undefined,
      undefined,
      {}
    );
    return () => {
      try {
        unsub?.();
      } catch {
        /* ignore */
      }
    };
  }, [mounted, subscribe, defaultRelays, repoNostrEventId]);

  // Always resolve latest kind 30617 from relays (local id may be missing or stale).
  useEffect(() => {
    if (!mounted || !subscribe || !defaultRelays?.length || !ownerPubkey) {
      return;
    }
    if (!/^[0-9a-f]{64}$/i.test(ownerPubkey)) return;
    const repoIdentifier =
      (repo as { repositoryName?: string; repo?: string; slug?: string } | null)
        ?.repositoryName ||
      (repo as { repositoryName?: string; repo?: string; slug?: string } | null)
        ?.repo ||
      resolvedParams.repo;
    if (!repoIdentifier) return;

    let cancelled = false;
    setResolvingRepoEventId(true);
    const relays = getAllRelays(defaultRelays);
    void queryRepoAnnouncementEventId(
      subscribe as RelaySubscribeFn,
      relays,
      ownerPubkey,
      repoIdentifier,
      { timeoutMs: 8000, repo }
    )
      .then((id) => {
        if (!cancelled) setRelayRepoEventId(id);
      })
      .finally(() => {
        if (!cancelled) setResolvingRepoEventId(false);
      });
    return () => {
      cancelled = true;
      setResolvingRepoEventId(false);
    };
  }, [
    mounted,
    subscribe,
    defaultRelays,
    ownerPubkey,
    repo,
    resolvedParams.repo,
  ]);

  // Sync watch state from canonical NIP-51 list (kind 10018)
  useEffect(() => {
    if (!pubkey || !subscribe || !defaultRelays || defaultRelays.length === 0) {
      return;
    }
    if (!ownerPubkey || !/^[0-9a-f]{64}$/i.test(ownerPubkey)) {
      return;
    }

    const repoIdentifier =
      (repo as { repositoryName?: string; repo?: string; slug?: string } | null)
        ?.repositoryName ||
      (repo as { repositoryName?: string; repo?: string; slug?: string } | null)
        ?.repo ||
      resolvedParams.repo;
    if (!repoIdentifier) return;

    const repoAddress = `30617:${ownerPubkey}:${repoIdentifier}`;
    let latestEvent: { created_at?: number; tags?: unknown } | null = null;

    const unsub = subscribe(
      [
        {
          kinds: [KIND_GIT_REPOSITORIES_LIST],
          authors: [pubkey],
          limit: 1,
        },
      ],
      defaultRelays,
      (event) => {
        if (
          !latestEvent ||
          (event.created_at || 0) >= (latestEvent.created_at || 0)
        ) {
          latestEvent = event;
        }
      },
      3000,
      () => {
        if (!latestEvent) return;
        const followed = parseGitRepositoriesListEvent(latestEvent);
        const isFollowed = followed.includes(repoAddress);
        setIsWatching(isFollowed);
      }
    );

    return () => {
      unsub();
    };
  }, [
    pubkey,
    subscribe,
    defaultRelays,
    ownerPubkey,
    repo,
    resolvedParams.repo,
  ]);

  const refreshOpenIssuePrCounts = useCallback(() => {
    try {
      const prs = readRepoPullsFromLocalStorage(
        resolvedParams.entity,
        resolvedParams.repo
      ) as any[];
      const issues = readRepoIssuesFromLocalStorage(
        resolvedParams.entity,
        resolvedParams.repo
      ) as any[];
      setPrCount(
        prs.filter((pr: any) => normalizePrListStatus(pr.status) === "open")
          .length
      );
      setIssueCount(
        issues.filter(
          (issue: any) => normalizeIssueListStatus(issue.status) === "open"
        ).length
      );
    } catch {
      setPrCount(0);
      setIssueCount(0);
    }
  }, [resolvedParams.entity, resolvedParams.repo]);

  // GitHub issues/PRs + forge metadata (runs on Code tab too — not only Issues/PRs subpages)
  useEffect(() => {
    if (!mounted || !resolvedParams.entity || !resolvedParams.repo) return;

    const routeKey = `${resolvedParams.entity}/${resolvedParams.repo}`;
    refreshOpenIssuePrCounts();

    if (githubHydrateKeyRef.current === routeKey) return;

    let cancelled = false;
    let retryTimer: number | undefined;

    const runHydrate = (attempt: number) => {
      if (cancelled || githubHydrateKeyRef.current === routeKey) return;
      const record = findStoredRepoForRoute(
        resolvedParams.entity,
        resolvedParams.repo
      );
      void (async () => {
        try {
          const { sourceUrl, meta, synced } = await hydrateRepoFromGithub(
            resolvedParams.entity,
            resolvedParams.repo,
            {
              repoRecord: record ?? null,
              subscribe: subscribe ?? undefined,
              defaultRelays: defaultRelays?.length ? defaultRelays : undefined,
            }
          );
          if (cancelled) return;
          if (meta) {
            setForkCount(meta.forks);
            if (typeof meta.stars === "number") {
              setGithubStarCount(meta.stars);
            }
          }
          refreshOpenIssuePrCounts();
          if (synced) {
            githubHydrateKeyRef.current = routeKey;
            window.dispatchEvent(new Event("gittr:issue-updated"));
            window.dispatchEvent(new Event("gittr:pr-updated"));
            loadRepoAndLogoRef.current();
            return;
          }
          if (sourceUrl && attempt < 2 && !cancelled) {
            retryTimer = window.setTimeout(() => runHydrate(attempt + 1), 2500);
            return;
          }
          if (sourceUrl) {
            loadRepoAndLogoRef.current();
          }
        } catch {
          if (attempt < 2 && !cancelled) {
            retryTimer = window.setTimeout(() => runHydrate(attempt + 1), 2500);
          }
        }
      })();
    };

    const timer = window.setTimeout(() => runHydrate(0), 400);

    const onReposUpdated = () => {
      if (githubHydrateKeyRef.current === routeKey) return;
      runHydrate(0);
    };
    window.addEventListener("gittr:repos-updated", onReposUpdated);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (retryTimer) window.clearTimeout(retryTimer);
      window.removeEventListener("gittr:repos-updated", onReposUpdated);
    };
  }, [
    mounted,
    resolvedParams.entity,
    resolvedParams.repo,
    githubUpstreamUrl,
    subscribe,
    defaultRelays?.join("|") ?? "",
    refreshOpenIssuePrCounts,
  ]);

  // Dynamic counts for issues/PRs (only open items)
  useEffect(() => {
    refreshOpenIssuePrCounts();

    // Listen for changes to PRs and issues
    const handleStorageChange = (e: StorageEvent) => {
      const prCanon = getRepoStorageKey(
        "gittr_prs",
        resolvedParams.entity,
        resolvedParams.repo
      );
      const issueCanon = getRepoStorageKey(
        "gittr_issues",
        resolvedParams.entity,
        resolvedParams.repo
      );
      const repoSuffix = `__${resolvedParams.repo}`;
      if (
        e.key === prCanon ||
        e.key === issueCanon ||
        (e.key?.startsWith("gittr_prs__") && e.key.endsWith(repoSuffix)) ||
        (e.key?.startsWith("gittr_issues__") && e.key.endsWith(repoSuffix))
      ) {
        refreshOpenIssuePrCounts();
      }
    };

    // Listen for custom events when PRs/issues are updated
    const handlePRUpdate = () => refreshOpenIssuePrCounts();
    const handleIssueUpdate = () => refreshOpenIssuePrCounts();

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("gittr:pr-updated", handlePRUpdate);
    window.addEventListener("gittr:issue-updated", handleIssueUpdate);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("gittr:pr-updated", handlePRUpdate);
      window.removeEventListener("gittr:issue-updated", handleIssueUpdate);
    };
  }, [resolvedParams.entity, resolvedParams.repo, refreshOpenIssuePrCounts]);

  const handleWatch = useCallback(() => {
    if (!pubkey) return;
    try {
      const repoId = `${resolvedParams.entity}/${resolvedParams.repo}`;
      const repoIdentifier =
        (
          repo as {
            repositoryName?: string;
            repo?: string;
            slug?: string;
          } | null
        )?.repositoryName ||
        (
          repo as {
            repositoryName?: string;
            repo?: string;
            slug?: string;
          } | null
        )?.repo ||
        resolvedParams.repo;
      const repoAddress =
        ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey)
          ? `30617:${ownerPubkey}:${repoIdentifier}`
          : null;
      const watched = JSON.parse(
        localStorage.getItem("gittr_watched_repos") || "[]"
      ) as string[];
      if (isWatching) {
        localStorage.setItem(
          "gittr_watched_repos",
          JSON.stringify(watched.filter((r) => r !== repoId))
        );
        setIsWatching(false);
      } else {
        localStorage.setItem(
          "gittr_watched_repos",
          JSON.stringify([...watched, repoId])
        );
        setIsWatching(true);
      }

      // NIP-51: kind 10018 is a *standard list* — clients publish the full set of `a`
      // tags each time (replaceable per pubkey+kind), not a relay-level incremental API.
      if (
        repoAddress &&
        publish &&
        defaultRelays &&
        defaultRelays.length > 0 &&
        typeof window !== "undefined" &&
        window.nostr
      ) {
        const nextWatched = isWatching
          ? watched.filter((r) => r !== repoId)
          : [...watched, repoId];
        const watchedRepoAddresses = new Set<string>();
        const storedRepos = loadStoredRepos();
        nextWatched.forEach((watchedRepoId) => {
          const [watchedEntity, watchedRepoName] = watchedRepoId.split("/");
          if (!watchedEntity || !watchedRepoName) return;
          const found = findRepoByEntityAndName<StoredRepo>(
            storedRepos,
            watchedEntity,
            watchedRepoName
          );
          const watchedOwnerPubkey = found
            ? getRepoOwnerPubkey(found, watchedEntity)
            : watchedEntity;
          if (
            !watchedOwnerPubkey ||
            !/^[0-9a-f]{64}$/i.test(watchedOwnerPubkey)
          ) {
            return;
          }
          const watchedRepoIdentifier =
            (
              found as {
                repositoryName?: string;
                repo?: string;
                slug?: string;
              } | null
            )?.repositoryName ||
            (
              found as {
                repositoryName?: string;
                repo?: string;
                slug?: string;
              } | null
            )?.repo ||
            watchedRepoName;
          watchedRepoAddresses.add(
            `30617:${watchedOwnerPubkey}:${watchedRepoIdentifier}`
          );
        });
        if (!isWatching) {
          watchedRepoAddresses.add(repoAddress);
        }

        const createdAt = Math.floor(Date.now() / 1000);
        const unsignedEvent = {
          kind: KIND_GIT_REPOSITORIES_LIST,
          created_at: createdAt,
          tags: Array.from(watchedRepoAddresses).map((address) => [
            "a",
            address,
          ]),
          content: "",
          pubkey,
        };
        void window.nostr
          .signEvent(unsignedEvent as UnsignedEvent)
          .then((signedEvent) => {
            publish(signedEvent, defaultRelays);
          })
          .catch((error) => {
            console.warn(
              "[Repo Watch] Failed to publish kind 10018 list:",
              error
            );
          });
      }

      // Notify repo pages to refresh their counters
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("gittr:repos-updated"));
      }
    } catch {}
  }, [
    resolvedParams.entity,
    resolvedParams.repo,
    isWatching,
    pubkey,
    repo,
    ownerPubkey,
    publish,
    defaultRelays,
  ]);

  const mergeNostrStarEvent = useCallback((ev: NostrEvent) => {
    setNostrStarEvents((prev) => {
      const m = new Map(prev.map((e) => [e.id, e]));
      m.set(ev.id, ev);
      return Array.from(m.values());
    });
  }, []);

  const handleNostrStar = useCallback(async () => {
    if (!pubkey) {
      showToast("Log in with Nostr (NIP-07) to star.", "error");
      return;
    }
    if (!ownerPubkey || !/^[0-9a-f]{64}$/i.test(ownerPubkey)) {
      showToast("Still resolving repo owner — try again in a moment.", "error");
      return;
    }
    if (!repoNostrEventId) {
      showToast(
        "This repo is not on relays as kind 30617 yet. The owner needs Push to Nostr first.",
        "error"
      );
      return;
    }
    if (!publish) {
      showToast("Nostr connection not ready.", "error");
      return;
    }

    const getSigner = async () => {
      if (
        typeof window !== "undefined" &&
        typeof window.nostr?.signEvent === "function"
      ) {
        const wn = window.nostr;
        return {
          signEvent: (e: Parameters<typeof wn.signEvent>[0]) => wn.signEvent(e),
        };
      }
      if (remoteSigner?.getState?.() === "ready") {
        return {
          signEvent: (e: Parameters<typeof remoteSigner.signEvent>[0]) =>
            remoteSigner.signEvent(e),
        };
      }
      throw new Error(
        "Connect a Nostr signer (browser extension or remote signer) to star this repo."
      );
    };
    const publishRelays = getAllRelays(defaultRelays);
    const doPublish = (event: NostrEvent) => {
      publish(event, publishRelays);
    };
    const ownerHex = ownerPubkey.toLowerCase();
    const repoId = `${resolvedParams.entity}/${resolvedParams.repo}`;

    const syncLocalStarsIndex = (add: boolean) => {
      if (typeof window === "undefined") return;
      try {
        const starred = JSON.parse(
          localStorage.getItem("gittr_starred_repos") || "[]"
        ) as string[];
        const next = add
          ? starred.includes(repoId)
            ? starred
            : [...starred, repoId]
          : starred.filter((r) => r !== repoId);
        localStorage.setItem("gittr_starred_repos", JSON.stringify(next));
        window.dispatchEvent(new Event("gittr:stars-updated"));
        window.dispatchEvent(new Event("gittr:repos-updated"));
      } catch {
        /* ignore */
      }
    };

    if (isNostrStarred) {
      const r = await removeStarReaction(
        repoNostrEventId,
        ownerHex,
        doPublish,
        getSigner
      );
      if (r.success && r.signedEvent) {
        mergeNostrStarEvent(r.signedEvent as NostrEvent);
        syncLocalStarsIndex(false);
        showToast("Unstarred on Nostr.", "success");
      } else {
        showToast(
          r.error || "Could not unstar — check extension approval.",
          "error"
        );
      }
    } else {
      const r = await publishStarReaction(
        repoNostrEventId,
        ownerHex,
        doPublish,
        getSigner
      );
      if (r.success && r.signedEvent) {
        mergeNostrStarEvent(r.signedEvent as NostrEvent);
        syncLocalStarsIndex(true);
        showToast("Starred on Nostr (NIP-25).", "success");
      } else {
        showToast(
          r.error ||
            "Could not publish star — approve the extension prompt or try another relay.",
          "error"
        );
      }
    }
  }, [
    pubkey,
    repoNostrEventId,
    ownerPubkey,
    isNostrStarred,
    publish,
    defaultRelays,
    remoteSigner,
    mergeNostrStarEvent,
    resolvedParams.entity,
    resolvedParams.repo,
  ]);

  const handleFork = useCallback(() => {
    // Fork functionality - navigate to fork page or show modal
    // For now, just navigate to new repo page with fork info
    if (typeof window !== "undefined") {
      window.location.href = `/new?fork=${resolvedParams.entity}/${resolvedParams.repo}`;
    }
  }, [resolvedParams.entity, resolvedParams.repo]);

  useEffect(() => {
    // Set initial window width after mount to prevent hydration mismatch
    setWindowWidth(window.innerWidth);

    // Debounce resize handler to prevent rapid recalculations and layout shifts
    let resizeTimeout: NodeJS.Timeout;
    const handleWindowResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        setWindowWidth(window.innerWidth);
      }, 150); // Debounce by 150ms
    };

    window.addEventListener("resize", handleWindowResize);

    return () => {
      clearTimeout(resizeTimeout);
      window.removeEventListener("resize", handleWindowResize);
    };
  }, []); // Add empty dependency array to prevent re-running on every render

  // Filter menu items: hide all tabs for unauthorized private-repo viewers;
  // hide Settings for non-owners on repos the viewer can access.
  const filteredMenuItems = useMemo(() => {
    if (!canViewPrivateContent) return [];
    return menuItems.filter((item) => {
      if (item.link !== "settings") return true;
      return isOwnerUser;
    });
  }, [isOwnerUser, canViewPrivateContent]);

  // Memoize the number of visible menu items to prevent recalculation on every render
  const pinnedOverflowItems = useMemo(
    () =>
      filteredMenuItems.filter(
        (item) => item.link && FORCED_OVERFLOW_LINKS.has(item.link)
      ),
    [filteredMenuItems]
  );

  const primaryMenuItems = useMemo(
    () =>
      filteredMenuItems.filter(
        (item) => !(item.link && FORCED_OVERFLOW_LINKS.has(item.link))
      ),
    [filteredMenuItems]
  );

  const visibleMenuItemsCount = useMemo(() => {
    const effectiveWidth = mounted ? windowWidth : 1920;
    const availableWidth = Math.max(0, effectiveWidth - HEADER_RESERVED_WIDTH);
    return Math.max(1, Math.floor(availableWidth / MENU_ITEM_WIDTH));
  }, [mounted, windowWidth, primaryMenuItems.length]);

  const visiblePrimaryItems = useMemo(
    () => primaryMenuItems.slice(0, visibleMenuItemsCount),
    [primaryMenuItems, visibleMenuItemsCount]
  );

  const overflowMenuItems = useMemo(
    () => [
      ...primaryMenuItems.slice(visibleMenuItemsCount),
      ...pinnedOverflowItems,
    ],
    [primaryMenuItems, visibleMenuItemsCount, pinnedOverflowItems]
  );

  // Removed onClick handler that was interfering with navigation

  const ownerProfileHref =
    ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey)
      ? `/${nip19.npubEncode(ownerPubkey)}`
      : `/${resolvedParams.entity}`;

  const headerAvatarSrc =
    mounted && repoLogo
      ? repoLogo
      : mounted && !repoLogo && ownerPicture
      ? ownerPicture
      : "/logo.svg";

  return (
    <>
      {/* Identity hero — all repo tabs (Code, Issues, Settings, …) */}
      <div
        className="w-full h-[132px] bg-[var(--color-bg-secondary)] bg-cover bg-center relative"
        style={
          ownerBanner
            ? {
                backgroundImage: `linear-gradient(180deg, transparent 35%, var(--color-bg-primary)), url(${ownerBanner})`,
              }
            : {
                backgroundImage:
                  "linear-gradient(180deg, var(--color-bg-secondary), var(--color-bg-primary))",
              }
        }
        role="img"
        aria-label={
          ownerBanner
            ? "Owner Nostr profile banner"
            : "Default banner (no kind-0 banner)"
        }
      />

      <section className="max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] mx-auto px-4 md:px-6 py-6">
        <div className="justify-between flex flex-col lg:flex-row overflow-visible gap-3">
          <div className="mb-2 flex items-start gap-3 min-w-0">
            <div className="relative z-[2] -mt-10 h-[76px] w-[76px] flex-shrink-0 rounded-full overflow-hidden border-[3px] border-[var(--color-bg-primary)] bg-[var(--color-bg-secondary)] shadow-md">
              <img
                src={headerAvatarSrc}
                alt={ownerDisplayName}
                className="h-full w-full object-cover"
                onError={(e) => {
                  const target = e.currentTarget;
                  if (target.src !== "/logo.svg") {
                    target.src = "/logo.svg";
                  }
                }}
                referrerPolicy="no-referrer"
                suppressHydrationWarning
              />
            </div>
            <div className="min-w-0 pt-1">
              <div className="flex flex-wrap items-baseline gap-x-1 text-lg">
                <Link
                  className="text-[var(--color-link)] hover:underline font-semibold"
                  href={ownerProfileHref}
                  suppressHydrationWarning
                >
                  {ownerDisplayName}
                </Link>
                <span className="text-[var(--color-text-secondary)]">/</span>
                <Link
                  className="text-[var(--color-text-primary)] hover:underline font-semibold"
                  href={getRepoLink()}
                >
                  {decodeURIComponent(resolvedParams.repo)}
                </Link>
                <span className="border-[var(--color-border)] text-[var(--color-text-secondary)] ml-1 rounded-full border px-1.5 text-xs">
                  {isPrivateRepo ? "Private" : "Public"}
                </span>
              </div>
            </div>
          </div>

          {canViewPrivateContent ? (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger
                  className={clsx(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "h-8 !border-[#383B42] bg-[#22262C] text-xs md:hidden"
                  )}
                  type="button"
                >
                  Actions <ChevronDown className="ml-2 h-4 w-4 text-white" />
                </DropdownMenuTrigger>
                <DropdownMenuContent className="ml-8 mt-2">
                  <DropdownMenuItem
                    key="watch"
                    title={WATCH_BUTTON_TITLE}
                    onClick={handleWatch}
                  >
                    <Eye className="mr-2 h-4 w-4" />{" "}
                    {isWatching ? "Unwatch" : "Watch"}
                    <Badge className="ml-2">{isWatching ? 1 : 0}</Badge>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    key="zaps"
                    title={zapBadgeTitle}
                    onClick={() => {
                      router.push(getZapLink());
                    }}
                  >
                    <Zap className="mr-2 h-4 w-4" /> Zaps
                    <Badge className="ml-2">{zapBadge.totalSats}</Badge>
                  </DropdownMenuItem>
                  {/* Relays status not yet implemented */}
                  <DropdownMenuItem key="fork" onClick={handleFork}>
                    <GitFork className="mr-2 h-4 w-4" /> Fork
                    <Badge className="ml-2">{forkCount}</Badge>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    key="nostr-star"
                    title={nostrStarButtonTitle}
                    disabled={!pubkey || !repoNostrEventId}
                    onClick={() => {
                      void handleNostrStar();
                    }}
                  >
                    <Star
                      className={`mr-2 h-4 w-4 ${
                        isNostrStarred ? "text-yellow-500 fill-yellow-500" : ""
                      }`}
                    />{" "}
                    Star
                    <Badge className="ml-2">{nostrStarCount}</Badge>
                  </DropdownMenuItem>
                  {sourceStarsDisplay ? (
                    <DropdownMenuItem
                      key="source-stars"
                      className="opacity-100"
                      disabled={!sourceStarsDisplay.href}
                      onClick={() => {
                        if (sourceStarsDisplay.href)
                          window.open(sourceStarsDisplay.href, "_blank");
                      }}
                    >
                      <Star className="mr-2 h-4 w-4" />
                      {sourceStarsDisplay.label}
                      <Badge className="ml-2">{sourceStarsDisplay.value}</Badge>
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    key="share"
                    onClick={() => setShowRepoQR(true)}
                  >
                    <Share2 className="mr-2 h-4 w-4" /> Share
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="flex justify-end">
                <div className="hidden md:flex md:flex-row md:gap-2">
                  <Button
                    className="h-8 !border-[#383B42] bg-[#22262C] text-xs"
                    variant="outline"
                    title={WATCH_BUTTON_TITLE}
                    onClick={handleWatch}
                    disabled={!mounted || !pubkey}
                    suppressHydrationWarning
                  >
                    <Eye className="mr-2 h-4 w-4" />{" "}
                    {isWatching ? "Unwatch" : "Watch"}
                    <Badge className="ml-2">{isWatching ? 1 : 0}</Badge>
                  </Button>
                  <Link href={getZapLink()} title={zapBadgeTitle}>
                    <Button
                      className="h-8 !border-[#383B42] bg-[#22262C] text-xs"
                      variant="outline"
                    >
                      <Zap className="mr-2 h-4 w-4" /> Zaps
                      <Badge className="ml-2">{zapBadge.totalSats}</Badge>
                    </Button>
                  </Link>
                  {/* Relays status not yet implemented */}
                  <Button
                    className="h-8 !border-[#383B42] bg-[#22262C] text-xs"
                    variant="outline"
                    onClick={handleFork}
                    disabled={!mounted || !pubkey}
                    suppressHydrationWarning
                  >
                    <GitFork className="mr-2 h-4 w-4" /> Fork
                    <Badge className="ml-2">{forkCount}</Badge>
                  </Button>
                  <Button
                    className={`h-8 !border-[#383B42] bg-[#22262C] text-xs ${
                      isNostrStarred ? "hover:bg-[#22262C]" : ""
                    }`}
                    variant="outline"
                    title={nostrStarButtonTitle}
                    onClick={() => {
                      void handleNostrStar();
                    }}
                    disabled={!canStarOnNostr}
                    suppressHydrationWarning
                  >
                    <Star
                      className={`mr-2 h-4 w-4 ${
                        isNostrStarred ? "text-yellow-500 fill-yellow-500" : ""
                      }`}
                    />{" "}
                    Star
                    <Badge className="ml-2">{nostrStarCount}</Badge>
                  </Button>
                  {sourceStarsDisplay ? (
                    sourceStarsDisplay.href ? (
                      <a
                        href={sourceStarsDisplay.href}
                        target="_blank"
                        rel="noreferrer"
                        title={sourceStarsDisplay.title}
                      >
                        <Button
                          className="h-8 !border-[#383B42] bg-[#22262C] text-xs"
                          variant="outline"
                          type="button"
                        >
                          <Star className="mr-2 h-4 w-4" />
                          {sourceStarsDisplay.label}
                          <Badge className="ml-2">
                            {sourceStarsDisplay.value}
                          </Badge>
                        </Button>
                      </a>
                    ) : (
                      <Button
                        className="h-8 !border-[#383B42] bg-[#22262C] text-xs cursor-default"
                        variant="outline"
                        type="button"
                        title={sourceStarsDisplay.title}
                        disabled
                      >
                        <Star className="mr-2 h-4 w-4" />
                        {sourceStarsDisplay.label}
                        <Badge className="ml-2">
                          {sourceStarsDisplay.value}
                        </Badge>
                      </Button>
                    )
                  ) : null}
                  <Button
                    className="h-8 !border-[#383B42] bg-[#22262C] text-xs"
                    variant="outline"
                    onClick={() => setShowRepoQR(true)}
                  >
                    <Share2 className="mr-2 h-4 w-4" /> Share
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </div>

        <div className="flex justify-between items-center gap-4">
          <div className="flex-1 overflow-x-auto">
            <ul className="my-4 flex items-center gap-x-4 min-w-max">
              {visiblePrimaryItems.map((item, index) => (
                <li
                  key={`${item.name}-${item.link}-${index}`}
                  className="flex-shrink-0"
                >
                  <a
                    href={getRepoLink(item.link || "", item.name === "Code")}
                    onClick={(e) => {
                      e.preventDefault();
                      const href = getRepoLink(
                        item.link || "",
                        item.name === "Code"
                      );
                      const targetPath = href.split("?")[0] || href;
                      router.push(href);
                      // Soft nav can stall while the Code page is busy; fall back.
                      window.setTimeout(() => {
                        if (window.location.pathname !== targetPath) {
                          window.location.assign(href);
                        }
                      }, 2500);
                    }}
                    className={clsx(
                      "flex items-center whitespace-nowrap border-b-2 border-transparent transition-all ease-in-out px-3 py-4 text-sm cursor-pointer",
                      {
                        "border-b-[var(--color-accent-primary)]":
                          item.name === "Code"
                            ? isCodeTabActive
                            : pathname.includes(
                                `/${resolvedParams.entity}/${resolvedParams.repo}/${item.link}`
                              ),
                      }
                    )}
                  >
                    {item.icon}
                    {item.name}{" "}
                    {item.link === "issues" ? (
                      <Badge className="ml-2">{issueCount}</Badge>
                    ) : item.link === "pulls" ? (
                      <Badge className="ml-2">{prCount}</Badge>
                    ) : null}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              className={clsx("flex items-center cursor-pointer", {
                hidden: filteredMenuItems.length - visibleMenuItemsCount === 0,
              })}
              type="button"
            >
              <MoreHorizontal className="h-4 w-4 hover:text-white/80" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="py-1 px-0 w-40 relative -left-4 top-1"
              onCloseAutoFocus={(e) => e.preventDefault()}
              onInteractOutside={(e) => {
                // Allow clicks to pass through to links
                const target = e.target as HTMLElement;
                if (target.closest("a")) {
                  e.preventDefault();
                }
              }}
            >
              {overflowMenuItems.map((item, index) => (
                <DropdownMenuItem
                  key={`${item.name}-${item.link}-${index}`}
                  className={clsx(
                    "flex h-9 cursor-pointer items-center whitespace-nowrap p-4 text-sm text-white hover:bg-[var(--color-accent-primary)]",
                    {
                      "border-b-2 border-b-[var(--color-accent-primary)]":
                        item.name === "Code"
                          ? isCodeTabActive
                          : pathname.includes(
                              `/${resolvedParams.entity}/${resolvedParams.repo}/${item.link}`
                            ),
                    }
                  )}
                  onSelect={() => {
                    router.push(
                      getRepoLink(item.link || "", item.name === "Code")
                    );
                  }}
                >
                  {item.icon}
                  {item.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <hr className="w-full -mt-[17px] border-b-0 border-lightgray" />

        {children}
      </section>
      {showRepoQR && (
        <RepoQRShare
          repoUrl={`/${resolvedParams.entity}/${resolvedParams.repo}${
            searchParams?.toString() ? `?${searchParams.toString()}` : ""
          }`}
          repoName={`${ownerDisplayName}/${decodeURIComponent(
            resolvedParams.repo
          )}`}
          onClose={() => setShowRepoQR(false)}
        />
      )}
    </>
  );
}
