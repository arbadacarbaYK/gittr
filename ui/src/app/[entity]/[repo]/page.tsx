"use client";

import { useEffect, useLayoutEffect, useState, useMemo, useCallback, useRef, startTransition } from "react";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Contributors } from "@/components/ui/contributors";
import { RepoLinks } from "@/components/ui/repo-links";
import { RelayDisplay } from "@/components/ui/relay-display";
import { Tooltip } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Code,
  Copy,
  Eye,
  File,
  Folder,
  GitBranch,
  GitFork,
  HelpCircle,
  History,
  List,
  MoreHorizontal,
  RefreshCw,
  Search,
  Settings,
  Star,
  Tag,
  Upload,
} from "lucide-react";
import { RepoZapButton } from "@/components/ui/repo-zap-button";
import { MermaidRenderer } from "@/components/ui/mermaid-renderer";
import { FuzzyFileFinder } from "@/components/ui/fuzzy-file-finder";
import { SSHGitHelp } from "@/components/ui/ssh-git-help";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { KIND_REPOSITORY, KIND_REPOSITORY_NIP34 } from "@/lib/nostr/events";
import { useSearchParams, useRouter, usePathname, useParams } from "next/navigation";
import useSession from "@/lib/nostr/useSession";
import { mapGithubContributors, type GitHubContributor } from "@/lib/github-mapping";
import { useContributorMetadata, type Metadata } from "@/lib/nostr/useContributorMetadata";
import { getEntityDisplayName, resolveEntityToPubkey } from "@/lib/utils/entity-resolver";
import { sanitizeContributors } from "@/lib/utils/contributors";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { CodeViewer } from "@/components/ui/code-viewer";
import { BranchTagSwitcher } from "@/components/ui/branch-tag-switcher";
import { CopyableCodeBlock } from "@/components/ui/copyable-code-block";
import { nip19 } from "nostr-tools";
import { findRepoByEntityAndName, findRepoByEntityAndNameAsync } from "@/lib/utils/repo-finder";
import { getRepoStatus, markRepoAsEdited, checkBridgeExists, setRepoStatus } from "@/lib/utils/repo-status";
import { formatDate24h } from "@/lib/utils/date-format";
import { pushRepoToNostr } from "@/lib/nostr/push-repo-to-nostr";
import { pushFilesToBridge } from "@/lib/nostr/push-to-bridge";
import { getNostrPrivateKey } from "@/lib/security/encryptedStorage";
import { fetchFilesFromMultipleSources, parseGitSource, type FetchStatus } from "@/lib/utils/git-source-fetcher";
import { getRepoStorageKey } from "@/lib/utils/entity-normalizer";
import { getActivities } from "@/lib/activity-tracking";
import { validateRepoForForkOrSign, isRepoCorrupted } from "@/lib/utils/repo-corruption-check";
import {
  loadStoredRepos,
  saveStoredRepos,
  loadDeletedRepos,
  loadRepoFiles,
  saveRepoFiles,
  loadRepoOverrides,
  saveRepoOverrides, // NOTE: Currently unused - overrides are loaded for display but editing uses addPendingEdit (PR system)
  loadRepoDeletedPaths,
  saveRepoDeletedPaths,
  type StoredRepo,
  type StoredContributor,
  type RepoFileEntry,
  type RepoLink,
  isGitHostContributor,
} from "@/lib/repos/storage";

export default function RepoCodePage() {
  const routeParams = useParams<{ entity?: string; repo?: string }>();
  const resolvedParams = useMemo(
    () => ({
      entity: routeParams?.entity ?? "",
      repo: routeParams?.repo ?? "",
    }),
    [routeParams?.entity, routeParams?.repo]
  );
  const decodedRepo = decodeURIComponent(resolvedParams.repo);
  const { pubkey: currentUserPubkey, subscribe, publish, defaultRelays, getRelayStatuses } = useNostrContext();
  // Also get pubkey from session as fallback - use state to prevent hydration errors
  const [effectiveUserPubkey, setEffectiveUserPubkey] = useState<string | undefined>(currentUserPubkey || undefined);
  
  useEffect(() => {
    if (currentUserPubkey) {
      setEffectiveUserPubkey(currentUserPubkey);
    } else if (typeof window !== 'undefined') {
      try {
        const session = JSON.parse(localStorage.getItem('nostr:session') || '{}');
        setEffectiveUserPubkey(session.pubkey || undefined);
      } catch {
        setEffectiveUserPubkey(undefined);
      }
    }
  }, [currentUserPubkey]);
  const { picture: userPicture, name: userName } = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const showZap = true; // Always show zap UI when user is logged in
  const [repoData, setRepoData] = useState<StoredRepo | null>(null);
  const [nostrEventId, setNostrEventId] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string>("");
  const [fileContent, setFileContent] = useState<string>("");
  const [loadingFile, setLoadingFile] = useState<boolean>(false);
  const [fetchingFilesFromGit, setFetchingFilesFromGit] = useState<{ source: 'github' | 'gitlab' | null, message: string }>({ source: null, message: '' });
  const [fetchStatuses, setFetchStatuses] = useState<Array<{ source: string; status: 'pending' | 'fetching' | 'success' | 'failed'; error?: string }>>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [proposeEdit, setProposeEdit] = useState<boolean>(false);
  const [proposedContent, setProposedContent] = useState<string>("");
  const [mounted, setMounted] = useState(false);
  const [currentFolderReadme, setCurrentFolderReadme] = useState<string | null>(null);
  const [loadingFolderReadme, setLoadingFolderReadme] = useState<boolean>(false);
  const fileViewerRef = useRef<HTMLDivElement | null>(null);
  const repoProcessedRef = useRef<string>(""); // Track which repo we've already processed
  const fileFetchInProgressRef = useRef<boolean>(false); // Prevent multiple simultaneous file fetches
  const fileFetchAttemptedRef = useRef<string>(""); // Track which repos we've already attempted to fetch files for
  const ownerMetadataRef = useRef<Record<string, Metadata>>({}); // Ref to access latest ownerMetadata without causing re-renders
  const repoDataRef = useRef<StoredRepo | null>(null); // Ref to access latest repoData without causing dependency loops

  const entityPubkey = useMemo(() => {
    if (!resolvedParams.entity) return null;
    if (resolvedParams.entity.startsWith("npub")) {
      try {
        const decoded = nip19.decode(resolvedParams.entity);
        if (decoded.type === "npub") {
          return (decoded.data as string).toLowerCase();
        }
      } catch {
        return null;
      }
    } else if (/^[0-9a-f]{64}$/i.test(resolvedParams.entity)) {
      return resolvedParams.entity.toLowerCase();
    }
    return null;
  }, [resolvedParams.entity]);

  const [repoOwnerPubkey, setRepoOwnerPubkey] = useState<string | null>(null);
  
  useEffect(() => {
    if ((repoData as any)?.ownerPubkey && typeof (repoData as any).ownerPubkey === "string") {
      setRepoOwnerPubkey((repoData as any).ownerPubkey.toLowerCase());
    } else if (mounted) {
      // CRITICAL: Support NIP-05 format (e.g., geek@primal.net) for gitworkshop.dev compatibility
      const isNip05 = resolvedParams.entity.includes("@");
      
      if (isNip05) {
        // Use async resolution for NIP-05
        (async () => {
          try {
            const repos = loadStoredRepos();
            const match = await findRepoByEntityAndNameAsync<StoredRepo>(repos, resolvedParams.entity, decodedRepo);
            if (match?.ownerPubkey && typeof match.ownerPubkey === "string") {
              setRepoOwnerPubkey(match.ownerPubkey.toLowerCase());
            } else {
              setRepoOwnerPubkey(null);
            }
          } catch {
            setRepoOwnerPubkey(null);
          }
        })();
      } else {
        // Use sync resolution for npub/hex pubkey
        try {
          const repos = loadStoredRepos();
          const match = findRepoByEntityAndName<StoredRepo>(repos, resolvedParams.entity, decodedRepo);
          if (match?.ownerPubkey && typeof match.ownerPubkey === "string") {
            setRepoOwnerPubkey(match.ownerPubkey.toLowerCase());
          } else {
            setRepoOwnerPubkey(null);
          }
        } catch {
          setRepoOwnerPubkey(null);
        }
      }
    }
  }, [repoData?.ownerPubkey, resolvedParams.entity, decodedRepo, mounted]);

  const repoIsOwner = useMemo(() => {
    if (!currentUserPubkey) return false;
    const normalizedUser = currentUserPubkey.toLowerCase();
    if (entityPubkey && normalizedUser === entityPubkey) return true;
    if (repoOwnerPubkey && normalizedUser === repoOwnerPubkey) return true;
    return false;
  }, [currentUserPubkey, entityPubkey, repoOwnerPubkey]);

  const repoLinksList = repoData?.links || [];
  const linksPublished = useMemo(() => {
    if (!repoLinksList || repoLinksList.length === 0) return false;
    return Boolean(
      (repoData as any)?.syncedFromNostr ||
      (repoData as any)?.lastNostrEventId ||
      (repoData as any)?.nostrEventId ||
      (repoData as any)?.fromNostr ||
      (repoData as any)?.lastNostrEventCreatedAt
    );
  }, [repoLinksList, repoData]);

  const copyCloneCommand = useCallback(async (command: string) => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(command);
        const { showToast } = await import("@/components/ui/toast");
        showToast("Clone command copied!", "success");
      }
    } catch (error) {
      console.error("Failed to copy clone command:", error);
      const { showToast } = await import("@/components/ui/toast");
      showToast("Failed to copy command", "error");
    }
  }, []);

  // clone URLs memo defined later after ownerPubkeyForLink
  const eoseProcessedRef = useRef<Set<string>>(new Set()); // Track which EOSE callbacks have already processed file fetching
  const branchesRef = useRef<string[]>([]); // Ref to track previous branches array to prevent render loops
  const tagsRef = useRef<string[]>([]); // Ref to track previous tags array to prevent render loops
  const ownerQueryRef = useRef<string>(""); // Prevent multiple Nostr queries for owner pubkey
  // Initialize stable ref from localStorage if available to prevent empty → populated transition
  // Initialize as empty array to prevent hydration errors, will be populated in useEffect
  const ownerPubkeysStableRef = useRef<string[]>([]);
  
  useEffect(() => {
    if (mounted) {
      try {
    const repos = loadStoredRepos();
        const repo = findRepoByEntityAndName<StoredRepo>(repos, resolvedParams.entity, decodedRepo);
    if (repo?.ownerPubkey && /^[0-9a-f]{64}$/i.test(repo.ownerPubkey)) {
          ownerPubkeysStableRef.current = [repo.ownerPubkey];
        }
      } catch {
        // Ignore errors
      }
    }
  }, [resolvedParams.entity, decodedRepo, mounted]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [deletedPaths, setDeletedPaths] = useState<string[]>([]);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  // Live counters synced with localStorage updates from layout actions
  const [liveStarCount, setLiveStarCount] = useState<number>(0);
  const [liveWatchCount, setLiveWatchCount] = useState<number>(0);
  const [liveForkCount, setLiveForkCount] = useState<number>(0);
  const [showFuzzyFinder, setShowFuzzyFinder] = useState<boolean>(false);
  const [showSshGitHelp, setShowSshGitHelp] = useState<boolean>(false);
  const [sshGitHelpData, setSshGitHelpData] = useState<{
    entity: string;
    repo: string;
    sshUrl: string;
    httpsUrls: string[];
    nostrUrls: string[];
  } | null>(null);
  const [isPushing, setIsPushing] = useState<boolean>(false);
  const [isRefetching, setIsRefetching] = useState<boolean>(false);
  const [fetchStatusExpanded, setFetchStatusExpanded] = useState<boolean>(false);
  const [cloneUrlsExpanded, setCloneUrlsExpanded] = useState<boolean>(false);
  const [effectiveSourceUrl, setEffectiveSourceUrl] = useState<string | null>(null); // sourceUrl from local repo or Nostr event
  
  // Get owner metadata for Nostr profile picture fallback
  // Fetch metadata for both entity and actual owner pubkey (CRITICAL for imported repos)
  // State to store resolved owner pubkey (set by Nostr query if missing)
  const [resolvedOwnerPubkey, setResolvedOwnerPubkey] = useState<string | null>(null);
  
  const normalizeContributors = useCallback((
    list: Array<{ pubkey?: string; name?: string; picture?: string; weight?: number; githubLogin?: string; role?: "owner" | "maintainer" | "contributor" }>
  ) => {
    const sanitized = sanitizeContributors(list, { keepNameOnly: true });
    return sanitized.map((c) => ({
      ...c,
      weight: typeof c.weight === "number" && !Number.isNaN(c.weight) ? c.weight : 0,
    }));
  }, []);
  
  // Compute owner pubkeys for metadata using useMemo (like explore page) - NO useState/useEffect to prevent render loops
  const ownerPubkeysForMetadata = useMemo(() => {
    const repos = loadStoredRepos();
    const repo = findRepoByEntityAndName<StoredRepo>(repos, resolvedParams.entity, decodedRepo);
    const prefix = resolvedParams.entity?.length === 8 ? resolvedParams.entity.toLowerCase() : null;
    const pubkeySet = new Set<string>();

    const addPubkey = (value?: string) => {
      if (typeof value === "string" && /^[0-9a-f]{64}$/i.test(value)) {
        pubkeySet.add(value.toLowerCase());
      }
    };

    // CRITICAL: Decode npub FIRST (before other checks) to ensure we always have a pubkey
    // This ensures the metadata hook gets called even if repo.ownerPubkey is missing
    if (resolvedParams.entity && resolvedParams.entity.startsWith("npub")) {
      try {
        const decoded = nip19.decode(resolvedParams.entity);
        if (decoded.type === "npub") {
          const pubkey = decoded.data as string;
          addPubkey(pubkey);
          // CRITICAL: Also ensure repo.ownerPubkey is set if missing
          if (repo && !repo.ownerPubkey && /^[0-9a-f]{64}$/i.test(pubkey)) {
            repo.ownerPubkey = pubkey;
            // Update localStorage to persist ownerPubkey
            const repoIndex = repos.findIndex((r: StoredRepo) => 
              (r.slug === decodedRepo || r.repo === decodedRepo) && r.entity === resolvedParams.entity
            );
            if (repoIndex >= 0 && repos[repoIndex]) {
              repos[repoIndex].ownerPubkey = pubkey;
              saveStoredRepos(repos);
            }
          }
        }
      } catch (e) {
        console.warn("[ownerPubkeysForMetadata] Failed to decode npub:", resolvedParams.entity, e);
      }
    }

    addPubkey(resolvedOwnerPubkey ?? undefined);
    addPubkey(repo?.ownerPubkey);

    if (Array.isArray(repo?.contributors)) {
      const ownerContributor = repo.contributors.find(
        (contributor) => contributor.weight === 100 && typeof contributor.pubkey === "string"
      );
      addPubkey(ownerContributor?.pubkey);
    }

    if (resolvedParams.entity && resolvedParams.entity.length === 64) {
      addPubkey(resolvedParams.entity);
    } else if (prefix) {
      const prefixRegex = /^[0-9a-f]{8}$/i;
      if (prefixRegex.test(prefix)) {
        if (
          repo?.ownerPubkey &&
          repo.ownerPubkey.toLowerCase().startsWith(prefix)
        ) {
          addPubkey(repo.ownerPubkey);
        } else if (Array.isArray(repo?.contributors)) {
          const matchingContributor = repo.contributors.find(
            (contributor) =>
              contributor.pubkey &&
              contributor.pubkey.toLowerCase().startsWith(prefix)
          );
          addPubkey(matchingContributor?.pubkey);
        }

        if (pubkeySet.size === 0) {
          const matchingActivity = getActivities().find(
            (activity) =>
              activity.user &&
              activity.user.toLowerCase().startsWith(prefix)
          );
          addPubkey(matchingActivity?.user);
        }

        if (pubkeySet.size === 0) {
          const matchingRepo = repos.find(
            (storedRepo) =>
              storedRepo.entity &&
              storedRepo.entity.toLowerCase() === resolvedParams.entity?.toLowerCase() &&
              storedRepo.ownerPubkey &&
              storedRepo.ownerPubkey.toLowerCase().startsWith(prefix)
          );
          addPubkey(matchingRepo?.ownerPubkey);
        }
      }
    }

    // CRITICAL: If no pubkeys found and entity is npub, decode it as fallback
    // This MUST happen before checking cached values to ensure we always have a pubkey
    if (pubkeySet.size === 0 && resolvedParams.entity && resolvedParams.entity.startsWith("npub")) {
      try {
        const decoded = nip19.decode(resolvedParams.entity);
        if (decoded.type === "npub") {
          const pubkey = decoded.data as string;
          if (/^[0-9a-f]{64}$/i.test(pubkey)) {
            console.log("[ownerPubkeysForMetadata] No pubkeys found, using decoded npub as fallback:", pubkey.slice(0, 16) + "...");
            pubkeySet.add(pubkey.toLowerCase());
            // Also update repo.ownerPubkey if missing
            if (repo && !repo.ownerPubkey) {
              repo.ownerPubkey = pubkey;
              const repoIndex = repos.findIndex((r: StoredRepo) => 
                (r.slug === decodedRepo || r.repo === decodedRepo) && r.entity === resolvedParams.entity
              );
              if (repoIndex >= 0 && repos[repoIndex]) {
                repos[repoIndex].ownerPubkey = pubkey;
                saveStoredRepos(repos);
              }
            }
          }
        }
      } catch (e) {
        console.warn("[ownerPubkeysForMetadata] Failed to decode npub as fallback:", e);
      }
    }

    const result = Array.from(pubkeySet).sort();
    const resultStr = result.join(",");
    const cachedStr = ownerPubkeysStableRef.current.join(",");

    if (result.length === 0 && ownerPubkeysStableRef.current.length > 0) {
      return ownerPubkeysStableRef.current;
    }

    if (resultStr === cachedStr && ownerPubkeysStableRef.current.length > 0) {
      return ownerPubkeysStableRef.current;
    }

    ownerPubkeysStableRef.current = result;
    
    // Debug logging
    if (result.length > 0) {
      console.log(`[ownerPubkeysForMetadata] Returning ${result.length} pubkey(s):`, result.map(p => p.slice(0, 16) + "..."));
    } else {
      console.warn("[ownerPubkeysForMetadata] WARNING: Returning empty array - no pubkeys found! Entity:", resolvedParams.entity);
    }
    
    return result;
  }, [decodedRepo, resolvedParams.entity, resolvedOwnerPubkey]); // Only recompute when these change
  const ownerMetadata = useContributorMetadata(ownerPubkeysForMetadata);
  
  // Keep ref in sync with ownerMetadata - update ref directly (refs don't cause re-renders)
  const ownerMetadataKey = useMemo(() => {
    if (Object.keys(ownerMetadata).length === 0) return "";
    return Object.entries(ownerMetadata)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([pubkey, meta]) => `${pubkey}:${meta?.created_at ?? 0}`)
      .join("|");
  }, [ownerMetadata]);
  
  const lastMetadataKeyRef = useRef<string>("");
  
  useEffect(() => {
    // Only update if content actually changed (using stable key comparison)
    if (ownerMetadataKey !== lastMetadataKeyRef.current && ownerMetadataKey !== "") {
      ownerMetadataRef.current = ownerMetadata; // Access ownerMetadata from closure - it's current when key changes
      lastMetadataKeyRef.current = ownerMetadataKey;
    }
  }, [ownerMetadataKey]); // Only depend on key, not the object itself
  
  // Track mount state to prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);
  
  // Resolve actual owner pubkey for profile links (handles imported repos and Nostr-synced repos)
  const ownerPubkeyForLink = useMemo(() => {
    try {
      // Priority 1: Use resolvedOwnerPubkey (set by Nostr query if missing)
      if (resolvedOwnerPubkey && /^[0-9a-f]{64}$/i.test(resolvedOwnerPubkey)) {
        return resolvedOwnerPubkey;
      }
      
      // Only access localStorage after mount to prevent hydration errors
      if (!mounted) {
        // Fallback to entity if it's a full pubkey
        if (resolvedParams.entity && resolvedParams.entity.length === 64 && /^[0-9a-f]{64}$/i.test(resolvedParams.entity)) {
          return resolvedParams.entity;
        }
        return null;
      }
      
      const repos = loadStoredRepos();
      const repo = findRepoByEntityAndName<StoredRepo>(repos, resolvedParams.entity, decodedRepo);
      
      // Priority 2: Use ownerPubkey if available (most reliable, especially for Nostr-synced repos)
      if (repo?.ownerPubkey && /^[0-9a-f]{64}$/i.test(repo.ownerPubkey)) {
        return repo.ownerPubkey;
      }
      
      // Priority 3: Find owner from contributors (weight 100)
      if (repo?.contributors && Array.isArray(repo.contributors)) {
        const ownerContributor = repo.contributors.find((c) => c.weight === 100 && c.pubkey);
        if (ownerContributor?.pubkey && /^[0-9a-f]{64}$/i.test(ownerContributor.pubkey)) {
          return ownerContributor.pubkey;
        }
      }
      
      // Priority 4: If resolvedParams.entity is a full 64-char pubkey, use it directly
      if (resolvedParams.entity && resolvedParams.entity.length === 64 && /^[0-9a-f]{64}$/i.test(resolvedParams.entity)) {
        return resolvedParams.entity;
      }
      
      // Priority 5: If resolvedParams.entity is an 8-char prefix, try to resolve full pubkey from repo data
      // Check if repo has ownerPubkey that matches the prefix
      if (resolvedParams.entity && resolvedParams.entity.length === 8 && /^[0-9a-f]{8}$/i.test(resolvedParams.entity)) {
        // Try to find ownerPubkey that starts with this prefix
        if (repo?.ownerPubkey && repo.ownerPubkey.toLowerCase().startsWith(resolvedParams.entity.toLowerCase())) {
          return repo.ownerPubkey;
        }
        // Try to find contributor with pubkey matching prefix
        if (repo?.contributors && Array.isArray(repo.contributors)) {
          const matchingContributor = repo.contributors.find((c) => 
            c.pubkey && /^[0-9a-f]{64}$/i.test(c.pubkey) && c.pubkey.toLowerCase().startsWith(resolvedParams.entity.toLowerCase())
          );
          if (matchingContributor?.pubkey) {
            return matchingContributor.pubkey;
          }
        }
        // Last resort: try activities
        try {
          const activities = getActivities();
          const matchingActivity = activities.find((a) => 
            a.user && typeof a.user === "string" && /^[0-9a-f]{64}$/i.test(a.user) && a.user.toLowerCase().startsWith(resolvedParams.entity.toLowerCase())
          );
          if (matchingActivity?.user) {
            return matchingActivity.user;
          }
        } catch {}
      }
      
      // Default: use resolvedParams.entity as-is (might be GitHub username or pubkey prefix)
      return resolvedParams.entity;
    } catch {
      return resolvedParams.entity;
    }
  }, [resolvedParams.entity, resolvedParams.repo, resolvedOwnerPubkey, decodedRepo, mounted]);
  
  // Helper function to generate href for repo links (avoids duplication)
  const getRepoLink = useCallback((subpath: string = "", includeSearchParams: boolean = false) => {
    const basePath = ownerPubkeyForLink && /^[0-9a-f]{64}$/i.test(ownerPubkeyForLink) 
      ? `/${nip19.npubEncode(ownerPubkeyForLink)}/${resolvedParams.repo}${subpath ? `/${subpath}` : ""}`
      : `/${resolvedParams.entity}/${resolvedParams.repo}${subpath ? `/${subpath}` : ""}`;
    return includeSearchParams && searchParams?.toString() 
      ? `${basePath}?${searchParams.toString()}`
      : basePath;
  }, [ownerPubkeyForLink, resolvedParams.entity, resolvedParams.repo, searchParams]);
  
  // Ref to prevent infinite loops when opening files from URL
  const openingFromURLRef = useRef(false);
  const failedFilesRef = useRef<Set<string>>(new Set());
  
  // Clear failed files when repo changes
  useEffect(() => {
    failedFilesRef.current.clear();
  }, [resolvedParams.entity, resolvedParams.repo]);
  // Ref to track if we're updating state from URL (prevents loops)
  const updatingFromURLRef = useRef(false);

  // Update URL with current state (branch, file, path)
  // Use ref to track if we're updating to prevent loops
  const isUpdatingURLRef = useRef(false);
  const updateURL = useCallback((updates: { branch?: string; file?: string | null; path?: string }) => {
    if (isUpdatingURLRef.current) return; // Prevent recursive updates
    isUpdatingURLRef.current = true;
    
    // Get current search params from window location to avoid dependency on searchParams
    const currentParams = typeof window !== 'undefined' 
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
    
    if (updates.branch !== undefined) {
      if (updates.branch) currentParams.set("branch", updates.branch);
      else currentParams.delete("branch");
    }
    if (updates.file !== undefined) {
      if (updates.file) currentParams.set("file", updates.file);
      else currentParams.delete("file");
    }
    if (updates.path !== undefined) {
      if (updates.path) currentParams.set("path", updates.path);
      else currentParams.delete("path");
    }
    const query = currentParams.toString();
    // Preserve hash (e.g., #L5-L17 for code line selection) when updating URL
    const currentHash = typeof window !== 'undefined' ? window.location.hash : '';
    const newUrl = `/${resolvedParams.entity}/${resolvedParams.repo}${query ? `?${query}` : ""}${currentHash}`;
    router.replace(newUrl, { scroll: false });
    
    // Reset flag after a short delay to allow URL to update
    setTimeout(() => {
      isUpdatingURLRef.current = false;
    }, 100);
  }, [resolvedParams.entity, resolvedParams.repo, router]);

  const ownerSlug = useMemo(() => {
    if (!userName) return "";
    return userName
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '_')
      .replace(/[_-]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }, [userName]);
  const isOwner = useMemo(() => {
    if (!resolvedParams?.entity || !currentUserPubkey) return false;
    
    try {
      const repos = loadStoredRepos();
          const repo = findRepoByEntityAndName<StoredRepo>(repos, resolvedParams.entity, decodedRepo);
          
          // CRITICAL: Check if repo is corrupted BEFORE displaying
          if (repo && isRepoCorrupted(repo, repo.nostrEventId || repo.lastNostrEventId)) {
            console.error("❌ [Repo Page] Blocking corrupted repo from display:", {
              entity: resolvedParams.entity,
              repo: decodedRepo,
              ownerPubkey: (repo as any).ownerPubkey?.slice(0, 8)
            });
            // Redirect to 404 or show error
            router.push("/404");
            return;
          }
      
      if (repo) {
        // Priority 1: Check resolvedOwnerPubkey (set by Nostr query if missing)
        if (resolvedOwnerPubkey && resolvedOwnerPubkey === currentUserPubkey) return true;
        
        // Priority 2: Check ownerPubkey (most reliable - works for imported repos)
        if (repo.ownerPubkey && repo.ownerPubkey === currentUserPubkey) return true;
        
        // Priority 3: Check if current user is owner contributor (100% weight)
        const ownerContributor = repo.contributors?.find((c) => 
          c.pubkey === currentUserPubkey && c.weight === 100
        );
        if (ownerContributor) return true;
        
        // Priority 4: Check entity match (for native repos)
        if (repo.entity === currentUserPubkey || 
            (repo.entity.length === 8 && currentUserPubkey.toLowerCase().startsWith(repo.entity.toLowerCase()))) {
          return true;
        }
      }
    } catch {}
    
    // Fallback: original logic
    if (ownerSlug && ownerSlug === resolvedParams.entity) return true;
    if (resolvedParams.entity && currentUserPubkey && resolvedParams.entity === currentUserPubkey.slice(0, 8).toLowerCase()) return true;
    
    return false;
  }, [ownerSlug, resolvedParams.entity, currentUserPubkey, resolvedParams.repo, resolvedOwnerPubkey]);

  // This must run BEFORE the main useEffect to ensure resolvedOwnerPubkey is set early
  useEffect(() => {
    // Only query if we don't have resolvedOwnerPubkey yet and entity is an 8-char prefix
    if (resolvedOwnerPubkey || !resolvedParams.entity || resolvedParams.entity.length !== 8 || !/^[0-9a-f]{8}$/i.test(resolvedParams.entity)) {
      return;
    }
    
    if (!subscribe || !defaultRelays || ownerQueryRef.current === `${resolvedParams.entity}/${resolvedParams.repo}`) {
      return;
    }
    
    ownerQueryRef.current = `${resolvedParams.entity}/${resolvedParams.repo}`;
    
    (async () => {
      try {
        let found = false;
        const unsub = subscribe(
          [{
            kinds: [KIND_REPOSITORY, KIND_REPOSITORY_NIP34],
          }],
          defaultRelays,
          (event, isAfterEose, relayURL) => {
            if ((event.kind === KIND_REPOSITORY || event.kind === KIND_REPOSITORY_NIP34) && !found) {
              try {
                let repoData: any;
                if (event.kind === KIND_REPOSITORY) {
                  repoData = JSON.parse(event.content);
                } else {
                  // NIP-34 format
                  const repoTag = event.tags.find((t): t is string[] => Array.isArray(t) && t[0] === "d");
                  if (repoTag && repoTag[1] === resolvedParams.repo) {
                    repoData = { repositoryName: resolvedParams.repo };
                  }
                }
                
                if (repoData?.repositoryName === resolvedParams.repo && 
                    event.pubkey.toLowerCase().startsWith(resolvedParams.entity.toLowerCase())) {
                  found = true;
                  setResolvedOwnerPubkey(event.pubkey);
                  if (unsub) unsub();
                }
              } catch (e) {
                console.error("Error parsing repo event:", e);
              }
            }
          },
          undefined,
          (events, relayURL) => {
            if (!found) {
              console.warn("⚠️ [Foreign Repo] Repository event not found in Nostr");
            }
            if (unsub) unsub();
          }
        );
        
        setTimeout(() => {
          if (!found && unsub) {
            console.warn("⚠️ [Foreign Repo] Query timeout");
            unsub();
          }
        }, 10000);
      } catch (error) {
        console.error("Failed to query Nostr for foreign repo:", error);
      }
    })();
  }, [resolvedParams.entity, resolvedParams.repo, subscribe, defaultRelays, resolvedOwnerPubkey]);

  useEffect(() => {
    const repoKey = `${resolvedParams.entity}/${resolvedParams.repo}`;
    if (repoProcessedRef.current === repoKey) {
      return;
    }

    const repos = loadStoredRepos();
    const repo = findRepoByEntityAndName<StoredRepo>(repos, resolvedParams.entity, decodedRepo);

    if (!repo) {
      return;
    }

    // CRITICAL: For "tides" repos, ALWAYS verify ownership matches entity BEFORE processing
    const checkRepoName = (repo.repo || repo.slug || repo.name || "").toLowerCase();
    const checkIsTides = checkRepoName === "tides";
    
    if (checkIsTides && resolvedParams.entity && resolvedParams.entity.startsWith("npub")) {
      try {
        const decoded = nip19.decode(resolvedParams.entity);
        if (decoded.type === "npub") {
          const entityPubkey = (decoded.data as string).toLowerCase();
          // If ownerPubkey doesn't match entity OR is missing, it's corrupted
          if (!repo.ownerPubkey || repo.ownerPubkey.toLowerCase() !== entityPubkey) {
            console.error("❌ [Repo Page] Blocking corrupted tides repo - ownerPubkey doesn't match entity:", {
              entity: resolvedParams.entity,
              repo: decodedRepo,
              entityPubkey: entityPubkey.slice(0, 8),
              ownerPubkey: repo.ownerPubkey?.slice(0, 8) || "missing"
            });
            // Set repoData to null to prevent rendering
            setRepoData(null);
            // CRITICAL: Remove corrupted repo from localStorage
            const updatedRepos = repos.filter((r) => r !== repo);
            saveStoredRepos(updatedRepos);
            console.log("🗑️ [Repo Page] Removed corrupted tides repo from localStorage");
            repoProcessedRef.current = repoKey;
            return;
          }
        }
      } catch (e) {
        console.error("❌ [Repo Page] Failed to decode entity for tides repo:", e);
        setRepoData(null);
        // CRITICAL: Remove corrupted repo from localStorage
        const updatedRepos = repos.filter((r) => r !== repo);
        saveStoredRepos(updatedRepos);
        console.log("🗑️ [Repo Page] Removed corrupted tides repo from localStorage (decode failed)");
        repoProcessedRef.current = repoKey;
        return;
      }
    }
    
    // CRITICAL: Check if repo is corrupted BEFORE processing
    if (isRepoCorrupted(repo, repo.nostrEventId || repo.lastNostrEventId)) {
      console.error("❌ [Repo Page] Blocking corrupted repo from processing:", {
        entity: resolvedParams.entity,
        repo: decodedRepo,
        ownerPubkey: (repo as any).ownerPubkey?.slice(0, 8)
      });
      // Set repoData to null to prevent rendering
      setRepoData(null);
      // CRITICAL: Remove corrupted repo from localStorage
      const updatedRepos = repos.filter((r) => r !== repo);
      saveStoredRepos(updatedRepos);
      console.log("🗑️ [Repo Page] Removed corrupted repo from localStorage");
      repoProcessedRef.current = repoKey;
      return;
    }

    repoProcessedRef.current = repoKey;

    const fromGitHostFormat = (contributor: StoredContributor): contributor is StoredContributor & { login: string } =>
      isGitHostContributor(contributor);

    let contributors: StoredContributor[] = [];

    if (Array.isArray(repo.contributors) && repo.contributors.length > 0) {
      if (repo.contributors.some(fromGitHostFormat)) {
        const gitHostContributors: GitHubContributor[] = repo.contributors
          .filter(fromGitHostFormat)
          .map((contributor) => ({
            login: contributor.login,
            avatar_url: contributor.avatar_url ?? "",
            contributions: contributor.contributions ?? 0,
          }));

        contributors = mapGithubContributors(
          gitHostContributors,
          effectiveUserPubkey || undefined,
          userPicture || undefined
        );
      } else {
        contributors = repo.contributors.map((contributor) => ({
          pubkey:
            typeof contributor.pubkey === "string" && /^[0-9a-f]{64}$/i.test(contributor.pubkey)
              ? contributor.pubkey.toLowerCase()
              : undefined,
          name: contributor.name,
          picture: contributor.picture,
          weight: typeof contributor.weight === "number" ? contributor.weight : 0,
          githubLogin: contributor.githubLogin,
          role: contributor.role,
        }));
      }
    }

    contributors = normalizeContributors(contributors);

    if (
      repo.sourceUrl &&
      (repo.sourceUrl.includes("github.com") ||
        repo.sourceUrl.includes("gitlab.com") ||
        repo.sourceUrl.includes("codeberg.org"))
    ) {
      (async () => {
        try {
          const response = await fetch(`/api/git/contributors?sourceUrl=${encodeURIComponent(repo.sourceUrl || "")}`);
          if (!response.ok) {
            console.warn(`⚠️ [Repo] Failed to fetch contributors from ${repo.sourceUrl}: ${response.status}`);
            return;
          }
          const contributorsData: unknown = await response.json();
          if (!Array.isArray(contributorsData) || contributorsData.length === 0) {
            return;
          }
          const parsed: GitHubContributor[] = contributorsData
            .filter((item): item is Partial<GitHubContributor> & { login: string } => {
              return typeof item?.login === "string" && item.login.trim().length > 0;
            })
            .map((item) => ({
              login: item.login.trim(),
              avatar_url: typeof item.avatar_url === "string" ? item.avatar_url : "",
              contributions: typeof item.contributions === "number" ? item.contributions : 0,
            }));
          if (parsed.length === 0) {
            return;
          }

          const fetchedContributors = mapGithubContributors(
            parsed,
            effectiveUserPubkey || undefined,
            userPicture || undefined,
            true
          );

          const existingPubkeys = new Set(
            contributors
              .map((contributor) => contributor.pubkey?.toLowerCase())
              .filter((value): value is string => Boolean(value))
          );
          const existingGithubLogins = new Set(
            contributors
              .map((contributor) => contributor.githubLogin?.toLowerCase())
              .filter((value): value is string => Boolean(value))
          );

          let addedCount = 0;
          fetchedContributors.forEach((candidate) => {
            const candidatePubkey = candidate.pubkey?.toLowerCase();
            const candidateLogin = candidate.githubLogin?.toLowerCase();
            const hasPubkeyMatch = Boolean(candidatePubkey && existingPubkeys.has(candidatePubkey));
            const hasLoginMatch = Boolean(candidateLogin && existingGithubLogins.has(candidateLogin));

            if (!hasPubkeyMatch && !hasLoginMatch) {
              contributors.push(candidate);
              addedCount += 1;
              if (candidatePubkey) existingPubkeys.add(candidatePubkey);
              if (candidateLogin) existingGithubLogins.add(candidateLogin);
            }
          });

          if (addedCount > 0) {
            contributors = normalizeContributors(contributors);
            setRepoData((prev) => (prev ? { ...prev, contributors } : prev));
          }
        } catch (contribError) {
          console.warn("⚠️ [Repo] Failed to fetch contributors:", contribError);
        }
      })();
    }

    let ownerPubkey: string | undefined = repo.ownerPubkey;

    if (!ownerPubkey && resolvedParams.entity?.startsWith("npub")) {
      try {
        const decoded = nip19.decode(resolvedParams.entity);
        if (decoded.type === "npub") {
          ownerPubkey = decoded.data as string;
          console.log("🔑 Decoded npub to pubkey:", ownerPubkey.slice(0, 8));
        }
      } catch (error) {
        console.warn("⚠️ Failed to decode npub:", error);
      }
    }

    if (!ownerPubkey && contributors.length > 0) {
      const ownerContributor = contributors.find(
        (contributor) => contributor.weight === 100 && contributor.pubkey && /^[0-9a-f]{64}$/i.test(contributor.pubkey)
      );
      if (ownerContributor?.pubkey) {
        ownerPubkey = ownerContributor.pubkey;
      }
    }

    if (!ownerPubkey && resolvedParams.entity && resolvedParams.entity.length === 8 && /^[0-9a-f]{8}$/i.test(resolvedParams.entity)) {
      const matchingActivity = getActivities().find(
        (activity) =>
          activity.user &&
          typeof activity.user === "string" &&
          /^[0-9a-f]{64}$/i.test(activity.user) &&
          activity.user.toLowerCase().startsWith(resolvedParams.entity.toLowerCase())
      );
      if (matchingActivity?.user) {
        ownerPubkey = matchingActivity.user;
      }
    }

    if (!ownerPubkey && effectiveUserPubkey) {
      const entityIsPubkey = /^[0-9a-f]{64}$/i.test(repo.entity) || repo.entity.startsWith("npub");
      const entityMatchesUser =
        repo.entity === effectiveUserPubkey.slice(0, 8).toLowerCase() || repo.entity === effectiveUserPubkey;
      if (entityIsPubkey && repo.entity === effectiveUserPubkey) {
        ownerPubkey = effectiveUserPubkey;
      } else if (entityMatchesUser) {
        ownerPubkey = effectiveUserPubkey;
      }
    }

    if (ownerPubkey && !repo.ownerPubkey) {
      repo.ownerPubkey = ownerPubkey;
      const repoIndex = repos.findIndex((storedRepo) => storedRepo === repo);
      if (repoIndex >= 0 && repos[repoIndex]) {
        repos[repoIndex].ownerPubkey = ownerPubkey;
        saveStoredRepos(repos);
      }
    }

    // CRITICAL: Remove owner's pubkey from any contributor that isn't the owner
    // This prevents imported GitHub contributors from incorrectly getting the owner's pubkey
    contributors = contributors.map((contributor) => {
      if (
        contributor.pubkey &&
        ownerPubkey &&
        contributor.pubkey.toLowerCase() === ownerPubkey.toLowerCase() &&
        contributor.role !== "owner"
      ) {
        console.warn("⚠️ [Contributors] Removing incorrect pubkey assignment from contributor:", {
          githubLogin: contributor.githubLogin,
          name: contributor.name,
          pubkey: contributor.pubkey.slice(0, 8) + "...",
        });
        return { ...contributor, pubkey: undefined };
      }
      return contributor;
    });

    if (ownerPubkey) {
      const ownerIndex = contributors.findIndex(
        (contributor) => contributor.pubkey && contributor.pubkey.toLowerCase() === ownerPubkey?.toLowerCase()
      );
      if (ownerIndex >= 0) {
        const ownerContributor = { ...contributors[ownerIndex], weight: 100, role: "owner" as const };
        const others = contributors.filter((_, index) => index !== ownerIndex);
        contributors = [ownerContributor, ...others];
      } else {
        // CRITICAL: Use metadata for owner name if available
        const ownerMeta = ownerMetadata[ownerPubkey.toLowerCase()] || ownerMetadata[ownerPubkey];
        const ownerName = ownerMeta?.name || ownerMeta?.display_name || repo.entityDisplayName;
        // Fallback to shortened npub if no name available
        const fallbackName = resolvedParams.entity && resolvedParams.entity.startsWith("npub") 
          ? resolvedParams.entity.substring(0, 16) + "..." 
          : resolvedParams.entity;
        contributors.unshift({
          pubkey: ownerPubkey,
          name: ownerName || fallbackName,
          picture: ownerMeta?.picture,
          weight: 100,
          role: "owner" as const,
        });
      }
    } else if (resolvedParams.entity && resolvedParams.entity.length === 8 && /^[0-9a-f]{8}$/i.test(resolvedParams.entity)) {
      const ownerExists = contributors.some(
        (contributor) =>
          contributor.pubkey &&
          contributor.pubkey.length === 64 &&
          contributor.pubkey.toLowerCase().startsWith(resolvedParams.entity.toLowerCase())
      );
      if (!ownerExists) {
        contributors.unshift({ name: resolvedParams.entity, weight: 100 });
      }
    } else if (!contributors.length && repo.entityDisplayName) {
      const fallbackPubkey = ownerPubkey || effectiveUserPubkey;
      if (fallbackPubkey) {
        contributors = [
          { pubkey: fallbackPubkey, name: repo.entityDisplayName, weight: 100, role: "owner" as const },
        ];
      } else {
        contributors = [{ name: repo.entityDisplayName, weight: 100 }];
      }
    }

    contributors = normalizeContributors(contributors);

    if (contributors.length > 0 && ownerPubkey) {
      const repoIndex = repos.findIndex(
        (storedRepo) =>
          storedRepo.entity === resolvedParams.entity &&
          (storedRepo.repo === resolvedParams.repo ||
            storedRepo.slug === resolvedParams.repo ||
            storedRepo.slug === `${resolvedParams.entity}/${resolvedParams.repo}`)
      );
      if (repoIndex >= 0 && repos[repoIndex]) {
        const repoToUpdate = repos[repoIndex];
        const existingContributors = repoToUpdate.contributors || [];
        const ownerExists = existingContributors.some(
          (contributor) => contributor.pubkey === ownerPubkey
        );

        if (!ownerExists || JSON.stringify(existingContributors) !== JSON.stringify(contributors)) {
          repoToUpdate.contributors = contributors;
          if (!repoToUpdate.ownerPubkey) {
            repoToUpdate.ownerPubkey = ownerPubkey;
          }
          saveStoredRepos(repos);
          console.log("✅ Fixed contributors and saved to localStorage:", contributors);
        }
      }
    }

        // If ownerPubkey is missing and entity is an 8-char prefix, query Nostr for the repository event
        // This fixes repos synced before the ownerPubkey fix
        // Use a ref to prevent multiple queries (declared at component level)
        if (!repo.ownerPubkey && resolvedParams.entity && resolvedParams.entity.length === 8 && /^[0-9a-f]{8}$/i.test(resolvedParams.entity) && subscribe && defaultRelays && !resolvedOwnerPubkey && ownerQueryRef.current !== `${resolvedParams.entity}/${resolvedParams.repo}`) {
          ownerQueryRef.current = `${resolvedParams.entity}/${resolvedParams.repo}`;
          console.log("🔍 Querying Nostr for repository event to resolve ownerPubkey...");
          (async () => {
            try {
              let found = false;
              // Query for repository events matching the repo name
              // We filter by pubkey prefix in the callback since Nostr doesn't support substring queries
              const unsub = subscribe(
                [{
                  kinds: [KIND_REPOSITORY],
                  // Query ALL repository events - we'll filter by repo name AND pubkey prefix in callback
                  // This ensures we get the correct owner even if multiple users have repos with the same name
                }],
                defaultRelays,
                (event, isAfterEose, relayURL) => {
                  if (event.kind === KIND_REPOSITORY && !found) {
                    try {
                      const repoData = JSON.parse(event.content);
                      // Use the FULL pubkey from event.pubkey (not the prefix) once found
                      if (repoData.repositoryName === resolvedParams.repo && 
                          event.pubkey.toLowerCase().startsWith(resolvedParams.entity.toLowerCase())) {
                        console.log("✅ Found repository event! Full pubkey:", event.pubkey);
                        found = true;
                        
                        // This ensures metadata fetch uses the correct owner
                        // Only set if different to prevent unnecessary re-renders
                        setResolvedOwnerPubkey(prev => prev === event.pubkey ? prev : event.pubkey);
                        
                        // Found match - update repo with ownerPubkey
                        const repos = loadStoredRepos();
                        const repoIndex = repos.findIndex((r) => 
                          r.entity === resolvedParams.entity && (r.repo === resolvedParams.repo || r.slug === resolvedParams.repo)
                        );
                        if (repoIndex >= 0 && repos[repoIndex]) {
                          const repoToUpdate = repos[repoIndex];
                          repoToUpdate.ownerPubkey = event.pubkey;
                          // Also ensure owner is in contributors
                          if (!repoToUpdate.contributors || !Array.isArray(repoToUpdate.contributors)) {
                            repoToUpdate.contributors = [];
                          }
                          const ownerExists = repoToUpdate.contributors.some((c) => c.pubkey === event.pubkey);
                          if (!ownerExists) {
                            repoToUpdate.contributors.unshift({ pubkey: event.pubkey, weight: 100, role: "owner" });
                          }
                          // Also fix entityDisplayName - use npub format, not shortened pubkey
                          try {
                            repoToUpdate.entityDisplayName = nip19.npubEncode(event.pubkey).substring(0, 16) + "...";
                          } catch {
                            repoToUpdate.entityDisplayName = event.pubkey.substring(0, 16) + "...";
                          }
                          saveStoredRepos(repos);
                          console.log("✅ Updated repo with ownerPubkey:", event.pubkey);
                          // Don't reload - let React re-render with new metadata
                        }
                        if (unsub) unsub();
                      }
                    } catch (e) {
                      console.error("Error parsing repo event:", e);
                    }
                  }
                },
                undefined,
                () => {
                  // EOSE - no more events
                  if (!found) {
                    console.warn("⚠️ Repository event not found in Nostr (may not be published yet)");
                  }
                  if (unsub) unsub();
                }
              );
              // Timeout after 10 seconds
              setTimeout(() => {
                if (!found && unsub) {
                  console.warn("⚠️ Query timeout - repository event not found");
                  unsub();
                }
              }, 10000);
            } catch (error) {
              console.error("Failed to query Nostr for repository event:", error);
            }
          })();
        }
        
        // CRITICAL: Check if repo is corrupted BEFORE displaying
        // For "tides" repos, ALWAYS verify ownership matches entity
        const verifyRepoName = (repo.repo || repo.slug || repo.name || "").toLowerCase();
        const verifyIsTides = verifyRepoName === "tides";
        
        if (verifyIsTides && resolvedParams.entity && resolvedParams.entity.startsWith("npub")) {
          try {
            const decoded = nip19.decode(resolvedParams.entity);
            if (decoded.type === "npub") {
              const entityPubkey = (decoded.data as string).toLowerCase();
              // If ownerPubkey doesn't match entity OR is missing, it's corrupted
              if (!repo.ownerPubkey || repo.ownerPubkey.toLowerCase() !== entityPubkey) {
                console.error("❌ [Repo Page] Blocking corrupted tides repo - ownerPubkey doesn't match entity:", {
                  entity: resolvedParams.entity,
                  repo: decodedRepo,
                  entityPubkey: entityPubkey.slice(0, 8),
                  ownerPubkey: repo.ownerPubkey?.slice(0, 8) || "missing"
                });
                // Set repoData to null and show error
                setRepoData(null);
                return;
              }
            }
          } catch (e) {
            console.error("❌ [Repo Page] Failed to decode entity for tides repo:", e);
            setRepoData(null);
            return;
          }
        }
        
        if (isRepoCorrupted(repo, repo.nostrEventId || repo.lastNostrEventId)) {
          console.error("❌ [Repo Page] Blocking corrupted repo from display:", {
            entity: resolvedParams.entity,
            repo: decodedRepo,
            ownerPubkey: (repo as any).ownerPubkey?.slice(0, 8)
          });
          // Set repoData to null to prevent rendering
          setRepoData(null);
          return;
        }
        
        // Always set repoData, even if files/readme are empty (for foreign repos synced from Nostr)
        // Only fetch from sourceUrl if we don't have any data AND there's a sourceUrl
        try {
          if (repo.readme !== undefined || repo.files !== undefined || (repo as any).fileCount !== undefined || !repo.sourceUrl) {
          // We have data or no sourceUrl - load what we have
          // CRITICAL: Check separate files storage key first (for optimized storage)
          let filesArray: RepoFileEntry[] = [];
          if (repo.files && Array.isArray(repo.files) && repo.files.length > 0) {
            filesArray = repo.files; // Use files from repo object if available
          } else if ((repo as StoredRepo & { fileCount?: number }).fileCount && (repo as StoredRepo & { fileCount?: number }).fileCount! > 0) {
            // Try loading from separate storage key
            filesArray = loadRepoFiles(resolvedParams.entity, resolvedParams.repo);
            if (filesArray.length > 0) {
              console.log(`✅ [File Load] Loaded ${filesArray.length} files from separate storage key`);
            }
          }
          // Ensure files is always an array, never undefined
          
          
          setRepoData({ 
            entity: repo.entity,
            repo: repo.repo || resolvedParams.repo,
            readme: repo.readme || "", 
            files: filesArray,
            sourceUrl: repo.sourceUrl, 
            forkedFrom: repo.forkedFrom || repo.sourceUrl,
            entityDisplayName: repo.entityDisplayName,
            name: repo.name,
            createdAt: repo.createdAt,
            description: repo.description,
            stars: repo.stars,
            forks: repo.forks,
            languages: repo.languages,
            topics: repo.topics,
            branches: repo.branches || [],
            tags: repo.tags || [],
            issues: repo.issues || [],
            pulls: repo.pulls || [],
            commits: repo.commits || [],
            contributors,
            links: repo.links || [],
            defaultBranch: repo.defaultBranch || "main",
            clone: (repo as any).clone || [], // CRITICAL: Include clone URLs from NIP-34 event
            relays: (repo as any).relays || [],
            ownerPubkey: ownerPubkey || repo.ownerPubkey,
            lastNostrEventId: (repo as any).lastNostrEventId || (repo as any).nostrEventId,
          });
          // Ensure branches present
          const branches = (repo.branches && repo.branches.length > 0)
            ? repo.branches
            : Array.from(new Set([repo.defaultBranch || "main", "dev"])) ;
          setSelectedBranch(repo.defaultBranch || branches[0] || "main");
          // persist back if we synthesized branches
          if (!repo.branches || repo.branches.length === 0) {
            const idx = repos.findIndex((r) => r === repo);
            if (idx >= 0) {
              const updated = [...repos];
              (updated[idx] as StoredRepo & { branches?: string[] }).branches = branches;
              saveStoredRepos(updated);
            }
          }
          
          // File fetching is handled in a separate useEffect below to prevent blocking
        } else if (repo.sourceUrl) {
          // fetch if not cached
          (async () => {
            try {
              const response = await fetch("/api/import", { 
                method: "POST", 
                headers: {"Content-Type":"application/json"}, 
                body: JSON.stringify({ sourceUrl: repo.sourceUrl }) 
              });
              const d = await response.json();
              
              let contributors: Array<{pubkey?: string; name?: string; picture?: string; weight: number; githubLogin?: string; role?: "owner" | "maintainer" | "contributor"}> = [];
                          
              if (d.contributors && Array.isArray(d.contributors) && d.contributors.length > 0) {
                contributors = mapGithubContributors(d.contributors, effectiveUserPubkey || undefined, userPicture || undefined, true);
              }
              contributors = normalizeContributors(contributors);
              
              if (repo.sourceUrl && (repo.sourceUrl.includes('github.com') || repo.sourceUrl.includes('gitlab.com') || repo.sourceUrl.includes('codeberg.org'))) {
                try {
                  const contributorsResponse = await fetch(`/api/git/contributors?sourceUrl=${encodeURIComponent(repo.sourceUrl)}`);
                  if (contributorsResponse.ok) {
                    const contributorsData = await contributorsResponse.json();
                    if (contributorsData && Array.isArray(contributorsData) && contributorsData.length > 0) {
                      // This will use GITHUB_PLATFORM_TOKEN if available for better rate limits
                      const fetchedContributors = mapGithubContributors(contributorsData, effectiveUserPubkey || undefined, userPicture || undefined, true);
                      
                      // Merge with existing contributors, avoiding duplicates by pubkey OR githubLogin
                      const existingPubkeys = new Set(contributors.map((c) => c.pubkey?.toLowerCase()).filter(Boolean));
                      const existingGithubLogins = new Set(contributors.map((c) => c.githubLogin?.toLowerCase()).filter(Boolean));
                      
                      fetchedContributors.forEach((fc) => {
                        // Add if no pubkey match AND no githubLogin match
                        const hasPubkeyMatch = fc.pubkey && existingPubkeys.has(fc.pubkey.toLowerCase());
                        const hasLoginMatch = fc.githubLogin && existingGithubLogins.has(fc.githubLogin.toLowerCase());
                        
                        if (!hasPubkeyMatch && !hasLoginMatch) {
                          contributors.push(fc);
                          if (fc.pubkey) existingPubkeys.add(fc.pubkey.toLowerCase());
                          if (fc.githubLogin) existingGithubLogins.add(fc.githubLogin.toLowerCase());
                        }
                      });
                      console.log(`✅ [Repo] Fetched ${fetchedContributors.length} contributors from ${repo.sourceUrl} (using GITHUB_PLATFORM_TOKEN if available)`);
                    }
                  } else {
                    console.warn(`⚠️ [Repo] Failed to fetch contributors from ${repo.sourceUrl}: ${contributorsResponse.status}`);
                  }
                } catch (contribError) {
                  console.warn("⚠️ [Repo] Failed to fetch contributors:", contribError);
                }
                          }
                          
                          contributors = normalizeContributors(contributors);
                          
                          // Ensure owner is always present
                          // Use repo.ownerPubkey (already resolved from npub/contributor/activity matching above)
                          // Fallback to effectiveUserPubkey if repo.ownerPubkey not set
                          const resolvedOwnerPubkey = repo.ownerPubkey || effectiveUserPubkey || 
                            (resolvedParams.entity && resolvedParams.entity.length === 8 && /^[0-9a-f]{8}$/i.test(resolvedParams.entity) 
                              ? undefined // If entity is a pubkey prefix, we need full pubkey - try to resolve
                              : undefined);
                          
                          // CRITICAL: For newly created repos (no sourceUrl), don't add owner again
                          // The owner is already in contributors from repo creation
                          // Only add owner if repo was imported (has sourceUrl) and owner is missing
                          if (repo.sourceUrl && resolvedOwnerPubkey && !contributors.some((c) => c.pubkey && c.pubkey.toLowerCase() === resolvedOwnerPubkey.toLowerCase())) {
                            contributors.unshift({ 
                              pubkey: resolvedOwnerPubkey, 
                              name: repo.entityDisplayName || resolvedParams.entity, 
                  weight: 100,
                  role: "owner"
                            });
                          } else if (!repo.sourceUrl && resolvedOwnerPubkey) {
                            // For newly created repos, ensure owner is first and has correct weight/role
                            const ownerIndex = contributors.findIndex((c) => c.pubkey && c.pubkey.toLowerCase() === resolvedOwnerPubkey.toLowerCase());
                            if (ownerIndex >= 0) {
                              // Move owner to first position and ensure correct weight/role
                              const owner = { ...contributors[ownerIndex], weight: 100, role: "owner" as const };
                              contributors = [owner, ...contributors.filter((_, i) => i !== ownerIndex)];
                            }
                          } else if (!contributors.length && repo.entityDisplayName) {
                            // Fallback: if no pubkey but we have entityDisplayName, create contributor entry
                contributors = [{ name: repo.entityDisplayName, weight: 100, role: "owner" }];
                          }
              
                          contributors = normalizeContributors(contributors);

              // Now set repoData with all contributors
              setRepoData({ 
                entity: repo.entity,
                repo: repo.repo || resolvedParams.repo,
                readme: d.readme || "", 
                files: (d.files || []) as RepoFileEntry[], // Ensure files is always an array, never undefined 
                sourceUrl: repo.sourceUrl, 
                forkedFrom: repo.sourceUrl,
                entityDisplayName: repo.entityDisplayName,
                name: repo.name,
                createdAt: repo.createdAt,
                description: d.description,
                stars: d.stars,
                forks: d.forks,
                languages: d.languages,
                contributors: contributors, // CRITICAL: Include processed contributors
                issues: (d.issues || []) as unknown[],
                pulls: (d.pulls || []) as unknown[],
                commits: (d.commits || []) as unknown[],
                topics: d.topics,
                defaultBranch: d.defaultBranch,
                branches: (d.branches || []) as string[],
                tags: (d.tags || []) as string[],
                links: (repo.links || d.links || []) as RepoLink[],
              });
              const branches = (d.branches && d.branches.length > 0)
                ? d.branches
                : Array.from(new Set([d.defaultBranch || "main", "dev"]));
              setSelectedBranch(d.defaultBranch || branches[0] || "main");
              
              // cache it - match by entity and repo
              const updated = repos.map((r) => {
                // Skip repos without valid entity
                if (!r.entity || r.entity === "user") return r;
                const rEntity = r.entity;
                const rRepo = r.repo || r.slug || "";
                if (rEntity === resolvedParams.entity && rRepo === resolvedParams.repo) {
                  return {
                    ...r,
                    readme: d.readme,
                    files: d.files as RepoFileEntry[] | undefined,
                    description: d.description,
                    stars: d.stars,
                    forks: d.forks,
                    languages: d.languages,
                    topics: d.topics,
                    defaultBranch: d.defaultBranch,
                    contributors, // Use the merged contributors list
                  };
                }
                return r;
              });
              saveStoredRepos(updated);
            } catch (error) {
              console.error("Failed to fetch repo:", error);
            }
          })();
        } else {
          // Repo not in localStorage - check if it's marked as deleted first
          const deletedRepos = loadDeletedRepos();
          const isDeleted = deletedRepos.some((d) => {
            const entityMatch = d.entity.toLowerCase() === resolvedParams.entity.toLowerCase();
            const repoMatch = d.repo.toLowerCase() === resolvedParams.repo.toLowerCase();
            return entityMatch && repoMatch;
          });
          
          if (isDeleted) {
            console.log("⏭️ [Foreign Repo] Repo is marked as deleted, showing deleted message");
            setRepoData({
              entity: resolvedParams.entity,
              repo: resolvedParams.repo,
              readme: "",
              files: [],
              name: resolvedParams.repo,
              description: "This repository has been deleted.",
              contributors: [],
              defaultBranch: "main",
            } as StoredRepo & { deleted?: boolean });
            repoProcessedRef.current = repoKey;
            return;
          }
          
          // Repo not in localStorage - create minimal repoData so page can render
          // The Nostr query in the separate useEffect will resolve ownerPubkey
          console.log("⚠️ [Foreign Repo] Repo not found in localStorage, creating minimal repoData:", `entity=${resolvedParams.entity}, repo=${resolvedParams.repo}`);
          
          // Mark as processed to prevent re-running
          repoProcessedRef.current = repoKey;
          
          // Create minimal repoData with empty files - files will be fetched from Nostr if available
          setRepoData({
            entity: resolvedParams.entity,
            repo: resolvedParams.repo,
            readme: "",
            files: [],
            name: resolvedParams.repo,
            description: "",
            contributors: resolvedOwnerPubkey ? [{ pubkey: resolvedOwnerPubkey, weight: 100 }] : [],
            defaultBranch: "main",
          });
          setSelectedBranch("main");
          }
          // Load local overrides and deletions
          try {
            const savedOverrides = loadRepoOverrides(resolvedParams.entity, resolvedParams.repo);
            setOverrides(savedOverrides);
            const savedDeleted = loadRepoDeletedPaths(resolvedParams.entity, resolvedParams.repo);
            setDeletedPaths(savedDeleted);
          } catch {}
        } catch (e) {
          console.error("Error loading repo:", e);
        }
    
    // Listen for repo updates (when files are added locally)
    const handleRepoUpdate = () => {
      try {
        const repos = loadStoredRepos();
        const updatedRepo = findRepoByEntityAndName<StoredRepo>(repos, resolvedParams.entity, resolvedParams.repo);
        if (updatedRepo) {
          // Reload files from storage
          let filesArray: RepoFileEntry[] = [];
          if (updatedRepo.files && Array.isArray(updatedRepo.files) && updatedRepo.files.length > 0) {
            filesArray = updatedRepo.files;
          } else {
            filesArray = loadRepoFiles(resolvedParams.entity, resolvedParams.repo);
          }
          
          // Update repoData with new files
          setRepoData(prev => prev ? {
            ...prev,
            files: filesArray,
          } : null);
          
          console.log(`✅ [Repo Update] Reloaded ${filesArray.length} files after update event`);
        }
      } catch (error) {
        console.error("Error handling repo update:", error);
      }
    };
    
    window.addEventListener("gittr:repo-updated", handleRepoUpdate);
    
    // Reset processed flag when dependencies change
    return () => {
      window.removeEventListener("gittr:repo-updated", handleRepoUpdate);
      repoProcessedRef.current = "";
      fileFetchInProgressRef.current = false;
      fileFetchAttemptedRef.current = "";
      eoseProcessedRef.current.clear(); // Reset EOSE tracking when repo changes
    };
  }, [resolvedParams.entity, resolvedParams.repo]);

  // Keep repoDataRef in sync
  useEffect(() => {
    repoDataRef.current = repoData;
  }, [repoData]);

  // Load Nostr event ID from localStorage and check bridge
  useEffect(() => {
    try {
      const repos = loadStoredRepos();
      const repo = findRepoByEntityAndName<StoredRepo>(repos, resolvedParams.entity, resolvedParams.repo);
      const eventId = repo?.lastNostrEventId || repo?.nostrEventId || null;
      setNostrEventId(eventId);
      
      // CRITICAL: Check bridge if repo has event ID (was pushed to Nostr)
      // This ensures "live" status only shows if bridge has actually processed the event
      if (eventId && repo?.ownerPubkey && /^[0-9a-f]{64}$/i.test(repo.ownerPubkey)) {
        // CRITICAL: Use repositoryName from Nostr event (exact name used by git-nostr-bridge)
        // Priority: repositoryName > repo > slug > resolvedParams.repo
        const repoAny = repo as any;
        const repoName = repoAny?.repositoryName || repo.repo || repo.slug || resolvedParams.repo;
        checkBridgeExists(repo.ownerPubkey, repoName, resolvedParams.entity).catch(err => {
          console.warn("Failed to check bridge:", err);
        });
      }
    } catch (error) {
      console.error("Failed to load Nostr event ID:", error);
      setNostrEventId(null);
    }
  }, [resolvedParams.entity, resolvedParams.repo]);
  
  // Reset fetchStatuses when params change (new repo or entity)
  useEffect(() => {
    setFetchStatuses([]);
    fileFetchAttemptedRef.current = "";
    fileFetchInProgressRef.current = false;
  }, [resolvedParams.entity, resolvedParams.repo]);
  
  // Check Nostr event for sourceUrl if missing from local repo (for button text)
  useEffect(() => {
    console.log("🔍 [effectiveSourceUrl] useEffect triggered:", { mounted, hasRepoData: !!repoData });
    
    // CRITICAL: Check multiple sources for sourceUrl in priority order:
    // 1. repoData.sourceUrl (direct field) - if repoData is available
    // 2. Clone URLs from repoData (extract GitHub/GitLab/Codeberg URLs) - if repoData is available
    // 3. Clone URLs from localStorage repo (ALWAYS check this, even if repoData is null)
    // 4. Nostr event "source" tag - if repoData is available and it's a Nostr repo
    
    // Priority 1: Check localStorage FIRST (works even if repoData is null or mounted is false)
    try {
      const repos = loadStoredRepos();
      const matchingRepo = findRepoByEntityAndName(repos, resolvedParams.entity, resolvedParams.repo);
      if (matchingRepo) {
        // Check sourceUrl first
        if (matchingRepo.sourceUrl && typeof matchingRepo.sourceUrl === "string" && (
          matchingRepo.sourceUrl.includes("github.com") || 
          matchingRepo.sourceUrl.includes("gitlab.com") || 
          matchingRepo.sourceUrl.includes("codeberg.org")
        )) {
          console.log("✅ [effectiveSourceUrl] Found sourceUrl in localStorage:", matchingRepo.sourceUrl);
          setEffectiveSourceUrl(matchingRepo.sourceUrl);
          return;
        }
        
        // Check clone URLs
        if (matchingRepo.clone && Array.isArray(matchingRepo.clone) && matchingRepo.clone.length > 0) {
          const gitHubCloneUrl = matchingRepo.clone.find((url: string) => 
            url && typeof url === "string" && (
              url.includes("github.com") || 
              url.includes("gitlab.com") || 
              url.includes("codeberg.org")
            )
          );
          if (gitHubCloneUrl) {
            // Remove .git suffix and convert SSH to HTTPS if needed
            let sourceUrl = gitHubCloneUrl.replace(/\.git$/, "");
            const sshMatch = sourceUrl.match(/^git@([^:]+):(.+)$/);
            if (sshMatch) {
              const [, host, path] = sshMatch;
              sourceUrl = `https://${host}/${path}`;
            }
            console.log("✅ [effectiveSourceUrl] Found clone URL in localStorage, converted to:", sourceUrl);
            setEffectiveSourceUrl(sourceUrl);
            return;
          }
        }
      }
    } catch (e) {
      console.warn("⚠️ [effectiveSourceUrl] Error reading from localStorage:", e);
    }
    
    // Priority 2: Check repoData if available
    if (repoData) {
      // Check direct sourceUrl field in repoData
      if (repoData.sourceUrl && typeof repoData.sourceUrl === "string" && (
        repoData.sourceUrl.includes("github.com") || 
        repoData.sourceUrl.includes("gitlab.com") || 
        repoData.sourceUrl.includes("codeberg.org")
      )) {
        console.log("✅ [effectiveSourceUrl] Found sourceUrl in repoData:", repoData.sourceUrl);
        setEffectiveSourceUrl(repoData.sourceUrl);
        return;
      }
      
      // Check clone URLs from repoData for GitHub/GitLab/Codeberg URLs
      const cloneUrls = (repoData as any)?.clone;
      if (Array.isArray(cloneUrls) && cloneUrls.length > 0) {
        const gitHubCloneUrl = cloneUrls.find((url: string) => 
          url && typeof url === "string" && (
            url.includes("github.com") || 
            url.includes("gitlab.com") || 
            url.includes("codeberg.org")
          )
        );
        if (gitHubCloneUrl) {
          // Remove .git suffix and convert SSH to HTTPS if needed
          let sourceUrl = gitHubCloneUrl.replace(/\.git$/, "");
          const sshMatch = sourceUrl.match(/^git@([^:]+):(.+)$/);
          if (sshMatch) {
            const [, host, path] = sshMatch;
            sourceUrl = `https://${host}/${path}`;
          }
          console.log("✅ [effectiveSourceUrl] Found clone URL in repoData, converted to:", sourceUrl);
          setEffectiveSourceUrl(sourceUrl);
          return;
        }
      }
    }
    
    // Priority 3: Query Nostr event for "source" tag (CRITICAL: Works even if localStorage is empty!)
    // This ensures users can refetch from source even if they lost localStorage
    if (!subscribe || !defaultRelays || defaultRelays.length === 0) {
      console.log("🔍 [effectiveSourceUrl] No subscribe/relays, cannot query Nostr");
      return;
    }
    
    // Resolve ownerPubkey from entity (works even if repoData is not available)
    let ownerPubkey: string | null = null;
    if (resolvedParams.entity.startsWith("npub")) {
      try {
        const decoded = nip19.decode(resolvedParams.entity);
        if (decoded.type === "npub" && /^[0-9a-f]{64}$/i.test(decoded.data as string)) {
          ownerPubkey = decoded.data as string;
        }
      } catch (e) {
        console.warn("⚠️ [effectiveSourceUrl] Failed to decode npub:", e);
      }
    } else if (/^[0-9a-f]{64}$/i.test(resolvedParams.entity)) {
      ownerPubkey = resolvedParams.entity;
    }
    
    // Fallback to repoData.ownerPubkey if available
    if (!ownerPubkey && repoData?.ownerPubkey && /^[0-9a-f]{64}$/i.test(repoData.ownerPubkey)) {
      ownerPubkey = repoData.ownerPubkey;
    }
    
    if (!ownerPubkey) {
      console.log("🔍 [effectiveSourceUrl] Cannot resolve ownerPubkey, cannot query Nostr");
      return;
    }
    
    const repoName = repoData?.repo || repoData?.slug || resolvedParams.repo;
    
    console.log("🔍 [effectiveSourceUrl] Querying Nostr for source URL (even if localStorage is empty):", { ownerPubkey: ownerPubkey.slice(0, 16) + "...", repoName });
    
    // Query Nostr for sourceUrl
    const timeout = setTimeout(() => {
      console.log("⏱️ [effectiveSourceUrl] Nostr query timeout - no source URL found");
      // Timeout - keep null (or keep clone URL if we found one above)
    }, 5000);
    
    const unsub = subscribe(
      [{
        kinds: [KIND_REPOSITORY, KIND_REPOSITORY_NIP34],
        authors: [ownerPubkey],
        "#d": [repoName],
      }],
      defaultRelays,
      (event) => {
        console.log("🔍 [effectiveSourceUrl] Received Nostr event, checking tags:", event.tags.filter(t => Array.isArray(t) && t[0] === "source"));
        // Extract sourceUrl from "source" tag
        for (const tag of event.tags) {
          if (Array.isArray(tag) && tag[0] === "source" && tag[1]) {
            const foundSourceUrl = tag[1];
            console.log("🔍 [effectiveSourceUrl] Found source tag:", foundSourceUrl);
            if (foundSourceUrl.includes("github.com") || foundSourceUrl.includes("gitlab.com") || foundSourceUrl.includes("codeberg.org")) {
              console.log("✅ [effectiveSourceUrl] Setting effectiveSourceUrl to:", foundSourceUrl);
              clearTimeout(timeout);
              setEffectiveSourceUrl(foundSourceUrl);
              unsub();
              return;
            }
          }
        }
      },
      undefined,
      () => {
        console.log("✅ [effectiveSourceUrl] Nostr query EOSE");
        clearTimeout(timeout);
        unsub();
      }
    );
    
    return () => {
      clearTimeout(timeout);
      unsub();
    };
  }, [repoData, subscribe, defaultRelays, resolvedParams.entity, resolvedParams.repo]);
  
  // Separate useEffect for file fetching - only runs when repoData is first set and files are missing
  // Use a ref to track if we've already attempted to fetch for this repo
  useEffect(() => {
    // We just need ownerPubkey which we can get from resolvedOwnerPubkey or ownerPubkeyForLink
    const currentRepoData = repoDataRef.current;
    
    // This prevents 15 second delays waiting for Nostr queries
    // We can resolve ownerPubkey from resolvedParams.entity (npub) directly
    let ownerPubkeyForFetch: string | null = null;
    
    // Try to resolve ownerPubkey immediately from resolvedParams.entity (npub)
    if (resolvedParams.entity && resolvedParams.entity.startsWith("npub")) {
      try {
        const decoded = nip19.decode(resolvedParams.entity);
        if (decoded.type === "npub" && /^[0-9a-f]{64}$/i.test(decoded.data as string)) {
          ownerPubkeyForFetch = decoded.data as string;
          console.log("✅ [File Fetch] Resolved ownerPubkey immediately from npub:", ownerPubkeyForFetch.slice(0, 8) + "...");
        }
      } catch (e) {
        console.warn("⚠️ [File Fetch] Failed to decode npub:", e);
      }
    }
    
    // Fallback to resolvedOwnerPubkey or ownerPubkeyForLink if available
    if (!ownerPubkeyForFetch) {
      ownerPubkeyForFetch = (resolvedOwnerPubkey && /^[0-9a-f]{64}$/i.test(resolvedOwnerPubkey)) 
        ? resolvedOwnerPubkey 
        : (ownerPubkeyForLink && /^[0-9a-f]{64}$/i.test(ownerPubkeyForLink) ? ownerPubkeyForLink : null);
    }
    
    // If still no ownerPubkey, try to resolve from repoData or localStorage
    if (!ownerPubkeyForFetch) {
      try {
        const repos = loadStoredRepos();
        const matchingRepo = repos.find((r) => {
          const entityMatch = r.entity === resolvedParams.entity || 
            (r.entity && resolvedParams.entity && r.entity.toLowerCase() === resolvedParams.entity.toLowerCase());
          const repoMatch = r.repo === resolvedParams.repo || r.slug === resolvedParams.repo || r.name === resolvedParams.repo;
          return entityMatch && repoMatch;
        });
        if (matchingRepo?.ownerPubkey && /^[0-9a-f]{64}$/i.test(matchingRepo.ownerPubkey)) {
          ownerPubkeyForFetch = matchingRepo.ownerPubkey;
          console.log("✅ [File Fetch] Found ownerPubkey in localStorage:", ownerPubkeyForFetch?.slice(0, 8) + "...");
        }
      } catch (e) {
        console.warn("⚠️ [File Fetch] Error checking localStorage:", e);
      }
    }
    
    if (!ownerPubkeyForFetch) {
      // CRITICAL: Log only primitives to avoid React re-render loops
      console.log("⏭️ [File Fetch] Skipping - no ownerPubkey yet", 
        `hasResolvedOwnerPubkey=${!!resolvedOwnerPubkey}, hasOwnerPubkeyForLink=${!!ownerPubkeyForLink}, hasRepoData=${!!currentRepoData}, entity=${resolvedParams.entity}`
      );
      return;
    }
    
    if (fileFetchInProgressRef.current) {
      console.log("⏭️ [File Fetch] Skipping - fetch in progress");
      return;
    }
    
    const repoKey = `${resolvedParams.entity}/${resolvedParams.repo}`;
    const currentBranch = selectedBranch || repoData?.defaultBranch || "main";
    const repoKeyWithBranch = `${repoKey}:${currentBranch}`; // Include branch in key
    const hasAttempted = fileFetchAttemptedRef.current === repoKeyWithBranch;
    
    // Check if repo has clone URLs - if so, always try multi-source fetch (even if attempted before)
    const hasCloneUrls = currentRepoData?.clone && Array.isArray(currentRepoData.clone) && currentRepoData.clone.length > 0;
    
    // Check if repo already has files (only if repoData exists)
    // NOTE: For branch switching, we want to refetch even if files exist (different branch = different files)
    const hasFiles = currentRepoData?.files && Array.isArray(currentRepoData.files) && currentRepoData.files.length > 0;
    
    // Skip if already attempted for this branch AND we have files (prevents infinite loops)
    // BUT: If cloneUrls exist and we don't have files, we MUST try to fetch (don't skip!)
    // This is critical - cloneUrls are the source of truth for foreign repos
    if (hasAttempted && hasFiles && !fileFetchInProgressRef.current) {
      console.log("⏭️ [File Fetch] Already attempted for this repo+branch and files exist, skipping:", repoKeyWithBranch);
      return;
    }
    
    // CRITICAL: If we have cloneUrls but no files, clear attempted flag to allow fetch
    // cloneUrls mean files should be fetchable - if previous attempt failed, we need to retry
    if (hasCloneUrls && hasAttempted && !hasFiles) {
      console.log("🔄 [File Fetch] Repo has clone URLs but no files - clearing attempted flag to allow fetch:", repoKeyWithBranch);
      fileFetchAttemptedRef.current = "";
    }
    const hasSourceUrl = !!currentRepoData?.sourceUrl;
    
    // This prevents clicking a file from triggering file list fetching
    // BUT: Only skip if we actually have files - if files aren't loaded yet, we need to fetch them
    const isFileOpening = openingFromURLRef.current || selectedFile !== null;
    
    // CRITICAL: Log only primitives to avoid React re-render loops
    // Logging objects can trigger serialization that causes re-renders
    // console.log("🔍 [File Fetch] Checking repo:", `repo=${repoKeyWithBranch}, branch=${currentBranch}, hasFiles=${hasFiles}, hasSourceUrl=${hasSourceUrl}, hasRepoData=${!!currentRepoData}, filesLength=${currentRepoData?.files?.length || 0}, isFileOpening=${isFileOpening}`);
    
    // If file opening is in progress AND we already have files, skip file fetching to prevent re-render loops
    // BUT: If we don't have files yet, we MUST fetch them even if a file is being opened
    if (isFileOpening && hasFiles) {
      console.log("⏭️ [File Fetch] File opening in progress and files exist, skipping file list fetch to prevent loop");
      return;
    }
    
    // For repos with sourceUrl (GitHub/GitLab), always refetch when branch changes
    // For embedded files, we might have files but they're for a different branch
    // (files might be stale or from a different source)
    // hasCloneUrls already defined above
    
    if (hasFiles && !hasSourceUrl && !hasCloneUrls) {
      // Embedded files - check if branch matches
      // If branch changed, we need to refetch (files might be for different branch)
      const lastFetchedBranch = (fileFetchAttemptedRef.current || "").split(":")[1];
      if (lastFetchedBranch === currentBranch) {
        console.log("✅ [File Fetch] Repo already has files for this branch, skipping fetch");
        fileFetchAttemptedRef.current = repoKeyWithBranch; // Mark as attempted (has files)
        return;
      } else {
        console.log("🔄 [File Fetch] Branch changed, will refetch files:", `lastFetchedBranch=${lastFetchedBranch}, currentBranch=${currentBranch}`);
      }
    }
    
    // This prevents infinite retry loops - once files are loaded from at least one source, we're done
    // Only refetch if branch changed (different branch = different files)
    if (hasCloneUrls && hasFiles) {
      const lastFetchedBranch = (fileFetchAttemptedRef.current || "").split(":")[1];
      if (lastFetchedBranch === currentBranch) {
        console.log("✅ [File Fetch] Repo has files for this branch, skipping multi-source fetch (preventing retry loop)");
        fileFetchAttemptedRef.current = repoKeyWithBranch;
        return;
      } else {
        console.log("🔄 [File Fetch] Branch changed, will try multi-source fetch to get latest files");
      }
    }
    
    // For GitHub imports, files should already be fetched via /api/import
    // But if they're missing, we should still try to fetch from git-nostr-bridge as fallback
    // Only skip if we're certain it's a GitHub-only repo that was just imported
    if (hasSourceUrl && currentRepoData.files === undefined) {
      console.log("⏭️ [File Fetch] Repo is GitHub import with undefined files, will try git-nostr-bridge as fallback");
      // Continue to fetch - don't skip
    }
    
    // CRITICAL: For local repos (no sourceUrl, no cloneUrls), check localStorage FIRST
    // If files exist in localStorage, use them and skip server fetching entirely
    if (!hasSourceUrl && !hasCloneUrls && !hasFiles) {
      try {
        const repos = loadStoredRepos();
        const matchingRepo = findRepoByEntityAndName<StoredRepo>(repos, resolvedParams.entity, resolvedParams.repo);
        if (matchingRepo) {
          // Check if files exist in repo.files or separate storage
          let localFiles: RepoFileEntry[] = [];
          if (matchingRepo.files && Array.isArray(matchingRepo.files) && matchingRepo.files.length > 0) {
            localFiles = matchingRepo.files;
          } else {
            localFiles = loadRepoFiles(resolvedParams.entity, resolvedParams.repo);
          }
          
          if (localFiles.length > 0) {
            console.log(`✅ [File Fetch] Local repo has ${localFiles.length} files in localStorage, using them (skipping server fetch)`);
            // Update repoData with files from localStorage
            setRepoData(prev => prev ? {
              ...prev,
              files: localFiles,
            } : null);
            fileFetchAttemptedRef.current = repoKeyWithBranch; // Mark as attempted
            fileFetchInProgressRef.current = false;
            return; // Skip server fetching for local repos
          }
        }
      } catch (e) {
        console.error("❌ [File Fetch] Error checking localStorage for local repo:", e);
        // Continue to server fetch as fallback
      }
    }
    
    // Mark as attempted before starting to prevent re-runs (include branch in key)
    fileFetchAttemptedRef.current = repoKeyWithBranch;
    console.log("🚀 [File Fetch] Starting file fetch for:", repoKeyWithBranch, "branch:", currentBranch);
      
      if (!ownerPubkeyForFetch || !/^[0-9a-f]{64}$/i.test(ownerPubkeyForFetch) || !subscribe || !defaultRelays) {
        console.warn("⚠️ [File Fetch] Cannot fetch files - missing ownerPubkey, subscribe, or defaultRelays", {
          hasOwnerPubkeyForFetch: !!ownerPubkeyForFetch,
          ownerPubkeyValid: ownerPubkeyForFetch ? /^[0-9a-f]{64}$/i.test(ownerPubkeyForFetch) : false,
          hasSubscribe: !!subscribe,
          hasDefaultRelays: !!defaultRelays,
          defaultRelaysCount: defaultRelays?.length || 0,
        });
        fileFetchInProgressRef.current = false;
        return;
      }
      
      // Use ownerPubkeyForFetch for the rest of the function
      const ownerPubkey: string = ownerPubkeyForFetch;
      
      // CRITICAL: Don't set isInProgress here - set it only when we actually start a fetch
      // This prevents the flag from being stuck if the initial clone URLs check skips
      
      // Check if repo has clone URLs in localStorage - if so, try multi-source fetch immediately
      (async () => {
        const initialRepoData = repoDataRef.current;
        const initialCloneUrls: string[] = [];
        if (initialRepoData?.clone && Array.isArray(initialRepoData.clone)) {
          initialCloneUrls.push(...initialRepoData.clone);
        }
        
        // Also check localStorage for clone URLs (client-side only)
        if (typeof window !== "undefined") {
          try {
            const repos = loadStoredRepos();
            // CRITICAL: Use findRepoByEntityAndName for consistent matching (handles npub, case-insensitive, etc.)
            const matchingRepo = findRepoByEntityAndName<StoredRepo>(repos, resolvedParams.entity, resolvedParams.repo);
            if (matchingRepo?.clone && Array.isArray(matchingRepo.clone)) {
              matchingRepo.clone.forEach((url: string) => {
                // CRITICAL: Filter out localhost URLs - they're not real git servers
                if (url && !url.includes('localhost') && !url.includes('127.0.0.1') && !initialCloneUrls.includes(url)) {
                  initialCloneUrls.push(url);
                }
              });
            }
          } catch (e) {
            console.error("❌ [File Fetch] Error reading clone URLs from localStorage:", e);
          }
        }
        
        // CRITICAL: If we have a sourceUrl but it's not in clone URLs, add it!
        // This handles cases where the repo exists on GitHub/Codeberg but the clone URL wasn't in localStorage
        // Check both repoDataRef and localStorage for sourceUrl
        let sourceUrl = initialRepoData?.sourceUrl;
        if (!sourceUrl && typeof window !== "undefined") {
          try {
            const repos = loadStoredRepos();
            // CRITICAL: Use async version if NIP-05 format (for gitworkshop.dev compatibility)
            const isNip05 = resolvedParams.entity.includes("@");
            const matchingRepo = isNip05 
              ? await findRepoByEntityAndNameAsync<StoredRepo>(repos, resolvedParams.entity, resolvedParams.repo)
              : findRepoByEntityAndName<StoredRepo>(repos, resolvedParams.entity, resolvedParams.repo);
            // Priority 1: Use sourceUrl or forkedFrom if available
            sourceUrl = matchingRepo?.sourceUrl || matchingRepo?.forkedFrom;
            // Priority 2: If no sourceUrl, try to find GitHub/GitLab/Codeberg clone URL (preferred)
            // CRITICAL: Only use GitHub/GitLab/Codeberg URLs as sourceUrl - Nostr git servers are handled by multi-source fetcher
            if (!sourceUrl && matchingRepo?.clone && Array.isArray(matchingRepo.clone) && matchingRepo.clone.length > 0) {
              const gitCloneUrl = matchingRepo.clone.find((url: string) => 
                url.includes('github.com') || url.includes('gitlab.com') || url.includes('codeberg.org')
              );
              if (gitCloneUrl) {
                sourceUrl = gitCloneUrl.replace(/\.git$/, '');
              }
            }
            // Note: We don't use Nostr git server URLs (gittr.space, etc.) as sourceUrl
            // Those are handled by the multi-source fetcher or git-nostr-bridge
            // CRITICAL: Log if sourceUrl was found to help debug
            if (matchingRepo && !sourceUrl) {
              console.warn("⚠️ [File Fetch] Matching repo found but sourceUrl is missing:", {
                repo: matchingRepo.repo || matchingRepo.slug || matchingRepo.name,
                entity: matchingRepo.entity,
                hasSourceUrl: !!matchingRepo.sourceUrl,
                hasForkedFrom: !!matchingRepo.forkedFrom,
                hasClone: !!(matchingRepo.clone && Array.isArray(matchingRepo.clone) && matchingRepo.clone.length > 0),
                cloneUrls: matchingRepo.clone || [],
                allKeys: Object.keys(matchingRepo),
              });
            } else if (matchingRepo && sourceUrl) {
              console.log("✅ [File Fetch] Found sourceUrl from:", {
                fromSourceUrl: !!matchingRepo.sourceUrl,
                fromForkedFrom: !!matchingRepo.forkedFrom,
                fromClone: !!(matchingRepo.sourceUrl || matchingRepo.forkedFrom) ? false : !!(matchingRepo.clone && Array.isArray(matchingRepo.clone) && matchingRepo.clone.length > 0),
                sourceUrl,
              });
            }
          } catch (e) {
            console.error("❌ [File Fetch] Error reading sourceUrl from localStorage:", e);
          }
        }
        
        if (sourceUrl) {
          // Convert sourceUrl to proper clone URL format if needed
          let cloneUrl = sourceUrl;
          
          // CRITICAL: Normalize SSH URLs (git@host:path) to HTTPS format
          const sshMatch = cloneUrl.match(/^git@([^:]+):(.+)$/);
          if (sshMatch) {
            const [, host, path] = sshMatch;
            cloneUrl = `https://${host}/${path}`;
            console.log(`🔄 [File Fetch] Normalized SSH sourceUrl to HTTPS: ${cloneUrl}`);
          }
          
          // If sourceUrl doesn't start with http:// or https://, add https://
          if (!cloneUrl.startsWith('http://') && !cloneUrl.startsWith('https://')) {
            cloneUrl = `https://${cloneUrl}`;
          }
          // Add .git suffix if not present (for GitHub/Codeberg/GitLab)
          const sourceUrlMatch = cloneUrl.match(/(github\.com|codeberg\.org|gitlab\.com)\/([^\/]+)\/([^\/]+)/i);
          if (sourceUrlMatch) {
            if (!cloneUrl.endsWith('.git')) {
              cloneUrl = `${cloneUrl}.git`;
            }
            // Check if already in list (case-insensitive)
            const alreadyIncluded = initialCloneUrls.some(url => 
              url.toLowerCase() === cloneUrl.toLowerCase() || 
              url.replace(/\.git$/, '').toLowerCase() === cloneUrl.replace(/\.git$/, '').toLowerCase()
            );
            if (!alreadyIncluded) {
              console.log(`✅ [File Fetch] Adding sourceUrl to clone URLs: ${cloneUrl} (from ${sourceUrl})`);
              initialCloneUrls.push(cloneUrl);
            }
          }
        }
        
        // This ensures we try all sources and show status for all of them
        // Include ALL known GRASP servers (for reading), including read-only ones like git.jb55.com
        const knownGitServers = [
          "relay.ngit.dev",
          "ngit-relay.nostrver.se",
          "gitnostr.com",
          "ngit.danconwaydev.com",
          "git.shakespeare.diy",
          "git-01.uid.ovh",
          "git-02.uid.ovh",
          "git.jb55.com", // Read-only: can read repos from here but won't push to it
        ];
        
        // Extract npub and repo from existing Nostr git URLs
        const nostrGitUrls = initialCloneUrls.filter(url => {
          const match = url.match(/^https?:\/\/([^\/]+)\/(npub[a-z0-9]+)\/([^\/]+)\.git$/i);
          return match && match[1] && knownGitServers.some(server => match[1]?.includes(server));
        });
        
        if (nostrGitUrls.length > 0) {
          // Extract npub and repo from the first Nostr git URL
          const firstMatch = nostrGitUrls[0]?.match(/^https?:\/\/([^\/]+)\/(npub[a-z0-9]+)\/([^\/]+)\.git$/i);
          if (firstMatch && firstMatch[2] && firstMatch[3]) {
            const npub = firstMatch[2];
            const repo = firstMatch[3];
            console.log(`🔍 [File Fetch] Expanding clone URLs immediately: Found ${nostrGitUrls.length} Nostr git URLs, expanding to try all known git servers for npub ${npub.slice(0, 16)}.../${repo}`);
            
            // Generate clone URLs for all known git servers
            let addedCount = 0;
            knownGitServers.forEach(server => {
              const expandedUrl = `https://${server}/${npub}/${repo}.git`;
              if (!initialCloneUrls.includes(expandedUrl)) {
                initialCloneUrls.push(expandedUrl);
                addedCount++;
              }
            });
            // CRITICAL: Log once with count instead of per-URL to reduce console spam
            if (addedCount > 0) {
              console.log(`✅ [File Fetch] Added ${addedCount} expanded clone URLs for ${knownGitServers.length} git servers`);
            }
          }
        }
        
        // If we have clone URLs, try multi-source fetch immediately (before querying Nostr)
        // CRITICAL: Check if we've already attempted this fetch to prevent multiple runs
        const repoKey = `${resolvedParams.entity}/${resolvedParams.repo}`;
        const currentBranch = String(initialRepoData?.defaultBranch || "main");
        const repoKeyWithBranch = `${repoKey}:${currentBranch}`;
        
        // Check if already attempted AND we have files, OR if truly in progress
        // CRITICAL: Don't skip if we've attempted but don't have files yet (need to retry)
        // Also handle undefined files explicitly (undefined means not loaded yet, should retry)
        // MOST IMPORTANT: If we have cloneUrls but no files, we MUST try to fetch (don't skip!)
        const filesArray = initialRepoData?.files;
        const hasFiles = filesArray !== undefined && Array.isArray(filesArray) && filesArray.length > 0;
        const hasAttempted = fileFetchAttemptedRef.current === repoKeyWithBranch;
        const isInProgress = fileFetchInProgressRef.current;
        const hasCloneUrls = initialCloneUrls.length > 0;
        
        // CRITICAL: If we have cloneUrls but no files, we MUST fetch (don't skip even if attempted before)
        // Only skip if: (attempted AND has files) OR (in progress AND has files)
        // This allows retry if attempted but no files yet (files undefined or empty array)
        // AND especially allows fetch if cloneUrls exist (they're the source of truth for foreign repos)
        // CRITICAL: If isInProgress is true but we have no files, we should still try (previous attempt might have failed)
        if ((hasAttempted && hasFiles) || (isInProgress && hasFiles)) {
          console.log("⏭️ [File Fetch] Already attempted or in progress, skipping initial clone URLs fetch:", repoKeyWithBranch, { hasAttempted, hasFiles, isInProgress, filesDefined: filesArray !== undefined, filesLength: filesArray?.length || 0, hasCloneUrls });
          return;
        }
        
        // CRITICAL: If isInProgress is true but we have no files, clear it to allow retry
        // This handles the case where a previous fetch attempt failed but left the flag stuck
        if (isInProgress && !hasFiles && hasCloneUrls) {
          console.log("🔄 [File Fetch] Clearing stuck isInProgress flag (no files but cloneUrls exist) to allow retry:", repoKeyWithBranch);
          fileFetchInProgressRef.current = false;
        }
        
        // CRITICAL: If we attempted before but have no files (failed fetch), clear the attempted flag to allow retry
        // This is especially important when cloneUrls exist - we need to keep trying until files are loaded
        if (hasAttempted && !hasFiles) {
          console.log("🔄 [File Fetch] Previous attempt failed (no files), clearing attempted flag to allow retry:", repoKeyWithBranch, { hasCloneUrls, willRetry: hasCloneUrls });
          fileFetchAttemptedRef.current = "";
        }
        
        // CRITICAL: If we have cloneUrls, we MUST try to fetch (even if attempted before with no files)
        // cloneUrls are the source of truth for foreign repos - if they exist, files should be fetchable
        if (initialCloneUrls.length > 0) {
          console.log(`🔍 [File Fetch] NIP-34: Found ${initialCloneUrls.length} clone URLs (including expanded), attempting multi-source fetch immediately`);
          const branch = String(initialRepoData?.defaultBranch || "main");
          
          // Mark as attempted BEFORE starting to prevent other triggers
          // CRITICAL: Set isInProgress here (when we actually start fetching), not earlier
          fileFetchAttemptedRef.current = repoKeyWithBranch;
          fileFetchInProgressRef.current = true;
          
          // Show fetching message for GitHub/GitLab sources
          const hasGithub = initialCloneUrls.some(url => url.includes('github.com'));
          const hasGitlab = initialCloneUrls.some(url => url.includes('gitlab.com'));
          const hasCodeberg = initialCloneUrls.some(url => url.includes('codeberg.org'));
          if (hasGithub) {
            setFetchingFilesFromGit({ source: 'github', message: `Fetching from ${initialCloneUrls.length} source${initialCloneUrls.length > 1 ? 's' : ''}...` });
          } else if (hasGitlab) {
            setFetchingFilesFromGit({ source: 'gitlab', message: `Fetching from ${initialCloneUrls.length} source${initialCloneUrls.length > 1 ? 's' : ''}...` });
          } else if (hasCodeberg) {
            setFetchingFilesFromGit({ source: 'github', message: `Fetching from ${initialCloneUrls.length} source${initialCloneUrls.length > 1 ? 's' : ''}...` }); // Use github icon for Codeberg too
          }
          
          // Update fetch statuses - CRITICAL: Show status for ALL sources immediately
          const initialStatuses = initialCloneUrls.map(url => {
            const source = parseGitSource(url);
            return {
              source: source.displayName,
              status: 'pending' as const,
            };
          });
          setFetchStatuses(initialStatuses); // Reset and set all initial statuses (don't merge, start fresh)
          
          // Fetch from all sources
          // Use resolvedOwnerPubkey or ownerPubkeyForLink as event publisher pubkey for bridge API
          const eventPublisherPubkey = resolvedOwnerPubkey && /^[0-9a-f]{64}$/i.test(resolvedOwnerPubkey) 
            ? resolvedOwnerPubkey 
            : (ownerPubkeyForLink && /^[0-9a-f]{64}$/i.test(ownerPubkeyForLink) ? ownerPubkeyForLink : undefined);
          const { files, statuses } = await fetchFilesFromMultipleSources(
            initialCloneUrls,
            branch,
            (status: FetchStatus) => {
              // CRITICAL: Preserve successful statuses - don't overwrite success with failed
              setFetchStatuses(prev => {
                const updated = [...prev];
                const index = updated.findIndex(s => s.source === status.source.displayName);
                if (index >= 0 && updated[index]) {
                  // CRITICAL: Don't overwrite success status with failed status
                  // If existing status is success, keep it. Only update if it's pending/failed or if new status is success.
                  if (updated[index].status === 'success' && status.status !== 'success') {
                    // Keep the success status - don't overwrite with failed
                    return updated;
                  }
                  updated[index] = {
                    source: status.source.displayName,
                    status: status.status,
                    error: status.error,
                  };
                } else {
                  updated.push({
                    source: status.source.displayName,
                    status: status.status,
                    error: status.error,
                  });
                }
                return updated;
              });
              
              // CRITICAL: Update files immediately when first source succeeds (don't wait for all)
              // Also collect all successful sources for fallback during file opening
              if (status.status === "success" && status.files && status.files.length > 0) {
                const currentFiles = repoDataRef.current?.files;
                
                // First success: update files immediately
                if (!currentFiles || !Array.isArray(currentFiles) || currentFiles.length === 0) {
                  console.log(`🚀 [File Fetch] First source succeeded! Updating files immediately: ${status.files.length} files from ${status.source.displayName}`);
                  // CRITICAL: Use startTransition to defer state update and prevent hook order issues during render
                  startTransition(() => {
                    setRepoData((prev: any) => {
                      // CRITICAL: Create repoData if it doesn't exist yet - files should show immediately
                      const updated = prev ? ({ 
                        ...prev, 
                        files: status.files,
                        // CRITICAL: Store successful sources as array for fallback during file opening
                        successfulSources: [{
                          source: status.source,
                          sourceUrl: status.source.url || status.source.displayName,
                          files: status.files,
                        }],
                        // Keep first source for backward compatibility
                        successfulSource: status.source,
                        successfulSourceUrl: status.source.url || status.source.displayName,
                      }) : {
                        // Create minimal repoData if it doesn't exist yet
                        files: status.files,
                        successfulSources: [{
                          source: status.source,
                          sourceUrl: status.source.url || status.source.displayName,
                          files: status.files,
                        }],
                        successfulSource: status.source,
                        successfulSourceUrl: status.source.url || status.source.displayName,
                      };
                      // CRITICAL: Update ref immediately so subsequent checks see the new files
                      if (updated && repoDataRef) {
                        repoDataRef.current = updated;
                        console.log(`✅ [File Fetch] repoDataRef updated with ${updated.files?.length || 0} files - files should now be visible in UI`);
                      }
                      // CRITICAL: Force a re-render by updating state - ensure files are visible immediately
                      // The useMemo for items depends on repoData, so updating repoData should trigger re-render
                      console.log(`🔄 [File Fetch] Triggering state update with ${updated.files?.length || 0} files`);
                      // CRITICAL: Ensure updated object has all required fields to prevent hook order issues
                      // Add default values to prevent undefined access during re-render
                      const safeUpdated = {
                        ...updated,
                        files: updated.files || [],
                        successfulSources: updated.successfulSources || [],
                      };
                      return safeUpdated;
                    });
                  });
                } else {
                  // Additional success: add to successful sources array for fallback
                  console.log(`✅ [File Fetch] Additional source succeeded! Adding to successful sources: ${status.source.displayName} (${status.files.length} files)`);
                  setRepoData((prev: any) => {
                    const existingSources = prev?.successfulSources || [];
                    // Check if this source is already in the list
                    const alreadyExists = existingSources.some((s: any) => 
                      s.sourceUrl === (status.source.url || status.source.displayName)
                    );
                    
                    if (!alreadyExists) {
                      const updated = prev ? ({
                        ...prev,
                        // Add new successful source to array
                        successfulSources: [
                          ...existingSources,
                          {
                            source: status.source,
                            sourceUrl: status.source.url || status.source.displayName,
                            files: status.files,
                          }
                        ],
                      }) : prev;
                      // CRITICAL: Update ref immediately
                      if (updated && repoDataRef) {
                        repoDataRef.current = updated;
                      }
                      return updated;
                    }
                    return prev;
                  });
                }
              }
            },
            eventPublisherPubkey
          );
          
          // Clear fetching message after fetch completes
          setFetchingFilesFromGit({ source: null, message: '' });
          
          if (files && files.length > 0) {
            console.log(`✅ [File Fetch] NIP-34: Successfully fetched ${files.length} files from clone URLs (immediate fetch)`);
            // CRITICAL: Only update if we haven't already updated from the first success callback
            const currentFiles = repoDataRef.current?.files;
            // Collect all successful sources for fallback during file opening
            const successfulStatuses = statuses.filter((s: any) => s.status === "success" && s.files && s.files.length > 0);
            
            if (!currentFiles || !Array.isArray(currentFiles) || currentFiles.length === 0) {
              // CRITICAL: Store the ownerPubkey and clone URLs used for fetching, so file opening can use the same
              // Also collect all successful sources for fallback during file opening
              const successfulSourcesArray = successfulStatuses.map((s: any) => ({
                source: s.source,
                sourceUrl: s.source.url || s.source.displayName,
                files: s.files,
              }));
              
              setRepoData((prev: any) => prev ? ({ 
                ...prev, 
                files,
                ownerPubkey: eventPublisherPubkey || prev.ownerPubkey, // Store the pubkey used for fetching
                clone: initialCloneUrls.length > 0 
                  ? initialCloneUrls.filter((url: string) => url && !url.includes('localhost') && !url.includes('127.0.0.1'))
                  : prev.clone, // Store clone URLs if not already set (filtered)
                // Store all successful sources for fallback during file opening
                successfulSources: successfulSourcesArray.length > 0 ? successfulSourcesArray : prev.successfulSources,
                // Keep first source for backward compatibility
                successfulSource: successfulStatuses[0]?.source,
                successfulSourceUrl: successfulStatuses[0]?.source?.url || successfulStatuses[0]?.source?.displayName,
              }) : prev);
            } else if (successfulStatuses.length > 0) {
              // Files already exist, but update successful sources array with all completed sources
              const successfulSourcesArray = successfulStatuses.map((s: any) => ({
                source: s.source,
                sourceUrl: s.source.url || s.source.displayName,
                files: s.files,
              }));
              
              setRepoData((prev: any) => {
                const existingSources = prev?.successfulSources || [];
                // Merge with existing, avoiding duplicates
                const mergedSources = [...existingSources];
                successfulSourcesArray.forEach((newSource: any) => {
                  if (!mergedSources.some((s: any) => s.sourceUrl === newSource.sourceUrl)) {
                    mergedSources.push(newSource);
                  }
                });
                
                return prev ? ({
                  ...prev,
                  successfulSources: mergedSources,
                  // Update first source if not set
                  successfulSource: prev.successfulSource || successfulStatuses[0]?.source,
                  successfulSourceUrl: prev.successfulSourceUrl || (successfulStatuses[0]?.source?.url || successfulStatuses[0]?.source?.displayName),
                }) : prev;
              });
            }
            
            // CRITICAL: Save files separately to avoid localStorage quota issues
            try {
              saveRepoFiles(resolvedParams.entity, resolvedParams.repo, files);
              console.log(`✅ [File Fetch] Saved ${files.length} files to separate storage key`);
            } catch (e: any) {
              if (e.name === 'QuotaExceededError' || e.message?.includes('quota')) {
                console.error(`❌ [File Fetch] Quota exceeded when saving files separately - files will only be in memory`);
              } else {
                console.error(`❌ [File Fetch] Failed to save files separately:`, e);
              }
            }
            
            // Update localStorage - only store fileCount, not full files array
            try {
              const repos = loadStoredRepos();
              const updated = repos.map((r) => {
                const matchesOwner = r.ownerPubkey && ownerPubkey && 
                  (r.ownerPubkey === ownerPubkey || r.ownerPubkey.toLowerCase() === ownerPubkey.toLowerCase());
                const matchesRepo = r.repo === resolvedParams.repo || r.slug === resolvedParams.repo || r.name === resolvedParams.repo;
                const matchesEntity = r.entity === resolvedParams.entity || 
                  (r.entity && resolvedParams.entity && r.entity.toLowerCase() === resolvedParams.entity.toLowerCase());
                
                if ((matchesOwner || matchesEntity) && matchesRepo) {
                  // CRITICAL: Only store fileCount, not full files array (prevents quota exceeded)
                  return { ...r, fileCount: files.length };
                }
                return r;
              });
              localStorage.setItem("gittr_repos", JSON.stringify(updated));
            } catch (e: any) {
              if (e.name === 'QuotaExceededError' || e.message?.includes('quota')) {
                console.error(`❌ [File Fetch] Quota exceeded when updating repo list`);
              } else {
                console.error("❌ [File Fetch] Failed to update localStorage:", e);
              }
            }
            
            setFetchStatuses(statuses.map(s => ({
              source: s.source.displayName,
              status: s.status,
              error: s.error,
            })));
            
            // CRITICAL: Reset in-progress flag after fetch completes
            fileFetchInProgressRef.current = false;
            // CRITICAL: Mark as attempted to prevent re-fetching (files are now loaded)
            fileFetchAttemptedRef.current = repoKeyWithBranch;
            return; // Success - exit early, don't query Nostr
          } else {
            console.warn("⚠️ [File Fetch] NIP-34: Immediate multi-source fetch returned no files, will query Nostr");
            setFetchStatuses(statuses.map(s => ({
              source: s.source.displayName,
              status: s.status,
              error: s.error,
            })));
            // CRITICAL: Reset in-progress flag even when no files found
            // Also clear attempted flag if no files found (allows retry on next trigger)
            fileFetchInProgressRef.current = false;
            // Check if files were actually loaded - if not, clear attempted flag to allow retry
            const currentDataAfterFetch = repoDataRef.current;
            const filesAfterFetch = currentDataAfterFetch?.files;
            const hasFilesAfterFetch = filesAfterFetch !== undefined && Array.isArray(filesAfterFetch) && filesAfterFetch.length > 0;
            if (!hasFilesAfterFetch) {
              console.log("🔄 [File Fetch] No files found in immediate fetch, clearing attempted flag to allow retry");
              fileFetchAttemptedRef.current = "";
            }
          }
        }
      })();
      
      // FIRST: Query Nostr for the repository event (files might be in the event)
      (async () => {
        try {
          // Capture variables in closure for use in nested callbacks
          const setRepoDataFn = setRepoData;
          const paramsEntity = resolvedParams.entity;
          const paramsRepo = resolvedParams.repo;
          let foundFiles = false;
          let unsub: (() => void) | undefined;
          // Store sourceUrl and clone URLs from events for fallback use (accessible in closure)
          let sourceUrlFromEvent: string | undefined;
          let eventRepoData: any = null; // Store event data for multi-source fetching
          // CRITICAL: For NIP-34 replaceable events, collect ALL events and pick the latest (highest created_at)
          const collectedEvents: Array<{event: any; relayURL?: string}> = [];
          
          // ALSO check if repoData already has sourceUrl (from localStorage or previous load)
          // This is critical - the UI might already show sourceUrl even if the event doesn't have it
          const currentRepoData = repoDataRef.current;
          if (currentRepoData?.sourceUrl || currentRepoData?.forkedFrom) {
            sourceUrlFromEvent = currentRepoData.sourceUrl || currentRepoData.forkedFrom;
            console.log("✅ [File Fetch] Found sourceUrl in repoData:", {
              sourceUrl: currentRepoData.sourceUrl,
              forkedFrom: currentRepoData.forkedFrom,
              storedForFallback: sourceUrlFromEvent,
            });
          }
          
          // CRITICAL: Prioritize GRASP/git servers - they have the most repos!
          // GRASP servers are both Nostr relays AND git servers, so they're the best source
          const { getGraspServers, getRegularRelays } = require("@/lib/utils/grasp-servers");
          const graspRelays = getGraspServers(defaultRelays);
          const regularRelays = getRegularRelays(defaultRelays);
          // Prioritize GRASP relays first, then regular relays
          const prioritizedRelays = [...graspRelays, ...regularRelays];
          
          // CRITICAL: Validate ownerPubkey is full 64-char hex before using in query
          if (!ownerPubkey || !/^[0-9a-f]{64}$/i.test(ownerPubkey)) {
            console.error("❌ [File Fetch] Invalid ownerPubkey for Nostr query:", {
              ownerPubkey: ownerPubkey ? `${ownerPubkey.slice(0, 8)}... (length: ${ownerPubkey.length})` : "null",
              expectedLength: 64,
              isValid: ownerPubkey ? /^[0-9a-f]{64}$/i.test(ownerPubkey) : false,
            });
            return;
          }
          console.log(`🔍 [File Fetch] Querying Nostr for repo event: ownerPubkey=${ownerPubkey.slice(0, 8)}... (full 64-char hex, length: ${ownerPubkey.length}), repoName=${paramsRepo}, totalRelays=${defaultRelays.length}, graspRelays=${graspRelays.length}, regularRelays=${regularRelays.length}, prioritizedRelays=${prioritizedRelays.length}`);
          
          // Query for SPECIFIC repository by name using "#d" tag (NIP-34 standard)
          // This ensures we only get the correct repo, not all repos from the user
          // CRITICAL: NIP-34 uses replaceable events - we need the LATEST event (highest created_at)
          // Don't use limit: 1 - we need to get all events and pick the latest one
          const filters = [
            {
              kinds: [KIND_REPOSITORY, KIND_REPOSITORY_NIP34],
              authors: [ownerPubkey],
              "#d": [paramsRepo], // CRITICAL: Query for SPECIFIC repo by name
              // Don't set limit - we need all events to find the latest one
            }
          ];
          
          unsub = subscribe(
            filters,
            prioritizedRelays, // Use prioritized relays (GRASP first, then regular)
            (event, isAfterEose, relayURL) => {
              // CRITICAL: For NIP-34 replaceable events, collect ALL events first
              // Don't process immediately - wait for EOSE to pick the latest one
              if (event.kind === KIND_REPOSITORY_NIP34) {
                // Store event for later processing (after EOSE, pick latest)
                collectedEvents.push({ event, relayURL });
                console.log(`📦 [File Fetch] Collected NIP-34 event: id=${event.id.slice(0, 8)}..., created_at=${event.created_at}, relay=${relayURL || 'unknown'}`);
                // Don't return - continue to process it normally too (for immediate display)
                // But we'll override with the latest one after EOSE
              }
              
              if (foundFiles) return;
              
              try {
                // Log all clone tags found in the event
                const cloneTagsInEvent = event.tags?.filter((t): t is string[] => Array.isArray(t) && t[0] === "clone") || [];
                const sourceTagsInEvent = event.tags?.filter((t): t is string[] => Array.isArray(t) && t[0] === "source") || [];
                const forkedFromTagsInEvent = event.tags?.filter((t): t is string[] => Array.isArray(t) && t[0] === "forkedFrom") || [];
                const allTagNames = event.tags?.map((t) => Array.isArray(t) ? t[0] : null).filter((name): name is string => name !== null) || [];
                const uniqueTagNames = [...new Set(allTagNames)];
                
                console.log(`📦 [File Fetch] Received Nostr event: kind=${event.kind}, pubkey=${event.pubkey.slice(0, 8)}, relay=${relayURL}, contentLength=${event.content?.length || 0}, hasTags=${!!(event.tags && event.tags.length > 0)}, totalTags=${event.tags?.length || 0}, uniqueTagNames=${uniqueTagNames.join(',')}, cloneTagsCount=${cloneTagsInEvent.length}, sourceTagsCount=${sourceTagsInEvent.length}, forkedFromTagsCount=${forkedFromTagsInEvent.length}`);
                
                // CRITICAL: For NIP-34 replaceable events, only use the LATEST event (highest created_at)
                // If we already have eventRepoData from a newer event, skip this older event
                if (event.kind === KIND_REPOSITORY_NIP34 && eventRepoData && eventRepoData.lastEventCreatedAt) {
                  if (event.created_at < eventRepoData.lastEventCreatedAt) {
                    console.log(`⏭️ [File Fetch] Skipping older NIP-34 event: id=${event.id.slice(0, 8)}..., created_at=${event.created_at} < ${eventRepoData.lastEventCreatedAt}`);
                    return; // Skip older events
                  }
                }
                
                // Store eventRepoData in closure for later use (don't reset if already exists)
                if (!eventRepoData) {
                  eventRepoData = {};
                }
                
                // Track the latest event's created_at for NIP-34 events
                if (event.kind === KIND_REPOSITORY_NIP34) {
                  if (!eventRepoData.lastEventCreatedAt || event.created_at > eventRepoData.lastEventCreatedAt) {
                    eventRepoData.lastEventCreatedAt = event.created_at;
                    eventRepoData.lastEventId = event.id;
                    console.log(`✅ [File Fetch] Using latest NIP-34 event: id=${event.id.slice(0, 8)}..., created_at=${event.created_at}`);
                  }
                }
                const contributorTags: Array<{pubkey: string; weight: number; role?: "owner" | "maintainer" | "contributor"}> = [];
                
                // CRITICAL: Only process events that match the repo name!
                // Even though we filter by "#d" tag, double-check in callback
                const dTag = event.tags?.find((t): t is string[] => Array.isArray(t) && t[0] === "d");
                const eventRepoName = dTag?.[1];
                if (eventRepoName && eventRepoName !== paramsRepo) {
                  console.log(`⏭️ [File Fetch] Skipping event - repo name mismatch: ${eventRepoName} !== ${paramsRepo}`);
                  return; // Skip events for other repos
                }
                
                if (event.kind === KIND_REPOSITORY_NIP34) {
                  // Initialize or merge with existing eventRepoData
                  if (!eventRepoData.clone) eventRepoData.clone = [];
                  if (!eventRepoData.relays) eventRepoData.relays = [];
                  if (!eventRepoData.topics) eventRepoData.topics = [];
                  if (!eventRepoData.repositoryName) eventRepoData.repositoryName = "";
                  if (!eventRepoData.description) eventRepoData.description = "";
                  if (event.tags && Array.isArray(event.tags)) {
                    for (const tag of event.tags) {
                      if (!Array.isArray(tag) || tag.length < 2) continue;
                      const tagName = tag[0];
                      const tagValue = tag[1];
                      if (tagName === "d") eventRepoData.repositoryName = tagValue;
                      else if (tagName === "name" && !eventRepoData.repositoryName) eventRepoData.repositoryName = tagValue;
                      else if (tagName === "description") eventRepoData.description = tagValue;
                      // GRASP protocol: Extract clone and relay tags
                      else if (tagName === "clone") {
                        // CRITICAL: Filter out localhost URLs - they're not real git servers
                        if (tagValue && !tagValue.includes('localhost') && !tagValue.includes('127.0.0.1')) {
                        if (!eventRepoData.clone) eventRepoData.clone = [];
                        if (!eventRepoData.clone.includes(tagValue)) {
                          eventRepoData.clone.push(tagValue);
                          console.log(`✅ [File Fetch] Added clone URL from event tag: ${tagValue} (total: ${eventRepoData.clone.length})`);
                          }
                        }
                      }
                      else if (tagName === "relay" || tagName === "relays") {
                        if (!eventRepoData.relays) eventRepoData.relays = [];
                        // CRITICAL: Handle comma-separated relay list per NIP-34 spec
                        // Format: ["relays", "wss://relay1.com,wss://relay2.com"]
                        if (tagValue) {
                          const relayUrls = tagValue.split(",").map((r: string) => r.trim()).filter((r: string) => r.length > 0);
                          relayUrls.forEach((relayUrl: string) => {
                            if (!eventRepoData.relays.includes(relayUrl)) {
                              eventRepoData.relays.push(relayUrl);
                            }
                          });
                        }
                      }
                      // Extract sourceUrl from "source" tag (used in push-repo-to-nostr.ts)
                      else if (tagName === "source") {
                        eventRepoData.sourceUrl = tagValue;
                      }
                      // Extract forkedFrom from "forkedFrom" tag
                      else if (tagName === "forkedFrom") {
                        eventRepoData.forkedFrom = tagValue;
                      }
                      // CRITICAL: Extract contributors from "p" tags: ["p", pubkey, weight, role]
                      else if (tagName === "p") {
                        const pubkey = tagValue;
                        const weight = tag.length > 2 ? parseInt(tag[2] as string) || 0 : 0;
                        const rawRole = tag.length > 3 ? (tag[3] as string) : undefined;
                        const normalizedRole: "owner" | "maintainer" | "contributor" | undefined =
                          rawRole === "owner"
                            ? "owner"
                            : rawRole === "maintainer"
                              ? "maintainer"
                              : rawRole === "contributor"
                                ? "contributor"
                                : undefined;
                        const computedRole =
                          normalizedRole ||
                          (weight === 100 ? "owner" : weight >= 50 ? "maintainer" : "contributor");
                        
                        // Validate pubkey format (64 hex chars)
                        if (pubkey && /^[0-9a-f]{64}$/i.test(pubkey)) {
                          contributorTags.push({
                            pubkey,
                            weight,
                            role: computedRole,
                          });
                          // DEBUG: Log each contributor tag extracted (first 5 only)
                          if (contributorTags.length <= 5) {
                            console.log(`📋 [File Fetch] Extracted contributor from p tag #${contributorTags.length}:`, {
                              pubkey: `${pubkey.slice(0, 8)}...${pubkey.slice(-4)}`,
                              weight,
                              role: computedRole,
                              tagLength: tag.length,
                              fullTag: tag
                            });
                          }
                        } else {
                          console.warn(`⚠️ [File Fetch] Invalid pubkey in p tag:`, {
                            pubkey: pubkey ? `${pubkey.slice(0, 16)}...` : "missing",
                            isValid: pubkey && /^[0-9a-f]{64}$/i.test(pubkey),
                            tag: tag
                          });
                        }
                      }
                    }
                  }
                  if (event.content) {
                    try {
                      const contentData = JSON.parse(event.content);
                      // CRITICAL: Extract ALL fields from content, not just files
                      // This includes sourceUrl, forkedFrom, clone, relays, etc.
                      eventRepoData = { ...eventRepoData, ...contentData };
                      // Also merge clone URLs from content if present
                      if (contentData.clone && Array.isArray(contentData.clone)) {
                        if (!eventRepoData.clone) eventRepoData.clone = [];
                        contentData.clone.forEach((url: string) => {
                          // CRITICAL: Filter out localhost URLs - they're not real git servers
                          if (url && !url.includes('localhost') && !url.includes('127.0.0.1') && !eventRepoData.clone.includes(url)) {
                            eventRepoData.clone.push(url);
                          }
                        });
                      }
                      if (contentData.files) {
                        console.log("📦 [File Fetch] Found files in NIP-34 event content:", {
                          filesCount: Array.isArray(contentData.files) ? contentData.files.length : "not an array",
                          filesType: typeof contentData.files,
                        });
                      }
                    } catch (e) {
                      console.warn("⚠️ [File Fetch] Failed to parse NIP-34 event content:", e);
                    }
                  }
                  
                  // CRITICAL: Don't trigger fetch immediately - wait for EOSE to collect ALL clone URLs from ALL events
                  // Just log what we found for debugging
                  if (eventRepoData.clone && Array.isArray(eventRepoData.clone) && eventRepoData.clone.length > 0) {
                    console.log(`📋 [File Fetch] NIP-34: Accumulated ${eventRepoData.clone.length} clone URLs so far from events`);
                  }
                } else {
                  // KIND_REPOSITORY (51) - files should be in JSON content
                  // Also extract clone and relay tags from event tags
                  if (!eventRepoData) eventRepoData = {};
                  if (!eventRepoData.clone) eventRepoData.clone = [];
                  if (!eventRepoData.relays) eventRepoData.relays = [];
                  if (event.tags && Array.isArray(event.tags)) {
                    for (const tag of event.tags) {
                      if (!Array.isArray(tag) || tag.length < 2) continue;
                      const tagName = tag[0];
                      const tagValue = tag[1];
                      // GRASP protocol: Extract clone and relay tags
                      if (tagName === "clone") {
                        // CRITICAL: Filter out localhost URLs - they're not real git servers
                        if (tagValue && !tagValue.includes('localhost') && !tagValue.includes('127.0.0.1')) {
                        if (!eventRepoData.clone) eventRepoData.clone = [];
                        eventRepoData.clone.push(tagValue);
                        }
                      }
                      else if (tagName === "relay" || tagName === "relays") {
                        if (!eventRepoData.relays) eventRepoData.relays = [];
                        // CRITICAL: Handle both formats per NIP-34 spec:
                        // 1. Separate tags: ["relays", "wss://relay1.com"], ["relays", "wss://relay2.com"]
                        // 2. Comma-separated (backward compat): ["relays", "wss://relay1.com,wss://relay2.com"]
                        if (tagValue) {
                          // Check if value contains commas (comma-separated format)
                          if (tagValue.includes(",")) {
                            // Comma-separated format - split and add each
                            const relayUrls = tagValue.split(",").map((r: string) => r.trim()).filter((r: string) => r.length > 0);
                            relayUrls.forEach((relayUrl: string) => {
                              // Ensure wss:// prefix
                              const normalized = relayUrl.startsWith("wss://") || relayUrl.startsWith("ws://") 
                                ? relayUrl 
                                : `wss://${relayUrl}`;
                              if (!eventRepoData.relays.includes(normalized)) {
                                eventRepoData.relays.push(normalized);
                              }
                            });
                          } else {
                            // Single relay per tag - add directly
                            const normalized = tagValue.startsWith("wss://") || tagValue.startsWith("ws://") 
                              ? tagValue 
                              : `wss://${tagValue}`;
                            if (!eventRepoData.relays.includes(normalized)) {
                              eventRepoData.relays.push(normalized);
                            }
                          }
                        }
                      }
                      // Extract sourceUrl from "source" tag (used in push-repo-to-nostr.ts)
                      else if (tagName === "source") {
                        eventRepoData.sourceUrl = tagValue;
                      }
                      // Extract forkedFrom from "forkedFrom" tag
                      else if (tagName === "forkedFrom") {
                        eventRepoData.forkedFrom = tagValue;
                      }
                      // CRITICAL: Extract contributors from "p" tags: ["p", pubkey, weight, role]
                      else if (tagName === "p") {
                        const pubkey = tagValue;
                        const weight = tag.length > 2 ? parseInt(tag[2] as string) || 0 : 0;
                        const rawRole = tag.length > 3 ? (tag[3] as string) : undefined;
                        const normalizedRole: "owner" | "maintainer" | "contributor" | undefined =
                          rawRole === "owner"
                            ? "owner"
                            : rawRole === "maintainer"
                              ? "maintainer"
                              : rawRole === "contributor"
                                ? "contributor"
                                : undefined;
                        const computedRole =
                          normalizedRole ||
                          (weight === 100 ? "owner" : weight >= 50 ? "maintainer" : "contributor");
                        
                        // Validate pubkey format (64 hex chars)
                        if (pubkey && /^[0-9a-f]{64}$/i.test(pubkey)) {
                          contributorTags.push({
                            pubkey,
                            weight,
                            role: computedRole,
                          });
                          // DEBUG: Log each contributor tag extracted (first 5 only)
                          if (contributorTags.length <= 5) {
                            console.log(`📋 [File Fetch] Extracted contributor from p tag #${contributorTags.length}:`, {
                              pubkey: `${pubkey.slice(0, 8)}...${pubkey.slice(-4)}`,
                              weight,
                              role: computedRole,
                              tagLength: tag.length,
                              fullTag: tag
                            });
                          }
                        } else {
                          console.warn(`⚠️ [File Fetch] Invalid pubkey in p tag:`, {
                            pubkey: pubkey ? `${pubkey.slice(0, 16)}...` : "missing",
                            isValid: pubkey && /^[0-9a-f]{64}$/i.test(pubkey),
                            tag: tag
                          });
                        }
                      }
                    }
                  }
                  try {
                    const contentData = JSON.parse(event.content);
                    eventRepoData = { ...eventRepoData, ...contentData };
                    
                    // CRITICAL: Check if repo is marked as deleted/archived
                    // On direct repo access, show deleted message (unlike explore page which hides them completely)
                    if (eventRepoData.deleted === true || eventRepoData.archived === true) {
                      console.log("⏭️ [File Fetch] Repo is marked as deleted/archived on Nostr, showing deleted message:", {
                        deleted: eventRepoData.deleted,
                        archived: eventRepoData.archived,
                        repoName: resolvedParams.repo,
                      });
                      setRepoData((prev: any) => prev ? ({ 
                        ...prev, 
                        deleted: true,
                        description: prev.description || "This repository has been deleted.",
                      }) : prev);
                      foundFiles = true; // Mark as found to prevent further processing
                      return;
                    }
                    
                    // Log if files are present
                    if (eventRepoData.files) {
                      console.log("📦 [File Fetch] Found files field in KIND_REPOSITORY event:", {
                        filesCount: Array.isArray(eventRepoData.files) ? eventRepoData.files.length : "not an array",
                        filesType: typeof eventRepoData.files,
                        firstFile: Array.isArray(eventRepoData.files) && eventRepoData.files.length > 0 ? eventRepoData.files[0] : undefined,
                      });
                    } else {
                      console.log("⚠️ [File Fetch] KIND_REPOSITORY event has no files field");
                    }
                  } catch (e) {
                    console.error("❌ [File Fetch] Failed to parse event content:", e, {
                      contentPreview: event.content?.substring(0, 200),
                    });
                    return;
                  }
                }
                
                // Log FULL event content to see what we're actually getting
                let parsedContent: any = null;
                try {
                  if (event.content) {
                    parsedContent = JSON.parse(event.content);
                  }
                } catch (e) {
                  // ignore
                }
                
                const parsedContentKeys = parsedContent ? Object.keys(parsedContent).join(',') : 'none';
                const eventKeys = Object.keys(eventRepoData).join(',');
                const eventTagsCount = event.tags?.filter(t => Array.isArray(t) && (t[0] === "source" || t[0] === "forkedFrom" || t[0] === "d" || t[0] === "clone" || t[0] === "relay")).length || 0;
                console.log(`📦 [File Fetch] Parsed event data: eventId=${event.id.slice(0, 8)}..., eventKind=${event.kind}, repositoryName=${eventRepoData.repositoryName || 'none'}, hasFiles=${!!(eventRepoData.files && Array.isArray(eventRepoData.files) && eventRepoData.files.length > 0)}, filesCount=${eventRepoData.files?.length || 0}, sourceUrl=${eventRepoData.sourceUrl || 'none'}, forkedFrom=${eventRepoData.forkedFrom || 'none'}, allKeys=${eventKeys}, eventTagsCount=${eventTagsCount}, parsedContentKeys=${parsedContentKeys}, eventPubkey=${event.pubkey.slice(0, 8)}, expectedOwner=${ownerPubkey.slice(0, 8)}, pubkeyMatches=${event.pubkey.toLowerCase() === ownerPubkey.toLowerCase()}`);
                
                // Normalize repo names for comparison (handle underscores vs hyphens, case-insensitive)
                const normalizeRepoName = (name: string): string => {
                  if (!name) return "";
                  return name.toLowerCase().replace(/[_-]/g, "");
                };
                
                const expectedRepoNormalized = normalizeRepoName(resolvedParams.repo);
                const eventRepoNormalized = normalizeRepoName(eventRepoData.repositoryName);
                
                // Match by repository name (case-insensitive, normalized)
                const repoNameMatches = eventRepoNormalized === expectedRepoNormalized;
                
                // Also check if repo name appears in the content JSON (for kind 51)
                const contentMatches = event.kind === KIND_REPOSITORY && 
                  event.content && 
                  (event.content.toLowerCase().includes(`"repositoryname":"${resolvedParams.repo.toLowerCase()}"`) ||
                   event.content.toLowerCase().includes(`"repositoryname":"${resolvedParams.repo.replace(/_/g, '-').toLowerCase()}"`) ||
                   event.content.toLowerCase().includes(`"repositoryname":"${resolvedParams.repo.replace(/-/g, '_').toLowerCase()}"`));
                
                // Also check if the event pubkey matches the owner (for repos without proper repositoryName)
                const pubkeyMatches = event.pubkey.toLowerCase() === ownerPubkey.toLowerCase();
                
                // Accept if: (repo name matches OR pubkey matches) AND files exist
                // CRITICAL: Check that files is actually an array with items
                const hasValidFiles = eventRepoData.files && 
                                     Array.isArray(eventRepoData.files) && 
                                     eventRepoData.files.length > 0;
                
                if ((repoNameMatches || contentMatches || pubkeyMatches) && hasValidFiles) {
                  // Check if repo has unpushed edits before using Nostr event files
                  // This prevents overwriting refetched files from GitHub
                  let shouldUseNostrFiles = true;
                  try {
                    const repos = loadStoredRepos();
                    const existingRepo = repos.find((r) => {
                      const matchesOwner = r.ownerPubkey && ownerPubkey && 
                        (r.ownerPubkey === ownerPubkey || r.ownerPubkey.toLowerCase() === ownerPubkey.toLowerCase());
                      const matchesRepo = r.repo === resolvedParams.repo || r.slug === resolvedParams.repo || r.name === resolvedParams.repo;
                      const matchesEntity = r.entity === resolvedParams.entity || 
                        (r.entity && resolvedParams.entity && r.entity.toLowerCase() === resolvedParams.entity.toLowerCase());
                      return (matchesOwner || matchesEntity) && matchesRepo;
                    });
                    
                    if (existingRepo?.hasUnpushedEdits) {
                      shouldUseNostrFiles = false;
                      console.log("⏭️ [File Fetch] Skipping Nostr event files in state - repo has unpushed edits:", {
                        entity: existingRepo.entity,
                        repo: existingRepo.repo || existingRepo.slug,
                        localFileCount: existingRepo.files?.length || 0,
                        nostrFileCount: eventRepoData.files.length
                      });
                    }
                  } catch (e) {
                    console.error("❌ [File Fetch] Error checking hasUnpushedEdits:", e);
                  }
                  
                  // CRITICAL: Extract contributors from "p" tags and merge with content contributors
                  let contributors: Array<{pubkey?: string; name?: string; picture?: string; weight: number; role?: "owner" | "maintainer" | "contributor"; githubLogin?: string}> = [];
                  
                  // Priority 1: Contributors from "p" tags (published by owner, most reliable)
                  if (contributorTags.length > 0) {
                    contributors = contributorTags.map(c => ({
                      pubkey: c.pubkey,
                      weight: c.weight,
                      role: c.role as "owner" | "maintainer" | "contributor" | undefined,
                    }));
                    console.log(`📋 [File Fetch] Extracted ${contributors.length} contributors from "p" tags:`, 
                      contributors.map(c => ({
                        pubkey: c.pubkey ? `${c.pubkey.slice(0, 8)}...${c.pubkey.slice(-4)}` : "none",
                        weight: c.weight,
                        role: c.role
                      }))
                    );
                    // Check if all contributors have the same pubkey (BUG DETECTION)
                    const uniquePubkeys = new Set(contributors.map(c => c.pubkey).filter(Boolean));
                    if (uniquePubkeys.size === 1 && contributors.length > 1) {
                      console.error(`❌ [File Fetch] BUG: All ${contributors.length} contributors from p tags have the SAME pubkey!`, Array.from(uniquePubkeys)[0]);
                    }
                  }
                  
                  // Priority 2: Merge with contributors from JSON content (if any)
                  if (eventRepoData.contributors && Array.isArray(eventRepoData.contributors) && eventRepoData.contributors.length > 0) {
                    for (const contentContributor of eventRepoData.contributors) {
                      const exists = contributors.some(c => 
                        c.pubkey && contentContributor.pubkey && 
                        c.pubkey.toLowerCase() === contentContributor.pubkey.toLowerCase()
                      );
                      if (!exists) {
                        contributors.push(contentContributor);
                      }
                    }
                    console.log(`📋 [File Fetch] Merged ${eventRepoData.contributors.length} contributors from JSON content`);
                  }
                  
                  // Priority 3: Merge with existing repo contributors (preserve local metadata)
                  const currentRepoData = repoDataRef.current;
                  if (currentRepoData?.contributors && Array.isArray(currentRepoData.contributors) && currentRepoData.contributors.length > 0) {
                    for (const existingContributor of currentRepoData.contributors) {
                      // CRITICAL: Match by pubkey OR githubLogin to avoid duplicates
                      // Contributors without pubkeys should be matched by githubLogin
                      const existingIndex = contributors.findIndex(c => {
                        // Match by pubkey if both have pubkeys
                        if (c.pubkey && existingContributor.pubkey && 
                            c.pubkey.toLowerCase() === existingContributor.pubkey.toLowerCase()) {
                          return true;
                        }
                        // Match by githubLogin if both have githubLogin (for contributors without pubkeys)
                        if (c.githubLogin && existingContributor.githubLogin &&
                            c.githubLogin.toLowerCase() === existingContributor.githubLogin.toLowerCase()) {
                          return true;
                        }
                        return false;
                      });
                      if (existingIndex >= 0 && contributors[existingIndex]) {
                        // Merge: keep pubkey/weight/role from tags/content, but preserve name/picture from existing
                        // CRITICAL: Don't assign pubkey if existing contributor doesn't have one
                        const mergedContributor = {
                          ...contributors[existingIndex],
                          name: existingContributor?.name || contributors[existingIndex]?.name,
                          picture: existingContributor?.picture || contributors[existingIndex]?.picture,
                          githubLogin: existingContributor?.githubLogin || contributors[existingIndex]?.githubLogin,
                          weight: contributors[existingIndex].weight || 0,
                        };
                        // Only set pubkey if existing contributor has one, otherwise keep the one from tags/content
                        if (existingContributor.pubkey) {
                          mergedContributor.pubkey = existingContributor.pubkey;
                        } else if (contributors[existingIndex].pubkey) {
                          mergedContributor.pubkey = contributors[existingIndex].pubkey;
                        }
                        contributors[existingIndex] = mergedContributor;
                      } else {
                        // Add contributor that exists locally but not in event
                        // CRITICAL: Only add if it's not a duplicate (check by githubLogin too)
                        const isDuplicate = contributors.some(c => 
                          (c.pubkey && existingContributor.pubkey && c.pubkey.toLowerCase() === existingContributor.pubkey.toLowerCase()) ||
                          (c.githubLogin && existingContributor.githubLogin && c.githubLogin.toLowerCase() === existingContributor.githubLogin.toLowerCase())
                        );
                        if (!isDuplicate) {
                          contributors.push({
                            ...existingContributor,
                            weight: existingContributor.weight ?? 0,
                          });
                        }
                      }
                    }
                  }
                  
                  // CRITICAL: Always ensure owner (event.pubkey) is in contributors with weight 100 and role owner
                  const ownerInContributors = contributors.some((c) => c.pubkey && c.pubkey.toLowerCase() === event.pubkey.toLowerCase());
                  if (!ownerInContributors) {
                    contributors = [{ pubkey: event.pubkey, weight: 100, role: "owner" }, ...contributors];
                  } else {
                    // Ensure owner has weight 100 and role owner (override any other values)
                    contributors = contributors.map((c) => 
                      c.pubkey && c.pubkey.toLowerCase() === event.pubkey.toLowerCase()
                        ? { ...c, weight: 100, role: "owner" }
                        : c
                    );
                  }
                  
                  contributors = normalizeContributors(contributors);
                  
                  console.log(`✅ [File Fetch] Final contributors list: ${contributors.length} total`, {
                    owners: contributors.filter(c => c.weight === 100 || c.role === "owner").length,
                    maintainers: contributors.filter(c => c.role === "maintainer" || (c.weight >= 50 && c.weight < 100)).length,
                    contributors: contributors.filter(c => c.role === "contributor" || (c.weight > 0 && c.weight < 50)).length,
                  });
                  
                  if (shouldUseNostrFiles) {
                    // CRITICAL: Before using Nostr files, check if there are LOCAL files that should take precedence
                    // This prevents overwriting files that were just added locally
                    let useLocalFiles = false;
                    let localFiles: RepoFileEntry[] = [];
                    try {
                      const repos = loadStoredRepos();
                      const existingRepo = repos.find((r) => {
                        const matchesOwner = r.ownerPubkey && ownerPubkey && 
                          (r.ownerPubkey === ownerPubkey || r.ownerPubkey.toLowerCase() === ownerPubkey.toLowerCase());
                        const matchesRepo = r.repo === resolvedParams.repo || r.slug === resolvedParams.repo || r.name === resolvedParams.repo;
                        const matchesEntity = r.entity === resolvedParams.entity || 
                          (r.entity && resolvedParams.entity && r.entity.toLowerCase() === resolvedParams.entity.toLowerCase());
                        return (matchesOwner || matchesEntity) && matchesRepo;
                      });
                      
                      if (existingRepo) {
                        // Check if repo has local files (from localStorage)
                        if (existingRepo.files && Array.isArray(existingRepo.files) && existingRepo.files.length > 0) {
                          localFiles = existingRepo.files;
                          useLocalFiles = true;
                          console.log("🔒 [File Fetch] Using LOCAL files instead of Nostr files (local files take precedence):", {
                            localFileCount: localFiles.length,
                            nostrFileCount: eventRepoData.files.length,
                            hasUnpushedEdits: existingRepo.hasUnpushedEdits,
                          });
                        } else {
                          // Try loading from separate storage
                          const separateFiles = loadRepoFiles(resolvedParams.entity, resolvedParams.repo);
                          if (separateFiles.length > 0) {
                            localFiles = separateFiles;
                            useLocalFiles = true;
                            console.log("🔒 [File Fetch] Using LOCAL files from separate storage instead of Nostr files:", {
                              localFileCount: localFiles.length,
                              nostrFileCount: eventRepoData.files.length,
                            });
                          }
                        }
                      }
                    } catch (e) {
                      console.error("❌ [File Fetch] Error checking for local files:", e);
                    }
                    
                    foundFiles = true;
                    console.log("✅ [File Fetch] Found files in Nostr event:", {
                      fileCount: eventRepoData.files.length,
                      firstFile: eventRepoData.files[0],
                      repoName: eventRepoData.repositoryName,
                      matchedBy: repoNameMatches ? "name" : contentMatches ? "content" : "pubkey",
                      usingLocalFiles: useLocalFiles,
                    });
                    setRepoDataFn((prev: StoredRepo | null) => prev ? ({
                      ...prev, 
                      files: useLocalFiles ? localFiles : eventRepoData.files, // CRITICAL: Use local files if they exist
                      name: eventRepoData.repositoryName || prev.name, // CRITICAL: Store actual repo name from event
                      repo: eventRepoData.repositoryName || prev.repo, // Also store in repo field for compatibility
                      clone: (eventRepoData.clone && Array.isArray(eventRepoData.clone)) 
                        ? eventRepoData.clone.filter((url: string) => url && !url.includes('localhost') && !url.includes('127.0.0.1'))
                        : prev.clone,
                      relays: eventRepoData.relays || prev.relays,
                      sourceUrl: eventRepoData.sourceUrl || prev.sourceUrl,
                      forkedFrom: eventRepoData.forkedFrom || prev.forkedFrom,
                      contributors: contributors.length > 0 ? contributors : prev.contributors, // Update contributors from event
                    }) : prev);
                    
                    // Update localStorage - use case-insensitive matching and also match by entity
                    // CRITICAL: Only update if we're using Nostr files (not local files)
                    if (!useLocalFiles) {
                    try {
                      const repos = loadStoredRepos();
                      const updated = repos.map((r) => {
                        const matchesOwner = r.ownerPubkey && ownerPubkey && 
                          (r.ownerPubkey === ownerPubkey || r.ownerPubkey.toLowerCase() === ownerPubkey.toLowerCase());
                        const matchesRepo = r.repo === paramsRepo || r.slug === paramsRepo || r.name === paramsRepo;
                        const matchesEntity = r.entity === paramsEntity || 
                          (r.entity && paramsEntity && r.entity.toLowerCase() === paramsEntity.toLowerCase());
                        
                        if ((matchesOwner || matchesEntity) && matchesRepo) {
                          // CRITICAL: Don't overwrite files if repo has unpushed edits (e.g., from refetch)
                          // The local files (from refetch) should take precedence over old Nostr event files
                          if (r.hasUnpushedEdits) {
                            console.log("⏭️ [File Fetch] Skipping Nostr event files - repo has unpushed edits (local files take precedence):", { 
                              entity: r.entity, 
                              repo: r.repo || r.slug,
                              ownerPubkey: r.ownerPubkey?.slice(0, 8),
                              localFileCount: r.files?.length || 0,
                              nostrFileCount: eventRepoData.files.length 
                            });
                            return r; // Keep existing repo with local files
                          }
                            
                            // CRITICAL: Also check if repo has local files that should take precedence
                            const hasLocalFiles = r.files && Array.isArray(r.files) && r.files.length > 0;
                            if (hasLocalFiles) {
                              console.log("⏭️ [File Fetch] Skipping Nostr event files - repo has local files (local files take precedence):", { 
                              entity: r.entity, 
                              repo: r.repo || r.slug,
                              ownerPubkey: r.ownerPubkey?.slice(0, 8),
                              localFileCount: r.files?.length || 0,
                              nostrFileCount: eventRepoData.files.length 
                            });
                            return r; // Keep existing repo with local files
                          }
                          
                          console.log("💾 [File Fetch] Updating repo in localStorage from Nostr event:", { 
                            entity: r.entity, 
                            repo: r.repo || r.slug,
                            ownerPubkey: r.ownerPubkey?.slice(0, 8),
                            fileCount: eventRepoData.files.length,
                            contributorsCount: contributors.length,
                          });
                          return { 
                            ...r, 
                            files: eventRepoData.files,
                            contributors: contributors.length > 0 ? contributors : r.contributors, // Update contributors from event
                          };
                        }
                        return r;
                      });
                      localStorage.setItem("gittr_repos", JSON.stringify(updated));
                      console.log("💾 [File Fetch] Updated localStorage with files from Nostr event");
                    } catch (e) {
                      console.error("❌ [File Fetch] Failed to update localStorage:", e);
                      }
                    } else {
                      console.log("⏭️ [File Fetch] Skipping localStorage update - using local files instead of Nostr files");
                    }
                  } else {
                    // Don't mark as foundFiles = true, so we don't update localStorage either
                    console.log("⏭️ [File Fetch] Not using Nostr event files - repo has unpushed edits, keeping local files");
                  }
                  
                  fileFetchInProgressRef.current = false;
                  if (unsub) unsub();
                } else {
                  // Log detailed info about why files weren't accepted
                  const reason = !repoNameMatches && !contentMatches && !pubkeyMatches 
                    ? "repo name/pubkey mismatch" 
                    : !eventRepoData.files 
                    ? "no files field in event" 
                    : !Array.isArray(eventRepoData.files)
                    ? "files is not an array"
                    : eventRepoData.files.length === 0
                    ? "files array is empty"
                    : "unknown";
                  
                  const eventKeys = Object.keys(eventRepoData).join(',');
                  const eventContentPreview = event.content ? event.content.substring(0, 100) : "no content";
                  console.log(`⚠️ [File Fetch] Event found but files not accepted: reason=${reason}, eventRepoName=${eventRepoData.repositoryName || 'none'}, expectedRepoName=${resolvedParams.repo}, repoNameMatches=${repoNameMatches}, contentMatches=${contentMatches}, pubkeyMatches=${pubkeyMatches}, hasFiles=${!!(eventRepoData.files && Array.isArray(eventRepoData.files))}, filesLength=${eventRepoData.files?.length || 0}, eventKeys=${eventKeys}, contentPreview=${eventContentPreview}`);
                  
                  // CRITICAL: Even if event doesn't have files, we should still extract sourceUrl
                  // This is needed for the GitHub fallback when git-nostr-bridge returns 404
                  // Store in closure variable for immediate use, and update repoData
                  const allKeys = Object.keys(eventRepoData).join(',');
                  console.log(`🔍 [File Fetch] Checking for sourceUrl in eventRepoData: hasSourceUrl=${!!eventRepoData.sourceUrl}, hasForkedFrom=${!!eventRepoData.forkedFrom}, sourceUrl=${eventRepoData.sourceUrl || 'none'}, forkedFrom=${eventRepoData.forkedFrom || 'none'}, allKeys=${allKeys}`);
                  
                  if (eventRepoData.sourceUrl || eventRepoData.forkedFrom) {
                    sourceUrlFromEvent = eventRepoData.sourceUrl || eventRepoData.forkedFrom;
                    // CRITICAL: Update effectiveSourceUrl immediately so button text updates
                    if (sourceUrlFromEvent && (
                      sourceUrlFromEvent.includes("github.com") || 
                      sourceUrlFromEvent.includes("gitlab.com") || 
                      sourceUrlFromEvent.includes("codeberg.org")
                    )) {
                      setEffectiveSourceUrl(sourceUrlFromEvent);
                    }
                    // CRITICAL: Only update state if values actually changed (prevents unnecessary re-renders)
                    setRepoData((prev: any) => {
                      if (!prev) return prev;
                      const newSourceUrl = eventRepoData.sourceUrl || prev.sourceUrl;
                      const newForkedFrom = eventRepoData.forkedFrom || prev.forkedFrom;
                      const newName = eventRepoData.repositoryName || prev.name;
                      const newRepo = eventRepoData.repositoryName || prev.repo;
                      const newClone = (eventRepoData.clone && Array.isArray(eventRepoData.clone)) 
                        ? eventRepoData.clone.filter((url: string) => url && !url.includes('localhost') && !url.includes('127.0.0.1'))
                        : prev.clone;
                      const newRelays = eventRepoData.relays || prev.relays;
                      
                      // Skip update if nothing changed
                      if (prev.sourceUrl === newSourceUrl && 
                          prev.forkedFrom === newForkedFrom && 
                          prev.name === newName && 
                          prev.repo === newRepo &&
                          JSON.stringify(prev.clone) === JSON.stringify(newClone) &&
                          JSON.stringify(prev.relays) === JSON.stringify(newRelays)) {
                        return prev;
                      }
                      
                      console.log(`✅ [File Fetch] Event has sourceUrl - saving for fallback: sourceUrl=${eventRepoData.sourceUrl || 'none'}, forkedFrom=${eventRepoData.forkedFrom || 'none'}, storedForFallback=${sourceUrlFromEvent || 'none'}`);
                      return {
                        ...prev,
                        name: newName,
                        repo: newRepo,
                        sourceUrl: newSourceUrl,
                        forkedFrom: newForkedFrom,
                        clone: newClone,
                        relays: newRelays,
                      };
                    });
                  } else {
                    // CRITICAL: If no sourceUrl but we have clone URLs, use the first clone URL as sourceUrl
                    // This handles Codeberg/GitHub repos that have clone URLs but no sourceUrl field
                    // Also handles Nostr git servers (gittr.space, etc.) - use first clone URL as sourceUrl
                    if (eventRepoData?.clone && Array.isArray(eventRepoData.clone) && eventRepoData.clone.length > 0) {
                      // CRITICAL: Only use GitHub/GitLab/Codeberg clone URLs as sourceUrl
                      // Nostr git servers (gittr.space, etc.) are handled by multi-source fetcher, not fetchGithubRaw
                      const gitCloneUrl = eventRepoData.clone.find((url: string) => 
                        url.includes('codeberg.org') || url.includes('github.com') || url.includes('gitlab.com')
                      );
                      if (gitCloneUrl) {
                        // Remove .git suffix and convert SSH to HTTPS if needed
                        let sourceUrl = gitCloneUrl.replace(/\.git$/, '');
                        const sshMatch = sourceUrl.match(/^git@([^:]+):(.+)$/);
                        if (sshMatch) {
                          const [, host, path] = sshMatch;
                          sourceUrl = `https://${host}/${path}`;
                        }
                        sourceUrlFromEvent = sourceUrl;
                        // CRITICAL: Update effectiveSourceUrl immediately so button text updates
                        setEffectiveSourceUrl(sourceUrl);
                        // CRITICAL: Only update state if sourceUrl is actually different (prevents unnecessary re-renders)
                        setRepoData((prev: any) => {
                          if (!prev) return prev;
                          // Skip update if sourceUrl is already set to the same value
                          if (prev.sourceUrl === sourceUrl) {
                            return prev;
                          }
                          console.log("✅ [File Fetch] Using clone URL as sourceUrl:", sourceUrl, {
                            isGitHub: gitCloneUrl.includes('github.com'),
                            isGitLab: gitCloneUrl.includes('gitlab.com'),
                            isCodeberg: gitCloneUrl.includes('codeberg.org'),
                            previousSourceUrl: prev.sourceUrl || 'none',
                          });
                          return {
                            ...prev,
                            sourceUrl: sourceUrl,
                            clone: (eventRepoData.clone && Array.isArray(eventRepoData.clone)) 
                          ? eventRepoData.clone.filter((url: string) => url && !url.includes('localhost') && !url.includes('127.0.0.1'))
                          : prev.clone,
                          };
                        });
                      } else {
                        console.log("ℹ️ [File Fetch] Event has clone URLs but none are GitHub/GitLab/Codeberg - will use multi-source fetcher for Nostr git servers");
                      }
                    } else {
                      console.log("❌ [File Fetch] Event has NO sourceUrl or forkedFrom - cannot fetch from git server");
                    }
                  }
                  
                  // CRITICAL: Even if event doesn't have files, we should still try git-nostr-bridge
                  // Some repos don't store files in the event, they rely on git-nostr-bridge to clone and serve files
                  // Don't mark as foundFiles = true, so fallback will trigger
                }
              } catch (e) {
                console.error("❌ [File Fetch] Error parsing repo event:", e);
              }
            },
            undefined,
            async (events, relayURL) => {
              // CRITICAL: Prevent multiple EOSE callbacks from triggering file fetching
              // Each relay sends EOSE, but we only want to process file fetching once
              const repoKey = `${resolvedParams.entity}/${resolvedParams.repo}`;
              
              // Check if we've already processed EOSE for this repo (from any relay)
              // Only process the FIRST EOSE that arrives
              if (eoseProcessedRef.current.has(repoKey)) {
                // CRITICAL: Don't log every skipped EOSE - too verbose with multiple relays
                // Only log first EOSE for debugging
                return;
              }
              
              // Only log the FIRST EOSE to reduce console spam
              console.log(`📡 [File Fetch] EOSE from relay: ${relayURL}, total events: ${events.length}, collected NIP-34 events: ${collectedEvents.length}`);
              
              // CRITICAL: For NIP-34 replaceable events, pick the LATEST event (highest created_at)
              // This ensures we use the most recent event, not the first one found
              if (collectedEvents.length > 1) {
                // Sort by created_at descending (latest first)
                collectedEvents.sort((a, b) => (b.event.created_at || 0) - (a.event.created_at || 0));
                const latestEvent = collectedEvents[0];
                if (latestEvent && latestEvent.event) {
                  console.log(`✅ [File Fetch] Found ${collectedEvents.length} NIP-34 events - using latest: id=${latestEvent.event.id.slice(0, 8)}..., created_at=${latestEvent.event.created_at}`);
                }
                
                // Re-process the latest event to ensure we use its data
                // The event callback above already processed it, but we want to make sure we're using the latest
                // This is handled by the fact that we process events as they arrive, and the latest one will have the highest created_at
                // But we log it here for debugging
              } else if (collectedEvents.length === 1) {
                const firstEvent = collectedEvents[0];
                if (firstEvent && firstEvent.event) {
                  console.log(`📦 [File Fetch] Found 1 NIP-34 event: id=${firstEvent.event.id.slice(0, 8)}..., created_at=${firstEvent.event.created_at}`);
                }
              }
              
              // Mark this repo as processed
              eoseProcessedRef.current.add(repoKey);
              
              // CRITICAL: EOSE is called when relay finishes sending events
              // But we might still be processing events in the callback above
              // So we need to wait a bit before deciding to fallback
              setTimeout(async () => {
                if (!foundFiles) {
                  console.log("⏭️ [File Fetch] No files found in Nostr events from", relayURL, "- checked", events.length, "events");
                  console.log("⏭️ [File Fetch] This is NORMAL for foreign repos - files are served from git servers, not from events");
                  
                  // Try multi-source fetching if we have clone URLs
                  const currentData = repoDataRef.current;
                  const cloneUrls: string[] = [];
                  
                  // Get clone URLs from event data (stored in closure) - PRIORITY 1
                  if (eventRepoData?.clone && Array.isArray(eventRepoData.clone) && eventRepoData.clone.length > 0) {
                    console.log(`📋 [File Fetch] NIP-34: Found ${eventRepoData.clone.length} clone URLs in event`);
                    eventRepoData.clone.forEach((url: string) => {
                      // CRITICAL: Filter out localhost URLs - they're not real git servers
                      if (url && !url.includes('localhost') && !url.includes('127.0.0.1') && !cloneUrls.includes(url)) {
                        cloneUrls.push(url);
                      }
                    });
                  }
                  
                  // Also check repoData - PRIORITY 2
                  if (currentData?.clone && Array.isArray(currentData.clone) && currentData.clone.length > 0) {
                    console.log(`📋 [File Fetch] NIP-34: Found ${currentData.clone.length} clone URLs in repoData`);
                    currentData.clone.forEach((url: string) => {
                      // CRITICAL: Filter out localhost URLs - they're not real git servers
                      if (url && !url.includes('localhost') && !url.includes('127.0.0.1') && !cloneUrls.includes(url)) {
                        cloneUrls.push(url);
                      }
                    });
                  }
                  
                  // Also check localStorage - PRIORITY 3
                  try {
                    const repos = loadStoredRepos();
                    const matchingRepo = repos.find((r) => {
                      const entityMatch = r.entity === resolvedParams.entity || 
                        (r.entity && resolvedParams.entity && r.entity.toLowerCase() === resolvedParams.entity.toLowerCase());
                      const repoMatch = r.repo === resolvedParams.repo || r.slug === resolvedParams.repo || r.name === resolvedParams.repo;
                      const ownerMatch = r.ownerPubkey && ownerPubkey && 
                        (r.ownerPubkey === ownerPubkey || r.ownerPubkey.toLowerCase() === ownerPubkey.toLowerCase());
                      return (entityMatch || ownerMatch) && repoMatch;
                    });
                    if (matchingRepo?.clone && Array.isArray(matchingRepo.clone) && matchingRepo.clone.length > 0) {
                      console.log(`📋 [File Fetch] NIP-34: Found ${matchingRepo.clone.length} clone URLs in localStorage`);
                      matchingRepo.clone.forEach((url: string) => {
                        // CRITICAL: Filter out localhost URLs - they're not real git servers
                        if (url && !url.includes('localhost') && !url.includes('127.0.0.1') && !cloneUrls.includes(url)) {
                          cloneUrls.push(url);
                        }
                      });
                    }
                  } catch (e) {
                    console.error("❌ [File Fetch] Error reading clone URLs:", e);
                  }
                  
                  console.log(`📋 [File Fetch] NIP-34: Total ${cloneUrls.length} unique clone URLs collected`);
                  
                  // CRITICAL: If we have a sourceUrl but it's not in clone URLs, add it!
                  // This handles cases where the repo exists on GitHub/Codeberg/GitLab but the clone URL wasn't in the NIP-34 event
                  // Check both repoDataRef and localStorage for sourceUrl
                  let sourceUrl = currentData?.sourceUrl || currentData?.forkedFrom;
                  if (!sourceUrl && typeof window !== "undefined") {
                    try {
                      const repos = loadStoredRepos();
                      const matchingRepo = repos.find((r) => {
                        const entityMatch = r.entity === resolvedParams.entity || 
                          (r.entity && resolvedParams.entity && r.entity.toLowerCase() === resolvedParams.entity.toLowerCase());
                        const repoMatch = r.repo === resolvedParams.repo || r.slug === resolvedParams.repo || r.name === resolvedParams.repo;
                        const ownerMatch = r.ownerPubkey && ownerPubkey && 
                          (r.ownerPubkey === ownerPubkey || r.ownerPubkey.toLowerCase() === ownerPubkey.toLowerCase());
                        return (entityMatch || ownerMatch) && repoMatch;
                      });
                      sourceUrl = matchingRepo?.sourceUrl || matchingRepo?.forkedFrom;
                    } catch (e) {
                      console.error("❌ [File Fetch] Error reading sourceUrl from localStorage in EOSE:", e);
                    }
                  }
                  
                  if (sourceUrl && !cloneUrls.includes(sourceUrl)) {
                    const sourceUrlMatch = sourceUrl.match(/(github\.com|codeberg\.org|gitlab\.com)\/([^\/]+)\/([^\/]+)/i);
                    if (sourceUrlMatch) {
                      console.log(`✅ [File Fetch] Adding sourceUrl to clone URLs: ${sourceUrl}`);
                      cloneUrls.push(sourceUrl);
                    }
                  }
                  
                  // CRITICAL: Expand Nostr git clone URLs to try other known git servers
                  // If we have one Nostr git URL (e.g., relay.ngit.dev), also try other known servers
                  // This matches the behavior of the reference client (gitworkshop.dev)
                  const knownGitServers = [
                    "relay.ngit.dev",
                    "ngit-relay.nostrver.se",
                    "gitnostr.com",
                    "ngit.danconwaydev.com",
                    "git.shakespeare.diy",
                    "git-01.uid.ovh",
                    "git-02.uid.ovh",
                  ];
                  
                  // Extract npub and repo from existing Nostr git URLs
                  const nostrGitUrls = cloneUrls.filter(url => {
                    const match = url.match(/^https?:\/\/([^\/]+)\/(npub[a-z0-9]+)\/([^\/]+)\.git$/i);
                    return match && match[1] && knownGitServers.some(server => match[1]?.includes(server));
                  });
                  
                  if (nostrGitUrls.length > 0) {
                    // Extract npub and repo from the first Nostr git URL
                    const firstMatch = nostrGitUrls[0]?.match(/^https?:\/\/([^\/]+)\/(npub[a-z0-9]+)\/([^\/]+)\.git$/i);
                    if (firstMatch && firstMatch[2] && firstMatch[3]) {
                      const npub = firstMatch[2];
                      const repo = firstMatch[3];
                      console.log(`🔍 [File Fetch] Expanding clone URLs: Found ${nostrGitUrls.length} Nostr git URLs, expanding to try all known git servers for npub ${npub.slice(0, 16)}.../${repo}`);
                      
                      // Generate clone URLs for all known git servers
                      let addedCount = 0;
                      knownGitServers.forEach(server => {
                        const expandedUrl = `https://${server}/${npub}/${repo}.git`;
                        if (!cloneUrls.includes(expandedUrl)) {
                          cloneUrls.push(expandedUrl);
                          addedCount++;
                        }
                      });
                      // CRITICAL: Log once with count instead of per-URL to reduce console spam
                      if (addedCount > 0) {
                        console.log(`✅ [File Fetch] Added ${addedCount} expanded clone URLs for ${knownGitServers.length} git servers (EOSE)`);
                      }
                    }
                  }
                  
                  // If we have clone URLs, try multi-source fetching (NIP-34)
                  // CRITICAL: Check if we've already attempted this fetch to prevent multiple runs
                  const repoKey = `${resolvedParams.entity}/${resolvedParams.repo}`;
                  const currentBranch = String(currentData?.defaultBranch || "main");
                  const repoKeyWithBranch = `${repoKey}:${currentBranch}`;
                  
                  // Check if already attempted AND we have files, OR if truly in progress
                  // CRITICAL: Don't skip if we've attempted but don't have files yet (need to retry)
