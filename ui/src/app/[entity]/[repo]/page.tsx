"use client";

import { useEffect, useLayoutEffect, useState, useMemo, useCallback, useRef, use } from "react";
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
import { useSearchParams, useRouter, usePathname } from "next/navigation";
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
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";
import { isOwner as checkIsOwner } from "@/lib/repo-permissions";
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

export default function RepoCodePage({
  params,
}: {
  params: Promise<{ entity: string; repo: string }>;
}) {
  const resolvedParams = use(params);
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
                          // Use ownerPubkey if available, otherwise try to resolve from entity
                          const ownerPubkey = repo.ownerPubkey || effectiveUserPubkey || 
                            (resolvedParams.entity && resolvedParams.entity.length === 8 && /^[0-9a-f]{8}$/i.test(resolvedParams.entity) 
                              ? undefined // If entity is a pubkey prefix, we need full pubkey - try to resolve
                              : undefined);
                          
                          if (ownerPubkey && !contributors.some((c) => c.pubkey === ownerPubkey)) {
                            contributors.unshift({ 
                              pubkey: ownerPubkey, 
                              name: repo.entityDisplayName || resolvedParams.entity, 
                  weight: 100,
                  role: "owner"
                            });
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
        const repoName = repo.repo || repo.slug || resolvedParams.repo;
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
    
    // Skip if already attempted for this branch (prevents infinite loops)
    // But allow refetch if branch changed OR if repo has clone URLs (always try multi-source)
    if (hasAttempted && !fileFetchInProgressRef.current && !hasCloneUrls) {
      console.log("⏭️ [File Fetch] Already attempted for this repo+branch, skipping:", repoKeyWithBranch);
      return;
    }
    
    // For repos with clone URLs, allow one retry per page load (but not infinite loops)
    // Use a separate flag to track if we've already done the retry
    const retryKey = `retry_${repoKeyWithBranch}`;
    const hasRetried = sessionStorage.getItem(retryKey) === "true";
    
    if (hasCloneUrls && hasAttempted && !hasRetried) {
      console.log("🔄 [File Fetch] Repo has clone URLs, will retry multi-source fetch once");
      // Mark as retried to prevent infinite loops
      sessionStorage.setItem(retryKey, "true");
      // Reset the attempted flag to allow one retry
      fileFetchAttemptedRef.current = "";
    } else if (hasCloneUrls && hasAttempted && hasRetried) {
      // Already retried once - don't retry again (prevents infinite loops)
      console.log("⏭️ [File Fetch] Already retried once for this repo, skipping to prevent loop");
      return;
    }
    
    // Check if repo already has files (only if repoData exists)
    // NOTE: For branch switching, we want to refetch even if files exist (different branch = different files)
    const hasFiles = currentRepoData?.files && Array.isArray(currentRepoData.files) && currentRepoData.files.length > 0;
    const hasSourceUrl = !!currentRepoData?.sourceUrl;
    
    // This prevents clicking a file from triggering file list fetching
    const isFileOpening = openingFromURLRef.current || selectedFile !== null;
    
    // CRITICAL: Log only primitives to avoid React re-render loops
    // Logging objects can trigger serialization that causes re-renders
    // console.log("🔍 [File Fetch] Checking repo:", `repo=${repoKeyWithBranch}, branch=${currentBranch}, hasFiles=${hasFiles}, hasSourceUrl=${hasSourceUrl}, hasRepoData=${!!currentRepoData}, filesLength=${currentRepoData?.files?.length || 0}, isFileOpening=${isFileOpening}`);
    
    // If file opening is in progress, skip file fetching to prevent re-render loops
    if (isFileOpening && hasFiles) {
      console.log("⏭️ [File Fetch] File opening in progress, skipping file list fetch to prevent loop");
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
      
      fileFetchInProgressRef.current = true;
      
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
            // CRITICAL: Use findRepoByEntityAndName for consistent matching (handles npub, case-insensitive, etc.)
            const matchingRepo = findRepoByEntityAndName<StoredRepo>(repos, resolvedParams.entity, resolvedParams.repo);
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
        
        // Check if already attempted or in progress
        if (fileFetchAttemptedRef.current === repoKeyWithBranch || fileFetchInProgressRef.current) {
          console.log("⏭️ [File Fetch] Already attempted or in progress, skipping initial clone URLs fetch:", repoKeyWithBranch);
          return;
        }
        
        if (initialCloneUrls.length > 0) {
          console.log(`🔍 [File Fetch] NIP-34: Found ${initialCloneUrls.length} clone URLs (including expanded), attempting multi-source fetch immediately`);
          const branch = String(initialRepoData?.defaultBranch || "main");
          
          // Mark as attempted BEFORE starting to prevent other triggers
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
                    return updated;
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
            
            // Update localStorage
            try {
              const repos = loadStoredRepos();
              const updated = repos.map((r) => {
                const matchesOwner = r.ownerPubkey && ownerPubkey && 
                  (r.ownerPubkey === ownerPubkey || r.ownerPubkey.toLowerCase() === ownerPubkey.toLowerCase());
                const matchesRepo = r.repo === resolvedParams.repo || r.slug === resolvedParams.repo || r.name === resolvedParams.repo;
                const matchesEntity = r.entity === resolvedParams.entity || 
                  (r.entity && resolvedParams.entity && r.entity.toLowerCase() === resolvedParams.entity.toLowerCase());
                
                if ((matchesOwner || matchesEntity) && matchesRepo) {
                  return { ...r, files };
                }
                return r;
              });
              localStorage.setItem("gittr_repos", JSON.stringify(updated));
            } catch (e) {
              console.error("❌ [File Fetch] Failed to update localStorage:", e);
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
            fileFetchInProgressRef.current = false;
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
          
          console.log(`🔍 [File Fetch] Querying Nostr for repo event: ownerPubkey=${ownerPubkey!.slice(0, 8)}, repoName=${paramsRepo}, totalRelays=${defaultRelays.length}, graspRelays=${graspRelays.length}, regularRelays=${regularRelays.length}, prioritizedRelays=${prioritizedRelays.length}`);
          
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
                        eventRepoData.relays.push(tagValue);
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
                        eventRepoData.relays.push(tagValue);
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
                  
                  // Check if already attempted or in progress
                  if (fileFetchAttemptedRef.current === repoKeyWithBranch || fileFetchInProgressRef.current) {
                    console.log("⏭️ [File Fetch] Already attempted or in progress, skipping EOSE clone URLs fetch:", repoKeyWithBranch);
                    // CRITICAL: Still try git-nostr-bridge as fallback even if multi-source fetch was skipped
                    console.log("⏭️ [File Fetch] Falling back to git-nostr-bridge (multi-source fetch was skipped)");
                    fetchFromGitNostrBridge();
                    return;
                  }
                  
                  if (cloneUrls.length > 0) {
                    console.log(`🔍 [File Fetch] NIP-34: Found ${cloneUrls.length} clone URLs after EOSE, attempting multi-source fetch`);
                    const branch = String(currentData?.defaultBranch || "main");
                    
                    // Mark as attempted BEFORE starting to prevent other triggers
                    fileFetchAttemptedRef.current = repoKeyWithBranch;
                    fileFetchInProgressRef.current = true;
                    
                    // Update fetch statuses - merge with existing to avoid duplicates
                    const initialStatuses = cloneUrls.map(url => {
                      const source = parseGitSource(url);
                      return {
                        source: source.displayName,
                        status: 'pending' as const,
                      };
                    });
                    setFetchStatuses(prev => {
                      const merged = [...prev];
                      initialStatuses.forEach((newStatus: { source: string; status: 'pending' | 'fetching' | 'success' | 'failed'; error?: string }) => {
                        const existingIndex = merged.findIndex(s => s.source === newStatus.source);
                        if (existingIndex >= 0) {
                          // Update existing status only if it's still pending or failed
                          if (merged[existingIndex] && (merged[existingIndex].status === 'pending' || merged[existingIndex].status === 'failed')) {
                            merged[existingIndex] = newStatus;
                          }
                        } else {
                          merged.push(newStatus);
                        }
                      });
                      return merged;
                    });
                    
                    // Fetch from all sources
                    // Use event.pubkey as event publisher pubkey for bridge API (bridge stores repos by event publisher)
                    // TypeScript workaround: event is a Nostr event with pubkey, but type might not be fully inferred
                    const eventPubkey = (event as any)?.pubkey;
                    const eventPublisherPubkey = (eventPubkey && typeof eventPubkey === 'string' && /^[0-9a-f]{64}$/i.test(eventPubkey)) 
                      ? eventPubkey 
                      : undefined;
                    const { files, statuses } = await fetchFilesFromMultipleSources(
                      cloneUrls,
                      branch,
                      (status: FetchStatus) => {
                        setFetchStatuses(prev => {
                          const updated = [...prev];
                          const index = updated.findIndex(s => s.source === status.source.displayName);
                          if (index >= 0) {
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
                              return updated;
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
                    
                    if (files && files.length > 0) {
                      console.log(`✅ [File Fetch] NIP-34: Successfully fetched ${files.length} files from clone URLs`);
                      // Only update if we haven't already updated from the first success callback
                      const currentFiles = repoDataRef.current?.files;
                      // Collect all successful sources for fallback during file opening
                      const successfulStatuses = statuses.filter(s => s.status === "success" && s.files && s.files.length > 0);
                      
                      if (!currentFiles || !Array.isArray(currentFiles) || currentFiles.length === 0) {
                        const successfulSourcesArray = successfulStatuses.map(s => ({
                          source: s.source,
                          sourceUrl: s.source.url || s.source.displayName,
                          files: s.files,
                        }));
                        
                        setRepoData((prev: any) => prev ? ({ 
                          ...prev, 
                          files,
                          // Store all successful sources for fallback during file opening
                          successfulSources: successfulSourcesArray.length > 0 ? successfulSourcesArray : prev.successfulSources,
                          // Keep first source for backward compatibility
                          successfulSource: successfulStatuses[0]?.source,
                          successfulSourceUrl: successfulStatuses[0]?.source?.url || successfulStatuses[0]?.source?.displayName,
                        }) : prev);
                      } else if (successfulStatuses.length > 0) {
                        // Files already exist, but update successful sources array with all completed sources
                        const successfulSourcesArray = successfulStatuses.map(s => ({
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
                      
                      // Update localStorage
                      try {
                        const repos = loadStoredRepos();
                        const updated = repos.map((r) => {
                          const matchesOwner = r.ownerPubkey && ownerPubkey && 
                            (r.ownerPubkey === ownerPubkey || r.ownerPubkey.toLowerCase() === ownerPubkey.toLowerCase());
                          const matchesRepo = r.repo === resolvedParams.repo || r.slug === resolvedParams.repo || r.name === resolvedParams.repo;
                          const matchesEntity = r.entity === resolvedParams.entity || 
                            (r.entity && resolvedParams.entity && r.entity.toLowerCase() === resolvedParams.entity.toLowerCase());
                          
                          if ((matchesOwner || matchesEntity) && matchesRepo) {
                            return { ...r, files };
                          }
                          return r;
                        });
                        localStorage.setItem("gittr_repos", JSON.stringify(updated));
                      } catch (e) {
                        console.error("❌ [File Fetch] Failed to update localStorage:", e);
                      }
                      
                      setFetchStatuses(statuses.map(s => ({
                        source: s.source.displayName,
                        status: s.status,
                        error: s.error,
                      })));
                      
                      fileFetchInProgressRef.current = false;
                      // CRITICAL: Mark as attempted to prevent re-fetching (files are now loaded)
                      const currentRepoKey = `${resolvedParams.entity}/${resolvedParams.repo}`;
                      const currentBranch = String(currentData?.defaultBranch || "main");
                      fileFetchAttemptedRef.current = `${currentRepoKey}:${currentBranch}`;
                      if (unsub) unsub();
                      return; // Success - exit early
                    } else {
                      console.warn("⚠️ [File Fetch] NIP-34: Multi-source fetch returned no files, trying git-nostr-bridge");
                      setFetchStatuses(statuses.map(s => ({
                        source: s.source.displayName,
                        status: s.status,
                        error: s.error,
                      })));
                    }
                  }
                  
                  // Fall back to git-nostr-bridge
                  console.log("⏭️ [File Fetch] Falling back to git-nostr-bridge (PRIMARY method for foreign repos)");
                  fetchFromGitNostrBridge();
                } else {
                  console.log("✅ [File Fetch] Files found in Nostr event, not using git-nostr-bridge fallback");
                }
                if (unsub) unsub();
              }, 500); // Reduced to 500ms to start fetching faster
            }
          );
          
          // Timeout after 3 seconds as a final fallback (reduced from 15s - should rarely trigger since we start fetching immediately)
          // CRITICAL: This should rarely trigger since we now start fetching immediately when clone URLs are found
          setTimeout(async () => {
            if (!foundFiles && unsub && !fileFetchInProgressRef.current) {
              console.log("⏱️ [File Fetch] Final timeout reached after 3s, trying multi-source fetch and git-nostr-bridge as last resort");
              unsub();
              
              // Try multi-source fetching first (NIP-34 clone URLs)
              const currentData = repoDataRef.current;
              const cloneUrls: string[] = [];
              
              // PRIORITY 1: Get clone URLs from event data (stored in closure)
              if (eventRepoData?.clone && Array.isArray(eventRepoData.clone) && eventRepoData.clone.length > 0) {
                console.log(`📋 [File Fetch] NIP-34: Found ${eventRepoData.clone.length} clone URLs in event:`, eventRepoData.clone);
                eventRepoData.clone.forEach((url: string) => {
                  // CRITICAL: Filter out localhost URLs - they're not real git servers
                  if (url && !url.includes('localhost') && !url.includes('127.0.0.1') && !cloneUrls.includes(url)) {
                    cloneUrls.push(url);
                  }
                });
              }
              
              // PRIORITY 2: Also check repoData
              if (currentData?.clone && Array.isArray(currentData.clone) && currentData.clone.length > 0) {
                console.log(`📋 [File Fetch] NIP-34: Found ${currentData.clone.length} clone URLs in repoData:`, currentData.clone);
                currentData.clone.forEach((url: string) => {
                  // CRITICAL: Filter out localhost URLs - they're not real git servers
                  if (url && !url.includes('localhost') && !url.includes('127.0.0.1') && !cloneUrls.includes(url)) {
                    cloneUrls.push(url);
                  }
                });
              }
              
              // PRIORITY 3: Also check localStorage
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
                  console.log(`📋 [File Fetch] NIP-34: Found ${matchingRepo.clone.length} clone URLs in localStorage:`, matchingRepo.clone);
                  matchingRepo.clone.forEach((url: string) => {
                    if (!cloneUrls.includes(url)) cloneUrls.push(url);
                  });
                }
              } catch (e) {
                console.error("❌ [File Fetch] Error reading clone URLs:", e);
              }
              
              console.log(`📋 [File Fetch] NIP-34: Total ${cloneUrls.length} unique clone URLs collected:`, cloneUrls);
              
              // CRITICAL: Expand Nostr git clone URLs to try all known git servers (same as initial fetch)
              const knownGitServers = [
                "relay.ngit.dev",
                "ngit-relay.nostrver.se",
                "gitnostr.com",
                "ngit.danconwaydev.com",
                "git.shakespeare.diy",
                "git-01.uid.ovh",
                "git-02.uid.ovh",
              ];
              
              const nostrGitUrls = cloneUrls.filter(url => {
                const match = url.match(/^https?:\/\/([^\/]+)\/(npub[a-z0-9]+)\/([^\/]+)\.git$/i);
                return match && match[1] && knownGitServers.some(server => match[1]?.includes(server));
              });
              
              if (nostrGitUrls.length > 0) {
                const firstMatch = nostrGitUrls[0]?.match(/^https?:\/\/([^\/]+)\/(npub[a-z0-9]+)\/([^\/]+)\.git$/i);
                if (firstMatch && firstMatch[2] && firstMatch[3]) {
                  const npub = firstMatch[2];
                  const repo = firstMatch[3];
                  console.log(`🔍 [File Fetch] Expanding clone URLs in timeout: Found ${nostrGitUrls.length} Nostr git URLs, expanding to try all known git servers`);
                  
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
                    console.log(`✅ [File Fetch] Added ${addedCount} expanded clone URLs for ${knownGitServers.length} git servers (timeout)`);
                  }
                }
              }
              
              // If we have clone URLs, try multi-source fetching
              if (cloneUrls.length > 0) {
                console.log(`🔍 [File Fetch] NIP-34: Found ${cloneUrls.length} clone URLs (including expanded) after timeout, attempting multi-source fetch`);
                const branch = String(currentData?.defaultBranch || "main");
                
                // Update fetch statuses - merge with existing to avoid duplicates
                // CRITICAL: Show status for ALL sources (including expanded ones)
                const initialStatuses = cloneUrls.map(url => {
                  const source = parseGitSource(url);
                  return {
                    source: source.displayName,
                    status: 'pending' as const,
                  };
                });
                setFetchStatuses(prev => {
                  const merged = [...prev];
                  initialStatuses.forEach((newStatus: { source: string; status: 'pending' | 'fetching' | 'success' | 'failed'; error?: string }) => {
                    const existingIndex = merged.findIndex(s => s.source === newStatus.source);
                    if (existingIndex >= 0) {
                      // Update existing status only if it's still pending or failed
                      const existing = merged[existingIndex];
                      if (existing && (existing.status === 'pending' || existing.status === 'failed')) {
                        merged[existingIndex] = newStatus;
                      }
                    } else {
                      merged.push(newStatus);
                    }
                  });
                  return merged;
                });
                
                // Fetch from all sources
                // Use resolvedOwnerPubkey or ownerPubkeyForLink as event publisher pubkey for bridge API
                const eventPublisherPubkey = resolvedOwnerPubkey && /^[0-9a-f]{64}$/i.test(resolvedOwnerPubkey) 
                  ? resolvedOwnerPubkey 
                  : (ownerPubkeyForLink && /^[0-9a-f]{64}$/i.test(ownerPubkeyForLink) ? ownerPubkeyForLink : undefined);
                const { files, statuses } = await fetchFilesFromMultipleSources(
                  cloneUrls,
                  branch,
                  (status: FetchStatus) => {
                    setFetchStatuses(prev => {
                      const updated = [...prev];
                      const index = updated.findIndex(s => s.source === status.source.displayName);
                      if (index >= 0) {
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
                    
                    // CRITICAL: Immediately update repoData when first success happens (don't wait for all sources)
                    if (status.status === "success" && status.files && Array.isArray(status.files) && status.files.length > 0) {
                      const currentFiles = repoDataRef.current?.files;
                      // Only update if we don't already have files (first success) or if this source has more files
                      if (!currentFiles || currentFiles.length === 0 || status.files.length > currentFiles.length) {
                        // CRITICAL: Extract sourceUrl from successful source for GitHub/GitLab/Codeberg
                        // This allows fetchGithubRaw to fetch individual file content
                        let sourceUrlToSet: string | undefined = undefined;
                        const sourceUrl = status.source.url;
                        if (sourceUrl && (
                          status.source.type === "github" || 
                          status.source.type === "gitlab" || 
                          status.source.type === "codeberg"
                        )) {
                          // For GitHub/GitLab/Codeberg, use the clone URL as sourceUrl
                          sourceUrlToSet = sourceUrl;
                          console.log(`🔗 [File Fetch] Setting sourceUrl from successful source: ${sourceUrlToSet}`);
                        }
                        
                        console.log(`🚀 [File Fetch] Immediately updating repoData with ${status.files.length} files from ${status.source.displayName}`);
                        setRepoData((prev: any) => {
                          const updated = prev ? ({ 
                            ...prev, 
                            files: status.files,
                            // Preserve existing sourceUrl if it exists, otherwise use the one from successful source
                            sourceUrl: prev.sourceUrl || sourceUrlToSet || prev.sourceUrl,
                          }) : { files: status.files, sourceUrl: sourceUrlToSet };
                          return updated;
                        });
                        // Also update repoDataRef immediately for file opening
                        if (repoDataRef.current) {
                          repoDataRef.current = { 
                            ...repoDataRef.current, 
                            files: status.files,
                            sourceUrl: repoDataRef.current.sourceUrl || sourceUrlToSet || repoDataRef.current.sourceUrl,
                          };
                        }
                      }
                    }
                  },
                  eventPublisherPubkey
                );
                
                if (files && files.length > 0) {
                  console.log(`✅ [File Fetch] NIP-34: Successfully fetched ${files.length} files from clone URLs`);
                  
                  // CRITICAL: Extract sourceUrl from successful status for GitHub/GitLab/Codeberg
                  // This ensures fetchGithubRaw can fetch individual file content
                  let sourceUrlFromStatus: string | undefined = undefined;
                  const successfulStatus = statuses.find(s => s.status === "success" && s.files && s.files.length > 0);
                  if (successfulStatus && successfulStatus.source.url && (
                    successfulStatus.source.type === "github" || 
                    successfulStatus.source.type === "gitlab" || 
                    successfulStatus.source.type === "codeberg"
                  )) {
                    sourceUrlFromStatus = successfulStatus.source.url;
                    console.log(`🔗 [File Fetch] Extracted sourceUrl from successful status: ${sourceUrlFromStatus}`);
                  }
                  
                  setRepoData((prev: any) => {
                    const updated = prev ? ({ 
                      ...prev, 
                      files,
                      // Preserve existing sourceUrl if it exists, otherwise use the one from successful status
                      sourceUrl: prev.sourceUrl || sourceUrlFromStatus || prev.sourceUrl,
                    }) : { files, sourceUrl: sourceUrlFromStatus };
                    return updated;
                  });
                  
                  // Also update repoDataRef
                  if (repoDataRef.current) {
                    repoDataRef.current = { 
                      ...repoDataRef.current, 
                      files,
                      sourceUrl: repoDataRef.current.sourceUrl || sourceUrlFromStatus || repoDataRef.current.sourceUrl,
                    };
                  }
                  
                  // Update localStorage
                  try {
                    const repos = loadStoredRepos();
                    const updated = repos.map((r) => {
                      const matchesOwner = r.ownerPubkey && ownerPubkey && 
                        (r.ownerPubkey === ownerPubkey || r.ownerPubkey.toLowerCase() === ownerPubkey.toLowerCase());
                      const matchesRepo = r.repo === resolvedParams.repo || r.slug === resolvedParams.repo || r.name === resolvedParams.repo;
                      const matchesEntity = r.entity === resolvedParams.entity || 
                        (r.entity && resolvedParams.entity && r.entity.toLowerCase() === resolvedParams.entity.toLowerCase());
                      
                      if ((matchesOwner || matchesEntity) && matchesRepo) {
                        return { 
                          ...r, 
                          files,
                          // Also update sourceUrl in localStorage if we extracted it
                          sourceUrl: r.sourceUrl || sourceUrlFromStatus || r.sourceUrl,
                        };
                      }
                      return r;
                    });
                    localStorage.setItem("gittr_repos", JSON.stringify(updated));
                  } catch (e) {
                    console.error("❌ [File Fetch] Failed to update localStorage:", e);
                  }
                  
                  setFetchStatuses(statuses.map(s => ({
                    source: s.source.displayName,
                    status: s.status,
                    error: s.error,
                  })));
                  
                  fileFetchInProgressRef.current = false;
                  return; // Success - exit early
                } else {
                  console.warn("⚠️ [File Fetch] NIP-34: Multi-source fetch returned no files, trying git-nostr-bridge");
                  setFetchStatuses(statuses.map(s => ({
                    source: s.source.displayName,
                    status: s.status,
                    error: s.error,
                  })));
                }
              }
              
              // Fallback to git-nostr-bridge
              fetchFromGitNostrBridge();
            }
          }, 3000); // Reduced to 3s as final fallback (should rarely trigger since we start fetching immediately)
          
          // Fallback function to fetch from git-nostr-bridge
          // CRITICAL: This is the PRIMARY method for foreign repos - many repos don't store files in Nostr events
          // Instead, they rely on git-nostr-bridge to clone repos when it sees repository events
          async function fetchFromGitNostrBridge() {
            try {
              const currentData = repoDataRef.current;
              // CRITICAL: Use defaultBranch from repo data if available, otherwise try to get it from sourceUrl
              let branch = currentData?.defaultBranch;
              
              // If no defaultBranch in repo data and we have a sourceUrl, try to get it from the git server
              if (!branch && currentData?.sourceUrl) {
                const githubMatch = currentData.sourceUrl.match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?$/);
                if (githubMatch) {
                  const [, owner, repoName] = githubMatch;
                  try {
                    const repoInfoEndpoint = `/repos/${owner}/${repoName}`;
                    const repoInfoProxyUrl = `/api/github/proxy?endpoint=${encodeURIComponent(repoInfoEndpoint)}`;
                    const repoInfoResponse = await fetch(repoInfoProxyUrl);
                    if (repoInfoResponse.ok) {
                      const repoInfoText = await repoInfoResponse.text();
                      const repoInfo: any = JSON.parse(repoInfoText);
                      if (repoInfo.default_branch) {
                        branch = repoInfo.default_branch;
                        console.log(`✅ [File Fetch] Got default branch from GitHub repo info: ${branch}`);
                      }
                    }
                  } catch (e) {
                    console.warn(`⚠️ [File Fetch] Failed to get default branch from GitHub:`, e);
                  }
                }
              }
              
              // Fallback to main if still no branch
              branch = branch || "main";
              // CRITICAL: Use repo name from repoData (from Nostr event) if available, otherwise fall back to decodedRepo from URL
              // This ensures we use the exact repo name as stored in git-nostr-bridge (from the Nostr event)
              // The URL might have URL-encoded spaces or different normalization
              const actualRepoName = currentData?.name || currentData?.repo || currentData?.slug || String(decodedRepo || "");
              const url = `/api/nostr/repo/files?ownerPubkey=${encodeURIComponent(ownerPubkey)}&repo=${encodeURIComponent(actualRepoName)}&branch=${encodeURIComponent(branch)}`;
              
              console.log("📁 [File Fetch] Fetching files from git-nostr-bridge (foreign repo):", { 
                ownerPubkey: ownerPubkey.slice(0, 8), 
                actualRepoName,
                decodedRepoFromUrl: decodedRepo,
                branch, 
                url,
                note: "This is the PRIMARY method for foreign repos - files are served from cloned git repos, not from Nostr events"
              });
              
              const response = await fetch(url);
              
              // Log response details before parsing (simplified to avoid Object logging)
              console.log("📁 [File Fetch] git-nostr-bridge response:", `status=${response.status}, ok=${response.ok}`);
              
              const data = await response.json();
              
              if (response.ok) {
                const fileCount = data.files?.length || 0;
                const hasFiles = !!(data.files && Array.isArray(data.files) && data.files.length > 0);
                console.log(`✅ [File Fetch] API response: fileCount=${fileCount}, hasFiles=${hasFiles}, message=${data.message || 'none'}`);
                
                if (data.files && Array.isArray(data.files) && data.files.length > 0) {
                  console.log("✅ [File Fetch] Setting files in repoData:", data.files.length, "files");
                  // CRITICAL: Update defaultBranch if API returned a different branch (e.g., master instead of main)
                  const actualBranch = data.branch || selectedBranch || repoData?.defaultBranch || "main";
                  setRepoData((prev: any) => {
                    if (!prev) return prev;
                    const updated = { ...prev, files: data.files };
                    // Update defaultBranch if API returned a different branch
                    if (data.branch && data.branch !== prev.defaultBranch) {
                      console.log(`🔄 [File Fetch] Updating defaultBranch from '${prev.defaultBranch || 'none'}' to '${data.branch}' (from API response)`);
                      updated.defaultBranch = data.branch;
                      // Also update selectedBranch to match
                      setSelectedBranch(data.branch);
                    }
                    return updated;
                  });
                  
                  // CRITICAL: Store files separately to avoid localStorage quota issues
                  try {
                    saveRepoFiles(resolvedParams.entity, resolvedParams.repo, data.files as RepoFileEntry[]);
                    console.log(`✅ [File Fetch] Saved ${data.files.length} files to separate storage key`);
                  } catch (e: any) {
                    if (e.name === 'QuotaExceededError' || e.message?.includes('quota')) {
                      console.error(`❌ [File Fetch] Quota exceeded when saving files separately`);
                    } else {
                      console.error(`❌ [File Fetch] Failed to save files separately:`, e);
                    }
                  }
                  
                  // Update localStorage - use case-insensitive matching for ownerPubkey
                  // Only store fileCount, not full array
                  try {
                    const repos = loadStoredRepos();
                    const updated = repos.map((r) => {
                      const matchesOwner = r.ownerPubkey && ownerPubkey && 
                        (r.ownerPubkey === ownerPubkey || r.ownerPubkey.toLowerCase() === ownerPubkey.toLowerCase());
                      const matchesRepo = r.repo === resolvedParams.repo || r.slug === resolvedParams.repo || r.name === resolvedParams.repo;
                      const matchesEntity = r.entity === resolvedParams.entity || 
                        (r.entity && resolvedParams.entity && r.entity.toLowerCase() === resolvedParams.entity.toLowerCase());
                      
                      if ((matchesOwner || matchesEntity) && matchesRepo) {
                        console.log("💾 [File Fetch] Updating repo in localStorage:", { 
                          entity: r.entity, 
                          repo: r.repo || r.slug,
                          ownerPubkey: r.ownerPubkey?.slice(0, 8),
                          fileCount: data.files.length 
                        });
                        // Store only fileCount, not full array
                        return { ...r, fileCount: data.files.length };
                      }
                      return r;
                    });
                    localStorage.setItem("gittr_repos", JSON.stringify(updated));
                    console.log("💾 [File Fetch] Updated localStorage with files");
                  } catch (e) {
                    console.error("❌ [File Fetch] Failed to update localStorage:", e);
                  }
                } else {
                  console.warn("⚠️ [File Fetch] API returned empty files array or no files:", data);
                  // If git-nostr-bridge says repo doesn't exist, it might need to be cloned first
                  // For foreign repos, git-nostr-bridge clones them when it sees the repo event
                  // So we should check if the repo event exists and trigger a clone
                  if (response.status === 404 || response.status === 500) {
                    const errorType = response.status === 404 ? "not found" : "empty or corrupted";
                    console.log(`ℹ️ [File Fetch] Repository ${errorType} in git-nostr-bridge (${response.status}). It may need to be cloned first.`);
                    console.log("ℹ️ [File Fetch] git-nostr-bridge clones repos automatically when it sees repository events on Nostr.");
                    console.log("ℹ️ [File Fetch] If this is a foreign repo, ensure the repository event has been published to Nostr.");
                  }
                }
              } else {
                console.error("❌ [File Fetch] API error:", response.status, data);
                // If 404 or 500, the repo hasn't been cloned by git-nostr-bridge yet OR is empty/corrupted
                // Per NIP-34 architecture: Files are stored on git servers, not in Nostr events
                // Nostr events only contain references. For foreign repos, we need to fetch from the sourceUrl (git server)
                if (response.status === 404 || response.status === 500) {
                  console.log("ℹ️ [File Fetch] Repository not found in git-nostr-bridge.");
                  console.log("ℹ️ [File Fetch] Per NIP-34: Files are stored on git servers, not in Nostr events.");
                  console.log("ℹ️ [File Fetch] Fetching from sourceUrl (git server) if available...");
                  
                  // Fetch from sourceUrl (this is the INTENDED architecture, not a workaround)
                  // The sourceUrl points to a git server (e.g., GitHub) which stores the actual files
                  // Try multiple sources: closure variable (from event), repoDataRef, localStorage, or repoData state
                  const currentData = repoDataRef.current;
                  
                  // Also check localStorage for the repo data - it might have sourceUrl from a previous load
                  // Check BOTH the per-repo storage AND the main repos array
                  let sourceUrlFromStorage: string | undefined;
                  try {
                    // Method 1: Per-repo storage
                    const storageKey = `gittr_repo_${ownerPubkey}_${resolvedParams.repo}`;
                    const stored = localStorage.getItem(storageKey);
                    if (stored) {
                      const parsed = JSON.parse(stored);
                      sourceUrlFromStorage = parsed.sourceUrl || parsed.forkedFrom;
                    }
                    
                    // Method 2: Main repos array (where repos are stored)
                    if (!sourceUrlFromStorage) {
                      const repos = loadStoredRepos();
                      // CRITICAL: Use findRepoByEntityAndName for consistent matching (handles npub, case-insensitive, etc.)
                      const matchingRepo = findRepoByEntityAndName(repos, resolvedParams.entity, resolvedParams.repo);
                      if (matchingRepo) {
                        sourceUrlFromStorage = matchingRepo.sourceUrl || matchingRepo.forkedFrom;
                      }
                    }
                  } catch (e) {
                    console.error("❌ [File Fetch] Error reading localStorage:", e);
                  }
                  
                  // CRITICAL: Also check for clone URLs if sourceUrl is still missing
                  // Clone URLs are used as sourceUrl for foreign repos (GitLab, GitHub, etc.)
                  if (!sourceUrlFromStorage && !sourceUrlFromEvent) {
                    try {
                      const repos = loadStoredRepos();
                      // CRITICAL: Use findRepoByEntityAndName for consistent matching (handles npub, case-insensitive, etc.)
                      const matchingRepo = findRepoByEntityAndName(repos, resolvedParams.entity, resolvedParams.repo);
                      if (matchingRepo?.clone && Array.isArray(matchingRepo.clone) && matchingRepo.clone.length > 0) {
                        sourceUrlFromStorage = matchingRepo.clone[0];
                        console.log("✅ [File Fetch] Using clone URL as sourceUrl (before final check):", sourceUrlFromStorage);
                      }
                    } catch (e) {
                      console.error("❌ [File Fetch] Error checking for clone URLs:", e);
                    }
                  }
                  
                  // CRITICAL: Check ALL possible sources for sourceUrl
                  // Priority: 1) Event, 2) localStorage (per-repo), 3) localStorage (main array), 4) repoDataRef
                  // Use let so we can update it after the fallback clone URL check
                  let sourceUrl = sourceUrlFromEvent || sourceUrlFromStorage || currentData?.sourceUrl || currentData?.forkedFrom;
                  
                  // DEBUG: Log what we found with FULL details
                  console.log("🔍 [File Fetch] sourceUrl search results:", {
                    sourceUrlFromEvent,
                    sourceUrlFromStorage,
                    currentDataSourceUrl: currentData?.sourceUrl,
                    currentDataForkedFrom: currentData?.forkedFrom,
                    currentDataKeys: currentData ? Object.keys(currentData) : null,
                    currentDataFull: currentData ? JSON.stringify(currentData, null, 2).substring(0, 2000) : null,
                    finalSourceUrl: sourceUrl,
                    ownerPubkey: ownerPubkey.slice(0, 8),
                    repoName: resolvedParams.repo,
                    entity: resolvedParams.entity,
                  });
                  
                  // CRITICAL: Also check localStorage directly with console.log to see what's actually there
                  try {
                    const repos = loadStoredRepos();
                    console.log("🔍 [File Fetch] ALL repos in localStorage:", repos.length);
                    // CRITICAL: Use findRepoByEntityAndName for consistent matching (handles npub, case-insensitive, etc.)
                    const matchingRepo = findRepoByEntityAndName(repos, resolvedParams.entity, resolvedParams.repo);
                    if (matchingRepo) {
                      console.log("🔍 [File Fetch] Matching repo found:", {
                        repo: matchingRepo.repo || matchingRepo.slug || matchingRepo.name,
                        entity: matchingRepo.entity,
                        sourceUrl: matchingRepo.sourceUrl,
                        forkedFrom: matchingRepo.forkedFrom,
                        cloneUrls: matchingRepo.clone || [],
                        cloneUrlsCount: matchingRepo.clone?.length || 0,
                        hasGithubClone: matchingRepo.clone?.some((url: string) => url.includes('github.com')) || false,
                        hasGitlabClone: matchingRepo.clone?.some((url: string) => url.includes('gitlab.com')) || false,
                        hasCodebergClone: matchingRepo.clone?.some((url: string) => url.includes('codeberg.org')) || false,
                      });
                      // CRITICAL: Use clone URL as sourceUrl if sourceUrl is missing!
                      // For foreign repos, clone URLs point to the git server (GitLab, GitHub, etc.)
                      // This is a fallback check - we should have already checked this above, but do it here too for safety
                      // CRITICAL: Only use GitHub/GitLab/Codeberg URLs as sourceUrl - Nostr git servers are handled by multi-source fetcher
                      if (!sourceUrl && matchingRepo.clone && Array.isArray(matchingRepo.clone) && matchingRepo.clone.length > 0) {
                        // Only use GitHub/GitLab/Codeberg clone URLs
                        const cloneUrl = matchingRepo.clone.find((url: string) => 
                          url.includes('github.com') || url.includes('gitlab.com') || url.includes('codeberg.org')
                        );
                        if (cloneUrl) {
                          // Remove .git suffix and use as sourceUrl
                          const sourceUrlFromClone = cloneUrl.replace(/\.git$/, '');
                          console.log("✅ [File Fetch] Using clone URL as sourceUrl (fallback check):", sourceUrlFromClone, {
                            isGitHub: cloneUrl.includes('github.com'),
                            isGitLab: cloneUrl.includes('gitlab.com'),
                            isCodeberg: cloneUrl.includes('codeberg.org'),
                          });
                          sourceUrlFromStorage = sourceUrlFromClone;
                          // Recalculate sourceUrl now that we have the clone URL
                          sourceUrl = sourceUrlFromEvent || sourceUrlFromStorage || currentData?.sourceUrl || currentData?.forkedFrom;
                          console.log("✅ [File Fetch] Recalculated sourceUrl after clone URL check:", sourceUrl);
                        }
                      }
                    }
                  } catch (e) {
                    console.error("❌ [File Fetch] Error checking localStorage:", e);
                  }
                  
                  // CRITICAL: Final recalculation of sourceUrl after all checks
                  sourceUrl = sourceUrlFromEvent || sourceUrlFromStorage || currentData?.sourceUrl || currentData?.forkedFrom;
                  
                  // NIP-34: Try fetching from all clone URLs (multi-source fetching)
                  // Get clone URLs from event, localStorage, or repoData
                  const cloneUrls: string[] = [];
                  
                  // PRIORITY 1: Clone URLs from event (most reliable, from NIP-34)
                  if (eventRepoData?.clone && Array.isArray(eventRepoData.clone) && eventRepoData.clone.length > 0) {
                    console.log(`📋 [File Fetch] NIP-34: Found ${eventRepoData.clone.length} clone URLs in event`);
                    eventRepoData.clone.forEach((url: string) => {
                      // CRITICAL: Filter out localhost URLs - they're not real git servers
                      if (url && !url.includes('localhost') && !url.includes('127.0.0.1') && !cloneUrls.includes(url)) {
                        cloneUrls.push(url);
                      }
                    });
                  }
                  
                  // PRIORITY 2: Clone URLs from repoData
                  if (currentData?.clone && Array.isArray(currentData.clone) && currentData.clone.length > 0) {
                    console.log(`📋 [File Fetch] NIP-34: Found ${currentData.clone.length} clone URLs in repoData`);
                    currentData.clone.forEach((url: string) => {
                      // CRITICAL: Filter out localhost URLs - they're not real git servers
                      if (url && !url.includes('localhost') && !url.includes('127.0.0.1') && !cloneUrls.includes(url)) {
                        cloneUrls.push(url);
                      }
                    });
                  }
                  
                  // PRIORITY 3: Clone URLs from localStorage
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
                    console.error("❌ [File Fetch] Error reading clone URLs from localStorage:", e);
                  }
                  
                  console.log(`📋 [File Fetch] NIP-34: Total ${cloneUrls.length} unique clone URLs collected`);
                  
                  // If we have clone URLs, try multi-source fetching (NIP-34)
                  if (cloneUrls.length > 0) {
                    console.log(`🔍 [File Fetch] NIP-34: Found ${cloneUrls.length} clone URLs, attempting multi-source fetch`);
                    const branch = String(currentData?.defaultBranch || "main");
                    
                    // Update fetch statuses - merge with existing to avoid duplicates
                    const initialStatuses = cloneUrls.map(url => {
                      const source = parseGitSource(url);
                      return {
                        source: source.displayName,
                        status: 'pending' as const,
                      };
                    });
                    setFetchStatuses(prev => {
                      const merged = [...prev];
                      initialStatuses.forEach((newStatus: { source: string; status: 'pending' | 'fetching' | 'success' | 'failed'; error?: string }) => {
                        const existingIndex = merged.findIndex(s => s.source === newStatus.source);
                        if (existingIndex >= 0) {
                          // Update existing status only if it's still pending or failed
                          if (merged[existingIndex] && (merged[existingIndex].status === 'pending' || merged[existingIndex].status === 'failed')) {
                            merged[existingIndex] = newStatus;
                          }
                        } else {
                          merged.push(newStatus);
                        }
                      });
                      return merged;
                    });
                    
                    // Fetch from all sources
                    // Use resolvedOwnerPubkey or ownerPubkeyForLink as event publisher pubkey for bridge API
                    const eventPublisherPubkey = resolvedOwnerPubkey && /^[0-9a-f]{64}$/i.test(resolvedOwnerPubkey) 
                      ? resolvedOwnerPubkey 
                      : (ownerPubkeyForLink && /^[0-9a-f]{64}$/i.test(ownerPubkeyForLink) ? ownerPubkeyForLink : undefined);
                    const { files, statuses } = await fetchFilesFromMultipleSources(
                      cloneUrls,
                      branch,
                      (status: FetchStatus) => {
                        // Update status in real-time
                        // CRITICAL: Preserve successful statuses - don't overwrite success with failed
                        setFetchStatuses(prev => {
                          const updated = [...prev];
                          const index = updated.findIndex(s => s.source === status.source.displayName);
                          if (index >= 0) {
                            const existingStatus = updated[index];
                            if (existingStatus) {
                              // CRITICAL: Don't overwrite success status with failed status
                              // If existing status is success, keep it. Only update if it's pending/failed or if new status is success.
                              if (existingStatus.status === 'success' && status.status !== 'success') {
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
                          } else {
                            updated.push({
                              source: status.source.displayName,
                              status: status.status,
                              error: status.error,
                            });
                          }
                          return updated;
                        });
                      },
                      eventPublisherPubkey
                    );
                    
                    if (files && files.length > 0) {
                      console.log(`✅ [File Fetch] NIP-34: Successfully fetched ${files.length} files from clone URLs`);
                      setRepoData((prev: any) => prev ? ({ ...prev, files }) : prev);
                      
                      // Update localStorage
                      try {
                        const repos = loadStoredRepos();
                        const updated = repos.map((r) => {
                          const matchesOwner = r.ownerPubkey && ownerPubkey && 
                            (r.ownerPubkey === ownerPubkey || r.ownerPubkey.toLowerCase() === ownerPubkey.toLowerCase());
                          const matchesRepo = r.repo === resolvedParams.repo || r.slug === resolvedParams.repo || r.name === resolvedParams.repo;
                          const matchesEntity = r.entity === resolvedParams.entity || 
                            (r.entity && resolvedParams.entity && r.entity.toLowerCase() === resolvedParams.entity.toLowerCase());
                          
                          if ((matchesOwner || matchesEntity) && matchesRepo) {
                            return { ...r, files };
                          }
                          return r;
                        });
                        localStorage.setItem("gittr_repos", JSON.stringify(updated));
                      } catch (e) {
                        console.error("❌ [File Fetch] Failed to update localStorage:", e);
                      }
                      
                      // Update final statuses - CRITICAL: Preserve successful statuses, don't overwrite them
                      setFetchStatuses(prev => {
                        const updated = [...prev];
                        statuses.forEach(s => {
                          const index = updated.findIndex(existing => existing.source === s.source.displayName);
                          if (index >= 0 && updated[index]) {
                            // CRITICAL: Don't overwrite success status with failed status
                            // If existing status is success, keep it. Only update if it's pending/failed.
                            if (updated[index].status === 'success' && s.status !== 'success') {
                              // Keep the success status
                              return;
                            }
                            updated[index] = {
                              source: s.source.displayName,
                              status: s.status,
                              error: s.error,
                            };
                          } else {
                            updated.push({
                              source: s.source.displayName,
                              status: s.status,
                              error: s.error,
                            });
                          }
                        });
                        return updated;
                      });
                      
                      return; // Success - exit early
                    } else {
                      console.warn("⚠️ [File Fetch] NIP-34: Multi-source fetch returned no files");
                      // Update final statuses - CRITICAL: Preserve successful statuses
                      setFetchStatuses(prev => {
                        const updated = [...prev];
                        statuses.forEach(s => {
                          const index = updated.findIndex(existing => existing.source === s.source.displayName);
                          if (index >= 0 && updated[index]) {
                            // CRITICAL: Don't overwrite success status with failed status
                            if (updated[index].status === 'success' && s.status !== 'success') {
                              return; // Keep the success status
                            }
                            updated[index] = {
                              source: s.source.displayName,
                              status: s.status,
                              error: s.error,
                            };
                          } else {
                            updated.push({
                              source: s.source.displayName,
                              status: s.status,
                              error: s.error,
                            });
                          }
                        });
                        return updated;
                      });
                    }
                  }
                  
                  // CRITICAL: If still no sourceUrl, try one more time by reading directly from localStorage
                  // using the exact same logic as the UI uses to display it
                  if (!sourceUrl) {
                    try {
                      const repos = loadStoredRepos();
                      const matchingRepo = repos.find((r) => {
                        // Match by entity (npub format) and repo name
                        const entityMatch = r.entity === resolvedParams.entity || 
                          (r.entity && resolvedParams.entity && r.entity.toLowerCase() === resolvedParams.entity.toLowerCase());
                        const repoMatch = r.repo === resolvedParams.repo || r.slug === resolvedParams.repo || r.name === resolvedParams.repo;
                        // Also match by ownerPubkey if available
                        const ownerMatch = r.ownerPubkey && ownerPubkey && 
                          (r.ownerPubkey === ownerPubkey || r.ownerPubkey.toLowerCase() === ownerPubkey.toLowerCase());
                        return (entityMatch || ownerMatch) && repoMatch;
                      });
                      if (matchingRepo?.sourceUrl) {
                        console.log("✅ [File Fetch] Found sourceUrl in localStorage repos array:", matchingRepo.sourceUrl);
                        // Use this sourceUrl for fetching
                        const finalSourceUrl = matchingRepo.sourceUrl || matchingRepo.forkedFrom;
                        if (finalSourceUrl) {
                          // Recursively call the GitHub fetch logic with this sourceUrl
                          const githubMatch = finalSourceUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
                          if (githubMatch) {
                            const [, owner, repoName] = githubMatch;
                            
                            // CRITICAL: First get the default branch from repo info (same as git-source-fetcher.ts)
                            let defaultBranch: string | null = null;
                            try {
                              const repoInfoEndpoint = `/repos/${owner}/${repoName}`;
                              const repoInfoProxyUrl = `/api/github/proxy?endpoint=${encodeURIComponent(repoInfoEndpoint)}`;
                              const repoInfoResponse = await fetch(repoInfoProxyUrl);
                              if (repoInfoResponse.ok) {
                                const repoInfoText = await repoInfoResponse.text();
                                const repoInfo: any = JSON.parse(repoInfoText);
                                if (repoInfo.default_branch) {
                                  defaultBranch = repoInfo.default_branch;
                                  console.log(`✅ [File Fetch] Got default branch from repo: ${defaultBranch}`);
                                }
                              }
                            } catch (repoInfoError) {
                              console.warn(`⚠️ [File Fetch] Failed to get repo info, will try fallback:`, repoInfoError);
                            }
                            
                            // Prioritize: defaultBranch from API > matchingRepo.defaultBranch > currentData.defaultBranch > "main"
                            const branch = defaultBranch || String(matchingRepo?.defaultBranch || currentData?.defaultBranch || "main");
                            
                            console.log("📁 [File Fetch] Fetching files from git server (sourceUrl from localStorage):", { owner, repoName, branch, url: finalSourceUrl });
                            
                            // Show loading indicator
                            setFetchingFilesFromGit({ source: 'github', message: `Fetching files from GitHub...` });
                            
                            // Fetch from GitHub (same logic as below, but extracted)
                            try {
                              // Try branches in order: branch (from API/default), main, master
                              const branchesToTry = [branch, "main", "master"].filter((b, i, arr) => arr.indexOf(b) === i);
                              let sha: string | null = null;
                              let successfulBranch: string | null = null;
                              
                              for (const branchToTry of branchesToTry) {
                                const branchUrl = `https://api.github.com/repos/${owner}/${repoName}/git/refs/heads/${encodeURIComponent(branchToTry)}`;
                                const branchResponse = await fetch(branchUrl, { headers: { "User-Agent": "gittr-space" } as any });
                                
                                if (branchResponse.ok) {
                                  const branchData: any = await branchResponse.json();
                                  if (branchData.object && branchData.object.sha) {
                                    const branchSha = branchData.object.sha;
                                    sha = branchSha;
                                    successfulBranch = branchToTry;
                                    console.log(`✅ [File Fetch] Got branch SHA for ${branchToTry}: ${branchSha.slice(0, 8)}...`);
                                    break;
                                  }
                                } else {
                                  console.warn(`⚠️ [File Fetch] Branch ${branchToTry} not found (${branchResponse.status}), trying next...`);
                                }
                              }
                              
                              if (!sha || !successfulBranch) {
                                console.error(`❌ [File Fetch] Failed to get branch SHA for any branch. Tried: ${branchesToTry.join(", ")}`);
                                setFetchingFilesFromGit({ source: null, message: '' });
                                return;
                              }
                              
                              // sha and successfulBranch are guaranteed to be non-null here
                              const finalSha = sha;
                              const finalBranch = successfulBranch;
                              
                              const treeUrl = `https://api.github.com/repos/${owner}/${repoName}/git/trees/${finalSha}?recursive=1`;
                              const treeResponse = await fetch(treeUrl, { headers: { "User-Agent": "gittr-space", Accept: "application/vnd.github.v3+json" } });
                              
                              // Update branch in repoData if we used a different branch
                              if (finalBranch && finalBranch !== branch) {
                                console.log(`📝 [File Fetch] Updating branch from ${branch} to ${finalBranch}`);
                              }
                              
                              if (treeResponse.ok) {
                                const treeData: any = await treeResponse.json();
                                if (treeData.tree && Array.isArray(treeData.tree)) {
                                  const files = treeData.tree
                                    .filter((n: any) => n.type === "blob")
                                    .map((n: any) => ({ type: "file", path: n.path, size: n.size }));
                                  const dirs = treeData.tree
                                    .filter((n: any) => n.type === "tree")
                                    .map((n: any) => ({ type: "dir", path: n.path }));
                                  
                                  const allDirs = new Set<string>(dirs.map((d: { path: string }) => d.path));
                                  for (const file of files) {
                                    const parts = file.path.split("/");
                                    for (let i = 1; i < parts.length; i++) {
                                      allDirs.add(parts.slice(0, i).join("/"));
                                    }
                                  }
                                  
                                  const allFiles = [
                                    ...Array.from(allDirs).sort().map((path: string) => ({ type: "dir", path })),
                                    ...files.sort((a: { type: string; path: string; size?: number }, b: { type: string; path: string; size?: number }) => a.path.localeCompare(b.path))
                                  ];
                                  
                                  console.log("✅ [File Fetch] Fetched", allFiles.length, "items from git server");
                                  
                                  // Hide loading indicator
                                  setFetchingFilesFromGit({ source: null, message: '' });
                                  
                                  // Auto-load README if it exists
                                  const readmeFile = files.find((f: any) => {
                                    const lowerPath = f.path.toLowerCase();
                                    return lowerPath === "readme.md" || lowerPath === "readme" || lowerPath.endsWith("/readme.md");
                                  });
                                  
                                  let readmeContent = "";
                                  if (readmeFile) {
                                    try {
                                      console.log("📖 [File Fetch] Auto-loading README:", readmeFile.path);
                                      
                                      // Try to get sourceUrl from various sources
                                      // Note: cloneUrls is not in scope here, so we only use sourceUrl and repoData
                                      const effectiveSourceUrl = sourceUrl || (repoData ? repoData.sourceUrl : undefined) || null;
                                      
                                      if (effectiveSourceUrl) {
                                        // Use the same API endpoint that fetchGithubRaw uses
                                        // Use finalBranch (the branch we actually fetched from) instead of the original branch
                                        const readmeApiUrl = `/api/git/file-content?sourceUrl=${encodeURIComponent(effectiveSourceUrl)}&path=${encodeURIComponent(readmeFile.path)}&branch=${encodeURIComponent(finalBranch || branch)}`;
                                        const readmeResponse = await fetch(readmeApiUrl);
                                        if (readmeResponse.ok) {
                                          const readmeData = await readmeResponse.json();
                                          readmeContent = readmeData.content || "";
                                          console.log("✅ [File Fetch] README loaded successfully");
                                        } else {
                                          console.warn("⚠️ [File Fetch] Failed to load README via API, trying direct fetch:", readmeResponse.status);
                                          // Fallback: Try direct GitHub raw URL if it's a GitHub repo
                                          if (effectiveSourceUrl.includes('github.com')) {
                                            try {
                                              const urlParts = effectiveSourceUrl.replace(/^https?:\/\//, '').split('/');
                                              const owner = urlParts[1];
                                              const repoName = urlParts[2]?.replace(/\.git$/, '') || resolvedParams.repo;
                                              // Use finalBranch (the branch we actually fetched from) instead of the original branch
                                              const rawUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/${encodeURIComponent(finalBranch || branch)}/${readmeFile.path}`;
                                              const rawResponse = await fetch(rawUrl);
                                              if (rawResponse.ok) {
                                                readmeContent = await rawResponse.text();
                                                console.log("✅ [File Fetch] README loaded via direct GitHub raw URL");
                                              }
                                            } catch (e) {
                                              console.error("❌ [File Fetch] Error loading README via direct URL:", e);
                                            }
                                          }
                                        }
                                      } else {
                                        console.warn("⚠️ [File Fetch] No sourceUrl available for README auto-loading");
                                      }
                                    } catch (e) {
                                      console.error("❌ [File Fetch] Error loading README:", e);
                                    }
                                  }
                                  
                                  setRepoData((prev: any) => prev ? ({ ...prev, files: allFiles, readme: readmeContent || prev.readme, sourceUrl: sourceUrl || prev.sourceUrl }) : prev);
                                  
                                  // Update localStorage
                                  try {
                                    const repos = loadStoredRepos();
                                    const updated = repos.map((r) => {
                                      const matchesOwner = r.ownerPubkey && ownerPubkey && 
                                        (r.ownerPubkey === ownerPubkey || r.ownerPubkey.toLowerCase() === ownerPubkey.toLowerCase());
                                      const matchesRepo = r.repo === resolvedParams.repo || r.slug === resolvedParams.repo || r.name === resolvedParams.repo;
                                      const matchesEntity = r.entity === resolvedParams.entity || 
                                        (r.entity && resolvedParams.entity && r.entity.toLowerCase() === resolvedParams.entity.toLowerCase());
                                      
                                      if ((matchesOwner || matchesEntity) && matchesRepo) {
                                        return { ...r, files: allFiles, readme: readmeContent || r.readme };
                                      }
                                      return r;
                                    });
                                    localStorage.setItem("gittr_repos", JSON.stringify(updated));
                                    console.log("💾 [File Fetch] Updated localStorage with files from git server");
                                  } catch (e) {
                                    console.error("❌ [File Fetch] Failed to update localStorage:", e);
                                  }
                                  
                                  return; // Success - exit early
                                }
                              }
                            } catch (error: any) {
                              console.error("❌ [File Fetch] Error fetching from git server:", error.message);
                              setFetchingFilesFromGit({ source: null, message: '' });
                            }
                          }
                        }
                      }
                    } catch (e) {
                      console.error("❌ [File Fetch] Error in final localStorage check:", e);
                      setFetchingFilesFromGit({ source: null, message: '' });
                    }
                  }
                  
                  console.log("🔍 [File Fetch] Checking for sourceUrl:", {
                    fromEvent: !!sourceUrlFromEvent,
                    fromStorage: !!sourceUrlFromStorage,
                    fromRepoDataRef: !!currentData?.sourceUrl,
                    fromForkedFrom: !!currentData?.forkedFrom,
                    finalSourceUrl: sourceUrl,
                    allSources: {
                      event: sourceUrlFromEvent,
                      storage: sourceUrlFromStorage,
                      ref: currentData?.sourceUrl,
                      forked: currentData?.forkedFrom,
                    },
                  });
                  
                  if (sourceUrl) {
                    // Support multiple git servers: GitHub, GitLab, etc.
                    const githubMatch = sourceUrl.match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?$/);
                    const gitlabMatch = sourceUrl.match(/gitlab\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?$/);
                    
                    if (githubMatch) {
                      const [, owner, repoName] = githubMatch;
                      
                      console.log("📁 [File Fetch] Fetching files from GitHub (sourceUrl):", { owner, repoName, url: sourceUrl });
                      console.log("📁 [File Fetch] This is the INTENDED architecture - git servers store files, Nostr events reference them");
                      
                      // Show loading indicator
                      setFetchingFilesFromGit({ source: 'github', message: `Fetching files from GitHub...` });
                      
                      try {
                        // CRITICAL: First get the default branch from repo info
                        // This ensures we use the correct branch (not always "main" - could be "master" or something else)
                        let defaultBranch: string | null = null;
                        try {
                          // Use proxy endpoint to leverage platform OAuth token if available
                          const repoInfoEndpoint = `/repos/${owner}/${repoName}`;
                          const repoInfoProxyUrl = `/api/github/proxy?endpoint=${encodeURIComponent(repoInfoEndpoint)}`;
                          const repoInfoResponse = await fetch(repoInfoProxyUrl);
                          if (repoInfoResponse.ok) {
                            const repoInfoText = await repoInfoResponse.text();
                            const repoInfo: any = JSON.parse(repoInfoText);
                            if (repoInfo.default_branch) {
                              defaultBranch = repoInfo.default_branch;
                              console.log(`✅ [File Fetch] Got default branch from repo: ${defaultBranch}`);
                            }
                          } else {
                            console.warn(`⚠️ [File Fetch] Repo info API returned ${repoInfoResponse.status}, will try branches`);
                          }
                        } catch (repoInfoError) {
                          console.warn("⚠️ [File Fetch] Failed to get repo info, will try branches:", repoInfoError);
                        }
                        
                        // CRITICAL: Prioritize default branch from repo info (most reliable)
                        // Then try main (more common), then master (older repos)
                        const branchesToTry = [
                          defaultBranch, // First: default branch from repo info (most reliable)
                          "main",       // Second: main (most common default)
                          "master"      // Third: master (older repos)
                        ].filter((b): b is string => !!b && typeof b === 'string')
                         .filter((b, i, arr) => arr.indexOf(b) === i); // Remove duplicates
                        
                        let sha: string | null = null;
                        let successfulBranch: string | null = null;
                        
                        for (const branch of branchesToTry) {
                          try {
                            // Use proxy endpoint to leverage platform OAuth token if available
                            const branchEndpoint = `/repos/${owner}/${repoName}/git/refs/heads/${encodeURIComponent(branch)}`;
                            const branchProxyUrl = `/api/github/proxy?endpoint=${encodeURIComponent(branchEndpoint)}`;
                            const branchResponse = await fetch(branchProxyUrl);
                            
                            if (branchResponse.ok) {
                              const branchText = await branchResponse.text();
                              const branchData: any = JSON.parse(branchText);
                              if (branchData.object?.sha) {
                                const branchSha = branchData.object.sha;
                                sha = branchSha;
                                successfulBranch = branch;
                                console.log(`✅ [File Fetch] Got SHA for branch ${branch}: ${branchSha.slice(0, 8)}...`);
                                break;
                              }
                            } else {
                              console.warn(`⚠️ [File Fetch] Branch ${branch} not found (${branchResponse.status}), trying next...`);
                            }
                          } catch (branchError) {
                            console.warn(`⚠️ [File Fetch] Failed to get ref for branch ${branch}:`, branchError);
                            continue;
                          }
                        }
                        
                        if (!sha || !successfulBranch) {
                          console.error("❌ [File Fetch] Failed to get branch SHA for any branch. Tried:", branchesToTry);
                          setFetchingFilesFromGit({ source: null, message: '' });
                          return;
                        }
                        
                        // sha is guaranteed to be non-null here
                        const finalSha = sha;
                        
                        // Fetch file tree from git server using proxy
                        const treeEndpoint = `/repos/${owner}/${repoName}/git/trees/${finalSha}?recursive=1`;
                        const treeProxyUrl = `/api/github/proxy?endpoint=${encodeURIComponent(treeEndpoint)}`;
                        const treeResponse = await fetch(treeProxyUrl);
                        
                        if (treeResponse.ok) {
                          const treeDataText = await treeResponse.text();
                          const treeData: any = JSON.parse(treeDataText);
                          if (treeData.tree && Array.isArray(treeData.tree)) {
                            const files = treeData.tree
                              .filter((n: any) => n.type === "blob")
                              .map((n: any) => ({ type: "file", path: n.path, size: n.size }));
                            const dirs = treeData.tree
                              .filter((n: any) => n.type === "tree")
                              .map((n: any) => ({ type: "dir", path: n.path }));
                            
                            // Add all parent directories
                            const allDirs = new Set<string>(dirs.map((d: any) => d.path));
                            for (const file of files) {
                              const parts = file.path.split("/");
                              for (let i = 1; i < parts.length; i++) {
                                allDirs.add(parts.slice(0, i).join("/"));
                              }
                            }
                            
                            const allFiles = [
                              ...Array.from(allDirs).sort().map((path: string) => ({ type: "dir", path })),
                              ...files.sort((a: { type: string; path: string; size?: number }, b: { type: string; path: string; size?: number }) => a.path.localeCompare(b.path))
                            ];
                            
                            console.log("✅ [File Fetch] Fetched", allFiles.length, "items from git server (", files.length, "files,", allDirs.size, "dirs)");
                            
                            // Hide loading indicator
                            setFetchingFilesFromGit({ source: null, message: '' });
                            
                            // CRITICAL: Get sourceUrl/clone from localStorage to preserve in repoData
                            // This ensures fetchGithubRaw can find sourceUrl when opening files
                            let sourceUrlToPreserve: string | undefined;
                            let cloneToPreserve: string[] | undefined;
                            try {
                              const repos = loadStoredRepos();
                              const matchingRepo = repos.find((r) => {
                                const matchesOwner = r.ownerPubkey && ownerPubkey && 
                                  (r.ownerPubkey === ownerPubkey || r.ownerPubkey.toLowerCase() === ownerPubkey.toLowerCase());
                                const matchesRepo = r.repo === resolvedParams.repo || r.slug === resolvedParams.repo || r.name === resolvedParams.repo;
                                const matchesEntity = r.entity === resolvedParams.entity || 
                                  (r.entity && resolvedParams.entity && r.entity.toLowerCase() === resolvedParams.entity.toLowerCase());
                                return (matchesOwner || matchesEntity) && matchesRepo;
                              });
                              if (matchingRepo) {
                                sourceUrlToPreserve = matchingRepo.sourceUrl || matchingRepo.forkedFrom;
                                cloneToPreserve = matchingRepo.clone;
                              }
                            } catch (e) {
                              console.error("❌ [File Fetch] Error getting sourceUrl from localStorage:", e);
                            }
                            
                            // Update repoData - preserve sourceUrl/clone so fetchGithubRaw can use them
                            setRepoData((prev: any) => prev ? ({ 
                              ...prev, 
                              files: allFiles,
                              sourceUrl: sourceUrlToPreserve || prev.sourceUrl,
                              forkedFrom: sourceUrlToPreserve || prev.forkedFrom,
                              clone: cloneToPreserve || prev.clone,
                            }) : prev);
                            
                            // Update localStorage
                            try {
                              const repos = loadStoredRepos();
                              const updated = repos.map((r) => {
                                const matchesOwner = r.ownerPubkey && ownerPubkey && 
                                  (r.ownerPubkey === ownerPubkey || r.ownerPubkey.toLowerCase() === ownerPubkey.toLowerCase());
                                const matchesRepo = r.repo === resolvedParams.repo || r.slug === resolvedParams.repo || r.name === resolvedParams.repo;
                                const matchesEntity = r.entity === resolvedParams.entity || 
                                  (r.entity && resolvedParams.entity && r.entity.toLowerCase() === resolvedParams.entity.toLowerCase());
                                
                                if ((matchesOwner || matchesEntity) && matchesRepo) {
                                  return { ...r, files: allFiles };
                                }
                                return r;
                              });
                              localStorage.setItem("gittr_repos", JSON.stringify(updated));
                              console.log("💾 [File Fetch] Updated localStorage with files from git server");
                            } catch (e) {
                              console.error("❌ [File Fetch] Failed to update localStorage:", e);
                            }
                            
                            return; // Success
                          }
                        } else {
                          console.warn("⚠️ [File Fetch] Git server API error:", treeResponse.status);
                          setFetchingFilesFromGit({ source: null, message: '' });
                        }
                      } catch (error: any) {
                        console.error("❌ [File Fetch] Error fetching from GitHub:", error.message);
                        setFetchingFilesFromGit({ source: null, message: '' });
                      }
                    } else if (gitlabMatch) {
                      const [, owner, repoName] = gitlabMatch;
                      
                      console.log("📁 [File Fetch] Fetching files from GitLab (sourceUrl):", { owner, repoName, url: sourceUrl });
                      console.log("📁 [File Fetch] This is the INTENDED architecture - git servers store files, Nostr events reference them");
                      
                      // Show loading indicator
                      setFetchingFilesFromGit({ source: 'gitlab', message: `Fetching files from GitLab...` });
                      
                      try {
                        // CRITICAL: First get the default branch from repo info
                        let defaultBranch = currentData?.defaultBranch || "main";
                        try {
                          const projectPath = encodeURIComponent(`${owner}/${repoName}`);
                          const repoInfoUrl = `https://gitlab.com/api/v4/projects/${projectPath}`;
                          const repoInfoResponse = await fetch(repoInfoUrl, { headers: { "User-Agent": "gittr-space" } as any });
                          if (repoInfoResponse.ok) {
                            const repoInfo: any = await repoInfoResponse.json();
                            if (repoInfo.default_branch) {
                              defaultBranch = repoInfo.default_branch;
                              console.log(`✅ [File Fetch] Got default branch from GitLab repo: ${defaultBranch}`);
                            }
                          }
                        } catch (repoInfoError) {
                          console.warn("⚠️ [File Fetch] Failed to get GitLab repo info, using fallback:", repoInfoError);
                        }
                        
                        // Try branches in order: defaultBranch, main, master
                        const branchesToTry = [defaultBranch, "main", "master"].filter((b, i, arr) => arr.indexOf(b) === i);
                        const projectPath = encodeURIComponent(`${owner}/${repoName}`);
                        
                        // GitLab API: Get repository tree
                        // GitLab API format: /api/v4/projects/:id/repository/tree
                        let treeResponse: Response | null = null;
                        let successfulBranch: string | null = null;
                        
                        for (const branch of branchesToTry) {
                          try {
                            const treeUrl = `https://gitlab.com/api/v4/projects/${projectPath}/repository/tree?ref=${encodeURIComponent(branch)}&recursive=true&per_page=1000`;
                            treeResponse = await fetch(treeUrl, { headers: { "User-Agent": "gittr-space" } });
                            
                            if (treeResponse.ok) {
                              successfulBranch = branch;
                              console.log(`✅ [File Fetch] Got tree for GitLab branch ${branch}`);
                              break;
                            }
                          } catch (branchError) {
                            console.warn(`⚠️ [File Fetch] Failed to get tree for GitLab branch ${branch}:`, branchError);
                            continue;
                          }
                        }
                        
                        if (!treeResponse || !treeResponse.ok) {
                          console.error("❌ [File Fetch] Failed to get tree for any GitLab branch:", branchesToTry);
                          setFetchingFilesFromGit({ source: null, message: '' });
                          return;
                        }
                        
                        // treeResponse is guaranteed to be ok here
                        const treeData: any = await treeResponse.json();
                        if (Array.isArray(treeData)) {
                            const files = treeData
                              .filter((n: any) => n.type === "blob")
                              .map((n: any) => ({ type: "file", path: n.path, size: n.size }));
                            const dirs = treeData
                              .filter((n: any) => n.type === "tree")
                              .map((n: any) => ({ type: "dir", path: n.path }));
                            
                            // Add all parent directories
                            const allDirs = new Set<string>(dirs.map((d: any) => d.path));
                            for (const file of files) {
                              const parts = file.path.split("/");
                              for (let i = 1; i < parts.length; i++) {
                                allDirs.add(parts.slice(0, i).join("/"));
                              }
                            }
                            
                            const allFiles = [
                              ...Array.from(allDirs).sort().map((path: string) => ({ type: "dir", path })),
                              ...files.sort((a: { type: string; path: string; size?: number }, b: { type: string; path: string; size?: number }) => a.path.localeCompare(b.path))
                            ];
                            
                            console.log("✅ [File Fetch] Fetched", allFiles.length, "items from GitLab (", files.length, "files,", allDirs.size, "dirs)");
                            
                            // Hide loading indicator
                            setFetchingFilesFromGit({ source: null, message: '' });
                            
                            // CRITICAL: Get sourceUrl/clone from localStorage to preserve in repoData
                            // This ensures fetchGithubRaw can find sourceUrl when opening files
                            let sourceUrlToPreserve: string | undefined;
                            let cloneToPreserve: string[] | undefined;
                            try {
                              const repos = loadStoredRepos();
                              const matchingRepo = repos.find((r) => {
                                const matchesOwner = r.ownerPubkey && ownerPubkey && 
                                  (r.ownerPubkey === ownerPubkey || r.ownerPubkey.toLowerCase() === ownerPubkey.toLowerCase());
                                const matchesRepo = r.repo === resolvedParams.repo || r.slug === resolvedParams.repo || r.name === resolvedParams.repo;
                                const matchesEntity = r.entity === resolvedParams.entity || 
                                  (r.entity && resolvedParams.entity && r.entity.toLowerCase() === resolvedParams.entity.toLowerCase());
                                return (matchesOwner || matchesEntity) && matchesRepo;
                              });
                              if (matchingRepo) {
                                sourceUrlToPreserve = matchingRepo.sourceUrl || matchingRepo.forkedFrom;
                                cloneToPreserve = matchingRepo.clone;
                              }
                            } catch (e) {
                              console.error("❌ [File Fetch] Error getting sourceUrl from localStorage:", e);
                            }
                            
                            // Auto-load README if it exists
                            const readmeFile = files.find((f: any) => {
                              const lowerPath = f.path.toLowerCase();
                              return lowerPath === "readme.md" || lowerPath === "readme" || lowerPath.endsWith("/readme.md");
                            });
                            
                            let readmeContent = "";
                            if (readmeFile && sourceUrlToPreserve) {
                              try {
                                console.log("📖 [File Fetch] Auto-loading README:", readmeFile.path);
                                const readmeApiUrl = `/api/git/file-content?sourceUrl=${encodeURIComponent(sourceUrlToPreserve)}&path=${encodeURIComponent(readmeFile.path)}&branch=${encodeURIComponent(branch)}`;
                                const readmeResponse = await fetch(readmeApiUrl);
                                if (readmeResponse.ok) {
                                  const readmeData = await readmeResponse.json();
                                  readmeContent = readmeData.content || "";
                                  console.log("✅ [File Fetch] README loaded successfully");
                                } else {
                                  console.warn("⚠️ [File Fetch] Failed to load README:", readmeResponse.status);
                                }
                              } catch (e) {
                                console.error("❌ [File Fetch] Error loading README:", e);
                              }
                            }
                            
                            // Update repoData - preserve sourceUrl/clone so fetchGithubRaw can use them
                            setRepoData((prev: any) => prev ? ({ 
                              ...prev, 
                              files: allFiles,
                              readme: readmeContent || prev.readme,
                              sourceUrl: sourceUrlToPreserve || prev.sourceUrl,
                              forkedFrom: sourceUrlToPreserve || prev.forkedFrom,
                              clone: cloneToPreserve || prev.clone,
                            }) : prev);
                            
                            // Update localStorage
                            try {
                              const repos = loadStoredRepos();
                              const updated = repos.map((r) => {
                                const matchesOwner = r.ownerPubkey && ownerPubkey && 
                                  (r.ownerPubkey === ownerPubkey || r.ownerPubkey.toLowerCase() === ownerPubkey.toLowerCase());
                                const matchesRepo = r.repo === resolvedParams.repo || r.slug === resolvedParams.repo || r.name === resolvedParams.repo;
                                const matchesEntity = r.entity === resolvedParams.entity || 
                                  (r.entity && resolvedParams.entity && r.entity.toLowerCase() === resolvedParams.entity.toLowerCase());
                                
                                if ((matchesOwner || matchesEntity) && matchesRepo) {
                                  return { ...r, files: allFiles, readme: readmeContent || r.readme };
                                }
                                return r;
                              });
                              localStorage.setItem("gittr_repos", JSON.stringify(updated));
                              console.log("💾 [File Fetch] Updated localStorage with files from GitLab");
                            } catch (e) {
                              console.error("❌ [File Fetch] Failed to update localStorage:", e);
                            }
                            
                            return; // Success
                          } else {
                            console.warn("⚠️ [File Fetch] GitLab API returned non-array data");
                            setFetchingFilesFromGit({ source: null, message: '' });
                          }
                      } catch (error: any) {
                        console.error("❌ [File Fetch] Error fetching from GitLab:", error.message);
                        setFetchingFilesFromGit({ source: null, message: '' });
                      }
                    } else if (sourceUrl.includes('codeberg.org')) {
                      // Codeberg is supported via multi-source fetcher and fetchGithubRaw
                      console.log("ℹ️ [File Fetch] Codeberg sourceUrl detected - files should be fetched via multi-source fetcher or fetchGithubRaw");
                    } else {
                      // Check if it's a GRASP server
                      const { isGraspServer } = require("@/lib/utils/grasp-servers");
                      if (isGraspServer(sourceUrl)) {
                        console.log("ℹ️ [File Fetch] GRASP server detected:", sourceUrl);
                        console.log("ℹ️ [File Fetch] GRASP servers are handled via multi-source fetcher or bridge API");
                        // GRASP servers are handled via the multi-source fetcher in fetchGithubRaw
                        // or via the bridge API endpoint, so we don't need special handling here
                      } else {
                        console.log("ℹ️ [File Fetch] sourceUrl is not a GitHub, GitLab, Codeberg, or GRASP server URL:", sourceUrl);
                        console.log("ℹ️ [File Fetch] Other git servers (self-hosted, etc.) not yet supported");
                      }
                    }
                  } else {
                    console.log("ℹ️ [File Fetch] No sourceUrl found - files must be pushed to git-nostr-bridge via git push");
                  }
                }
              }
            } catch (error: any) {
              console.error("❌ [File Fetch] Error fetching files from git-nostr-bridge:", error.message, error);
            } finally {
              fileFetchInProgressRef.current = false;
            }
          }
        } catch (error: any) {
          console.error("❌ Error querying Nostr for repository files:", error.message);
          fileFetchInProgressRef.current = false;
        }
      })();
    
    return () => {
      fileFetchInProgressRef.current = false;
    };
  }, [resolvedParams.entity, resolvedParams.repo, resolvedOwnerPubkey, ownerPubkeyForLink, subscribe, defaultRelays, selectedBranch]); // Include selectedBranch so it re-runs when branch changes

  // Extract URL params with state to prevent infinite loops
  const [urlParams, setUrlParams] = useState<{branch: string | null; file: string | null; path: string | null}>({branch: null, file: null, path: null});
  
  // Function to read URL params from current location (works for browser navigation)
  const readUrlParams = useCallback(() => {
    if (typeof window === "undefined") return {branch: null, file: null, path: null};
    try {
      const params = new URLSearchParams(window.location.search);
      return {
        branch: params.get("branch") || null,
        file: params.get("file") || null,
        path: params.get("path") || null,
      };
    } catch {
      return {branch: null, file: null, path: null};
    }
  }, []);
  
  // Update URL params when searchParams change OR when browser navigation occurs
  useEffect(() => {
    if (updatingFromURLRef.current || isUpdatingURLRef.current) return; // Skip if we're updating from URL
    const currentParamsString = searchParams?.toString() || "";
    try {
      const params = new URLSearchParams(currentParamsString);
      const newParams = {
        branch: params.get("branch") || null,
        file: params.get("file") || null,
        path: params.get("path") || null,
      };
      // Only update if values actually changed
      setUrlParams(prev => {
        if (prev.branch !== newParams.branch || prev.file !== newParams.file || prev.path !== newParams.path) {
          return newParams;
        }
        return prev;
      });
    } catch {
      setUrlParams({branch: null, file: null, path: null});
    }
  }, [searchParams]);
  
  // Listen for browser navigation (back/forward buttons) and sync URL params
  useEffect(() => {
    const handlePopState = () => {
      // Browser navigation occurred - read params directly from window.location
      const newParams = readUrlParams();
      setUrlParams(prev => {
        if (prev.branch !== newParams.branch || prev.file !== newParams.file || prev.path !== newParams.path) {
          return newParams;
        }
        return prev;
      });
    };
    
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [readUrlParams]);
  
  const urlBranch = urlParams.branch;
  const urlFile = urlParams.file;
  const urlPath = urlParams.path;

  // Initialize state from URL parameters when URL or repoData changes
  // Use functional updates to prevent loops - only update if value actually changed
  useEffect(() => {
    if (!repoData || updatingFromURLRef.current) return; // Wait for repo to load, skip if already updating
    updatingFromURLRef.current = true;
    
    // Update branch from URL if valid - use functional update
    if (urlBranch && (repoData as any).branches?.includes(urlBranch)) {
      setSelectedBranch(prev => {
        if (prev !== urlBranch) return urlBranch;
        return prev;
      });
    }
    // Update path from URL - use functional update
    if (urlPath !== null && urlPath !== undefined) {
      setCurrentPath(prev => {
        if (prev !== urlPath) return urlPath;
        return prev;
      });
    }
    // Update file from URL - use functional update
    if (urlFile !== null && urlFile !== undefined) {
      setSelectedFile(prev => {
        if (prev !== urlFile) return urlFile;
        return prev;
      });
    } else if (urlFile === null) {
      // URL cleared file, close it - use functional update
      setSelectedFile(prev => {
        if (prev !== null) {
          setFileContent("");
          return null;
        }
        return prev;
      });
    }
    
    // Reset flag after state updates complete
    setTimeout(() => {
      updatingFromURLRef.current = false;
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlBranch, urlFile, urlPath, repoData?.files?.length, repoData?.defaultBranch]); // Use specific properties instead of full repoData
  
  // Open file when selectedFile is set from URL (skip URL update since URL already has it)
  // Use ref to track if we're opening from URL to prevent loops
  useEffect(() => {
    if (selectedFile && !loadingFile && repoData && urlFile === selectedFile && !openingFromURLRef.current) {
      // Only open if URL matches and we don't have content yet
      // CRITICAL: Don't retry if we've already failed to load this file (prevents infinite loop)
      if (!fileContent && !failedFilesRef.current.has(selectedFile)) {
        openingFromURLRef.current = true;
        // openFile is async, wait for it
        openFile(selectedFile, true).then(() => {
          openingFromURLRef.current = false;
          // If file loaded successfully, remove from failed set
          if (fileContent && fileContent !== "(unable to load file)") {
            failedFilesRef.current.delete(selectedFile);
          }
        }).catch(() => {
          openingFromURLRef.current = false;
        }); // Skip URL update - already in URL
      } else if (fileContent === "(unable to load file)" && !failedFilesRef.current.has(selectedFile)) {
        // Mark as failed to prevent retry loop
        failedFilesRef.current.add(selectedFile);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFile, urlFile, repoData?.files?.length, loadingFile, fileContent]); // Use specific properties instead of full repoData

  // Resolve repo logo URL: prefer stored logoUrl, then logo files, then owner Nostr profile picture
  useEffect(() => {
    let cancelled = false;
    async function resolveLogo() {
      try {
        if (!repoData) return;
        const repos = loadStoredRepos();
        const record = findRepoByEntityAndName(repos, resolvedParams.entity, resolvedParams.repo);
        
        // Priority 1: Stored logoUrl (check if it exists in the record, even if not in interface)
        const stored = (record as StoredRepo & { logoUrl?: string })?.logoUrl;
        if (stored && stored.trim().length > 0) {
          // Validate URL format (supports http/https and data URLs)
          // .webp and other formats are supported - browser will handle format validation
          let trimmed = stored.trim();
          
          // Auto-add https:// if missing (for web URLs)
          if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://") && 
              !trimmed.startsWith("data:") && !trimmed.startsWith("/") &&
              trimmed.includes(".") && !trimmed.includes("@")) {
            // Looks like a domain/URL - add https://
            trimmed = `https://${trimmed}`;
          }
          
          if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("data:") || trimmed.startsWith("/")) {
            if (!cancelled) setLogoUrl(trimmed);
            return;
          } else {
            console.warn("Invalid logoUrl format (must be http/https/data URL or relative path):", trimmed);
          }
        }
        
        // Priority 2: Logo files from repo (prioritize root-level, exact "logo" matches)
        const repoName = (repoData.name || repoData.repo || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"];
        
        const candidates = (repoData.files || [])
          .map(f => f.path)
          .filter(p => {
            const fileName = p.split("/").pop() || "";
            const baseName = fileName.replace(/\.[^.]+$/, "").toLowerCase();
            const extension = fileName.split(".").pop()?.toLowerCase() || "";
            const isRoot = p.split("/").length === 1;
            
            if (!imageExts.includes(extension)) return false;
            
            // Match logo files (but exclude third-party logos like alby)
            if (baseName.includes("logo") && !baseName.includes("logo-alby") && !baseName.includes("alby-logo")) return true;
            
            // Match repo-name-based files (e.g., "gittr.png" for gittr repo)
            if (repoName && baseName === repoName) return true;
            
            // Match common icon names in root directory only
            if (isRoot && (baseName === "repo" || baseName === "icon" || baseName === "favicon")) return true;
            
            return false;
          })
          .sort((a, b) => {
            const aParts = a.split("/");
            const bParts = b.split("/");
            const aName = aParts[aParts.length - 1]?.replace(/\.[^.]+$/, "").toLowerCase() || "";
            const bName = bParts[bParts.length - 1]?.replace(/\.[^.]+$/, "").toLowerCase() || "";
            const aIsRoot = aParts.length === 1;
            const bIsRoot = bParts.length === 1;
            
            // Priority 1: Exact "logo" match
            if (aName === "logo" && bName !== "logo") return -1;
            if (bName === "logo" && aName !== "logo") return 1;
            
            // Priority 2: Repo-name-based files
            if (repoName && aName === repoName && bName !== repoName && bName !== "logo") return -1;
            if (repoName && bName === repoName && aName !== repoName && aName !== "logo") return 1;
            
            // Priority 3: Root directory files
            if (aName === "logo" && bName === "logo") {
              if (aIsRoot && !bIsRoot) return -1;
              if (!aIsRoot && bIsRoot) return 1;
            }
            if (aIsRoot && !bIsRoot) return -1;
            if (!bIsRoot && aIsRoot) return 1;
            
            // Priority 4: Format preference (png > svg > webp > jpg > gif > ico)
            const formatPriority: Record<string, number> = { png: 0, svg: 1, webp: 2, jpg: 3, jpeg: 3, gif: 4, ico: 5 };
            const aExt = a.split(".").pop()?.toLowerCase() || "";
            const bExt = b.split(".").pop()?.toLowerCase() || "";
            const aPrio = formatPriority[aExt] ?? 10;
            const bPrio = formatPriority[bExt] ?? 10;
            
            return aPrio - bPrio;
          });
        
        // Helper function to extract owner/repo from various URL formats
        const extractOwnerRepo = (urlString: string): { owner: string; repo: string; hostname: string } | null => {
          try {
            // Handle SSH format: git@github.com:owner/repo.git
            if (urlString.includes('@') && urlString.includes(':')) {
              const match = urlString.match(/(?:git@|https?:\/\/)([^\/:]+)[\/:]([^\/]+)\/([^\/]+?)(?:\.git)?$/);
              if (match && match[1] && match[2] && match[3]) {
                const hostname = match[1]!;
                const owner = match[2]!;
                const repo = match[3]!.replace(/\.git$/, '');
                return { owner, repo, hostname };
              }
            }
            
            // Handle HTTPS/HTTP URLs
            const url = new URL(urlString);
            const parts = url.pathname.split("/").filter(Boolean);
            if (parts.length >= 2 && parts[0] && parts[1]) {
              return {
                owner: parts[0],
                repo: parts[1].replace(/\.git$/, ''),
                hostname: url.hostname
              };
            }
          } catch (e) {
            // Invalid URL format
          }
          return null;
        };

        for (const p of candidates) {
          // Try sourceUrl first
          let gitUrl: string | undefined = repoData.sourceUrl;
          let ownerRepo: { owner: string; repo: string; hostname: string } | null = null;
          
          if (gitUrl) {
            ownerRepo = extractOwnerRepo(gitUrl);
          }
          
          // If sourceUrl didn't work, try clone array
          if (!ownerRepo && repoData.clone && Array.isArray(repoData.clone) && repoData.clone.length > 0) {
            // Find first GitHub/GitLab/Codeberg URL in clone array
            const gitCloneUrl = repoData.clone.find((url: string) => 
              url && (url.includes('github.com') || url.includes('gitlab.com') || url.includes('codeberg.org'))
            );
            if (gitCloneUrl) {
              ownerRepo = extractOwnerRepo(gitCloneUrl);
            }
          }
          
          // If we found a valid git URL, construct raw URL
          if (ownerRepo) {
            const { owner, repo, hostname } = ownerRepo;
            const branch = selectedBranch || repoData?.defaultBranch || "main";
            
            if (hostname === "github.com" || hostname.includes("github.com")) {
              const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${p}`;
              if (!cancelled) setLogoUrl(rawUrl);
              return;
            } else if (hostname === "gitlab.com" || hostname.includes("gitlab.com")) {
              const rawUrl = `https://gitlab.com/${owner}/${repo}/-/raw/${encodeURIComponent(branch)}/${p}`;
              if (!cancelled) setLogoUrl(rawUrl);
              return;
            } else if (hostname === "codeberg.org" || hostname.includes("codeberg.org")) {
              const rawUrl = `https://codeberg.org/${owner}/${repo}/raw/branch/${encodeURIComponent(branch)}/${p}`;
              if (!cancelled) setLogoUrl(rawUrl);
              return;
            }
          }
          
          // For Nostr-native repos without sourceUrl, try bridge API directly
          // Get owner pubkey for bridge API
          const ownerPubkeyForBridge = ownerPubkeysForMetadata.length > 0 ? ownerPubkeysForMetadata[0] : 
                                     (record?.ownerPubkey && /^[0-9a-f]{64}$/i.test(record.ownerPubkey) ? record.ownerPubkey : 
                                     (resolvedParams.entity && resolvedParams.entity.length === 64 && /^[0-9a-f]{64}$/i.test(resolvedParams.entity) ? resolvedParams.entity : undefined));
          
          // CRITICAL: Use repositoryName from Nostr event (exact name used by git-nostr-bridge)
          // Priority: record.repositoryName > repoData.repositoryName > name > repo > slug
          // Check both record (from localStorage) and repoData (from state) for repositoryName
          const repoDataAny = repoData as any;
          const recordAny = record as any;
          let repoName = recordAny?.repositoryName || repoDataAny?.repositoryName || repoData?.name || repoData?.repo || repoData?.slug;
          
          // Extract repo name (handle paths like "gitnostr.com/gitworkshop")
          if (repoName && typeof repoName === 'string' && repoName.includes('/')) {
            const parts = repoName.split('/');
            repoName = parts[parts.length - 1] || repoName;
          }
          if (repoName) {
            repoName = String(repoName).replace(/\.git$/, '');
          }
          
          if (ownerPubkeyForBridge && repoName) {
            const branch = selectedBranch || repoData?.defaultBranch || "main";
            const bridgeApiUrl = `/api/nostr/repo/file-content?ownerPubkey=${encodeURIComponent(ownerPubkeyForBridge)}&repo=${encodeURIComponent(repoName)}&path=${encodeURIComponent(p)}&branch=${encodeURIComponent(branch)}`;
            
            // For images, we can try to fetch and convert to data URL, or use the API URL directly
            // Since it's a logo file, try fetching it to get a data URL
            try {
              const response = await fetch(bridgeApiUrl);
              if (response.ok) {
                const data = await response.json();
                if (data.content) {
                  // If it's base64 encoded binary, construct data URL
                  const isBinary = data.isBinary || false;
                  if (isBinary) {
                    const ext = p.split('.').pop()?.toLowerCase() || 'png';
                    const mimeType = ext === 'svg' ? 'image/svg+xml' : 
                                   ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
                                   ext === 'gif' ? 'image/gif' :
                                   ext === 'webp' ? 'image/webp' :
                                   ext === 'ico' ? 'image/x-icon' : 'image/png';
                    const dataUrl = `data:${mimeType};base64,${data.content}`;
                    if (!cancelled) setLogoUrl(dataUrl);
                    return;
                  } else {
                    // Text content (unlikely for logo, but handle it)
                    if (!cancelled) setLogoUrl(bridgeApiUrl);
                    return;
                  }
                } else if (data.url) {
                  // API returned a URL
                  if (!cancelled) setLogoUrl(data.url);
                  return;
                }
              } else {
                // Response not OK (e.g., 500), but try using the API URL directly
                // The browser might be able to load it if the API supports direct image serving
                console.warn("⚠️ [Logo] Bridge API returned non-OK status, using API URL directly:", response.status);
                if (!cancelled) {
                  setLogoUrl(bridgeApiUrl);
                  return;
                }
              }
            } catch (e) {
              // API call failed, but try using the bridge API URL directly as fallback
              // The browser might be able to load it even if our fetch failed
              console.warn("⚠️ [Logo] Bridge API call failed, using API URL directly:", e);
              if (!cancelled) {
                setLogoUrl(bridgeApiUrl);
                return;
              }
            }
          }
          
          // Fallback to fetchGithubRaw for other cases (nostr repos, unknown providers, etc.)
          const res = await fetchGithubRaw(p);
          if (res.url) {
            if (!cancelled) setLogoUrl(res.url);
            return;
          }
        }
        
        // Priority 3: Owner Nostr profile picture (last fallback)
        // Get actual owner pubkey from repo (for imported repos)
        // CRITICAL: Use the resolved owner pubkey from ownerPubkeysForMetadata, not just record?.ownerPubkey
        // This ensures we have the full 64-char pubkey for metadata lookup
        const ownerPubkey = ownerPubkeysForMetadata.length > 0 ? ownerPubkeysForMetadata[0] : 
                           (record?.ownerPubkey && /^[0-9a-f]{64}$/i.test(record.ownerPubkey) ? record.ownerPubkey : 
                           (resolvedParams.entity && resolvedParams.entity.length === 64 && /^[0-9a-f]{64}$/i.test(resolvedParams.entity) ? resolvedParams.entity : undefined));
        // CRITICAL: Only use full pubkey for metadata, not 8-char prefix
        // Use ref to access latest metadata without causing dependency loop
        const metadata = ownerPubkey ? ownerMetadataRef.current[ownerPubkey] : undefined;
        if (metadata?.picture && metadata.picture.trim().length > 0 && metadata.picture.startsWith("http")) {
          if (!cancelled) setLogoUrl(metadata.picture);
          return;
        }
        
        // If no stored logoUrl and no logo files found, set to null
        // If stored logoUrl exists but fails to load, onError handler will trigger fallback
        if (!cancelled && !stored) {
          setLogoUrl(null);
        }
      } catch {
        if (!cancelled) setLogoUrl(null);
      }
    }
    resolveLogo();
    return () => { cancelled = true; };
  }, [repoData, resolvedParams.entity, resolvedParams.repo, ownerPubkeysForMetadata.length]); // Use length only to prevent loops - join creates new string each render

  const pathParts = useMemo(() => currentPath.split("/").filter(Boolean), [currentPath]);
  const items = useMemo(() => {
    if (!repoData?.files) return [];
    const prefix = currentPath ? currentPath + "/" : "";
    const direct = new Map<string, { type: string; path: string; size?: number }>();
    
    // Process all files/dirs from repoData.files
    for (const f of repoData.files) {
      if (deletedPaths.includes(f.path)) continue;
      // Skip if this is not in the current directory
      if (currentPath) {
        if (!f.path.startsWith(prefix)) continue;
      }
      
      // Get relative path from current directory
      const relative = currentPath ? f.path.slice(prefix.length) : f.path;
      if (!relative) continue; // Skip exact matches (the directory itself)
      
      // Split to get first segment
      const firstSegment = relative.split("/")[0];
      
      if (relative === firstSegment) {
        // Direct child (file or directory at current level)
        // Use the type from the file entry, default to "file" if missing
        direct.set(firstSegment, { 
          type: f.type || "file", 
          path: f.path, 
          size: f.size 
        });
      } else {
        // This is inside a subdirectory - add the subdirectory if not already present
        if (firstSegment && !direct.has(firstSegment)) {
          const dirPath = currentPath ? `${currentPath}/${firstSegment}` : firstSegment;
          direct.set(firstSegment, { 
            type: "dir", 
            path: dirPath,
            size: undefined 
          });
        }
      }
    }
    
    return Array.from(direct.values()).sort((a,b)=> {
      // Directories first, then files
      if (a.type === "dir" && b.type !== "dir") return -1;
      if (a.type !== "dir" && b.type === "dir") return 1;
      // Then alphabetically
      const aName = a.path.split("/").pop() || "";
      const bName = b.path.split("/").pop() || "";
      return aName.localeCompare(bName);
    });
  }, [repoData?.files, currentPath, deletedPaths]);

  // Infer languages from files for newly created repos (or when languages are missing)
  // Track if we've computed languages to prevent infinite loops
  const languagesComputedRef = useRef<string>("");
  
  useEffect(() => {
    const currentRepoData = repoDataRef.current;
    if (!currentRepoData || !currentRepoData.files || (currentRepoData.languages && Object.keys(currentRepoData.languages).length > 0)) {
      return;
    }
    
    // Create a hash of files to detect if they've changed
    const filesHash = currentRepoData.files.map((f: any) => `${f.path}:${f.size || 0}`).join("|");
    if (languagesComputedRef.current === filesHash) {
      return; // Already computed for these files
    }
    
    try {
      const counts: Record<string, number> = {};
      for (const f of currentRepoData.files) {
        if (f.type !== "file") continue;
        const name = f.path.split("/").pop() || f.path;
        const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
        const lang = ((): string => {
          switch (ext) {
            case "ts": case "tsx": return "TypeScript";
            case "js": case "jsx": return "JavaScript";
            case "py": return "Python";
            case "rs": return "Rust";
            case "go": return "Go";
            case "rb": return "Ruby";
            case "php": return "PHP";
            case "java": return "Java";
            case "kt": return "Kotlin";
            case "swift": return "Swift";
            case "c": case "h": return "C";
            case "cpp": case "cc": case "hpp": case "hh": return "C++";
            case "cs": return "C#";
            case "scala": return "Scala";
            case "sh": case "bash": case "zsh": return "Shell";
            case "yaml": case "yml": return "YAML";
            case "json": return "JSON";
            case "toml": return "TOML";
            case "md": return "Markdown";
            case "sql": return "SQL";
            default: return ext ? ext.toUpperCase() : "Other";
          }
        })();
        counts[lang] = (counts[lang] || 0) + (f.size || 1);
      }
      // Persist to localStorage and update state
      const repos = loadStoredRepos();
      const idx = repos.findIndex((r) => {
        const found = findRepoByEntityAndName([r], resolvedParams.entity, resolvedParams.repo);
        return found !== undefined;
      });
      if (idx >= 0 && repos[idx]) {
        repos[idx].languages = counts;
        saveStoredRepos(repos);
      }
      
      // Mark as computed BEFORE updating state to prevent re-trigger
      languagesComputedRef.current = filesHash;
      setRepoData(prev => prev ? ({ ...prev, languages: counts }) : prev);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedParams.entity, resolvedParams.repo]); // Remove repoData from dependencies - use ref instead

  // Compute live counts from localStorage and repo record
  const computeLiveCounts = useCallback(() => {
    try {
      const repoId = `${resolvedParams.entity}/${resolvedParams.repo}`;
      const repos = loadStoredRepos() as any[];
      const rec = repos.find(r => {
        const slug = r.slug || "";
        const entity = r.entity || "";
        const repoName = r.repo || slug;
        return (entity === resolvedParams.entity && repoName === resolvedParams.repo) || slug === repoId;
      });
      setLiveStarCount(rec?.stars || 0);
      setLiveForkCount(rec?.forks || 0);
      const watchedRaw = localStorage.getItem("gittr_watched_repos");
      const watched = watchedRaw ? (JSON.parse(watchedRaw) as string[]) : [];
      setLiveWatchCount(watched.includes(repoId) ? 1 : 0);
    } catch {}
  }, [resolvedParams.entity, resolvedParams.repo]);

  // DISABLED: Storage event listener was causing render loops
  // The storage listener triggers when localStorage is updated, which happens in the main useEffect
  // This creates a loop: useEffect updates localStorage -> storage event -> setRepoData -> useEffect runs again
  // We'll rely on the main useEffect to handle repo data updates instead
  // useEffect(() => {
  //   const handleStorageChange = () => {
  //     if (storageUpdateRef.current) return;
  //     storageUpdateRef.current = true;
  //     // ... disabled to prevent loops
  //   };
  //   window.addEventListener("storage", handleStorageChange);
  //   window.addEventListener("gittr:repo-updated", handleStorageChange);
  //   return () => {
  //     window.removeEventListener("storage", handleStorageChange);
  //     window.removeEventListener("gittr:repo-updated", handleStorageChange);
  //   };
  // }, [resolvedParams.entity, resolvedParams.repo]);
  
  useEffect(() => {
    computeLiveCounts();
    const onUpdate = () => computeLiveCounts();
    window.addEventListener("gittr:repos-updated", onUpdate as EventListener);
    
    // Listen for GRASP repo clone completion events
    const handleGraspRepoCloned = (event: CustomEvent) => {
      const { files, ownerPubkey: clonedOwnerPubkey, repo: clonedRepo } = event.detail;
      
      // Only update if this matches the current repo
      const currentOwnerPubkey = resolvedOwnerPubkey || ownerPubkeyForLink;
      const matchesOwner = currentOwnerPubkey && clonedOwnerPubkey && 
        (currentOwnerPubkey.toLowerCase() === clonedOwnerPubkey.toLowerCase());
      const matchesRepo = clonedRepo === resolvedParams.repo;
      
      if (matchesOwner && matchesRepo && files && Array.isArray(files) && files.length > 0) {
        console.log(`✅ [File Fetch] Received files from GRASP clone completion event: ${files.length} files`);
        setRepoData((prev: any) => prev ? ({ ...prev, files }) : prev);
        
        // Update localStorage
        try {
          const repos = loadStoredRepos();
          const updated = repos.map((r: any) => {
            const matchesOwner = r.ownerPubkey && currentOwnerPubkey && 
              (r.ownerPubkey === currentOwnerPubkey || r.ownerPubkey.toLowerCase() === currentOwnerPubkey.toLowerCase());
            const matchesRepo = r.repo === resolvedParams.repo || r.slug === resolvedParams.repo || r.name === resolvedParams.repo;
            const matchesEntity = r.entity === resolvedParams.entity || 
              (r.entity && resolvedParams.entity && r.entity.toLowerCase() === resolvedParams.entity.toLowerCase());
            
            if ((matchesOwner || matchesEntity) && matchesRepo) {
              return { ...r, files };
            }
            return r;
          });
          localStorage.setItem("gittr_repos", JSON.stringify(updated));
          console.log(`💾 [File Fetch] Updated localStorage with files from GRASP clone`);
        } catch (e) {
          console.error("❌ [File Fetch] Failed to update localStorage:", e);
        }
      }
    };
    
    window.addEventListener("grasp-repo-cloned", handleGraspRepoCloned as EventListener);
    return () => {
      window.removeEventListener("gittr:repos-updated", onUpdate as EventListener);
      window.removeEventListener("grasp-repo-cloned", handleGraspRepoCloned as EventListener);
    };
  }, [computeLiveCounts, resolvedOwnerPubkey, ownerPubkeyForLink, resolvedParams.entity, resolvedParams.repo]);

  // Keyboard shortcut handler for fuzzy file finder (cmd/ctrl-p)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for cmd+p (Mac) or ctrl+p (Windows/Linux)
      // Don't trigger if user is typing in an input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }
      
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        e.stopPropagation();
        // Only open if we're on the repo page and have files
        if (repoData?.files && repoData.files.length > 0) {
          window.location.href = getRepoLink("find");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [repoData?.files]);

  // Helper to get raw GitHub URL for a file path
  function getRawUrl(path: string): string | null {
    if (!repoData?.sourceUrl) return null;
    try {
      const u = new URL(repoData.sourceUrl);
      const parts = u.pathname.split("/").filter(Boolean);
      const owner = parts[0];
      const repo = (parts[1] || resolvedParams.repo).replace(/\.git$/, "");
      const branch = selectedBranch || repoData?.defaultBranch || "main";
      return `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${path}`;
    } catch {
      return null;
    }
  }

  async function fetchGithubRaw(path: string): Promise<{ content: string | null; url: string | null; isBinary: boolean }> {
    // console.log(`🔍 [fetchGithubRaw] Fetching file: ${path}`, { hasRepoData: !!repoData, filesCount: repoData?.files?.length || 0, ownerPubkey: (repoData as any)?.ownerPubkey ? (repoData as any).ownerPubkey.slice(0, 8) : null });

    // Strategy 1: Check if file content is embedded in repoData.files array
    // According to the working insights: "Files embedded in Nostr events are always checked first"
    // This handles legacy repos and small files that are stored directly in events
    if (repoData?.files && Array.isArray(repoData.files)) {
      // Normalize paths for comparison (remove leading/trailing slashes, handle relative paths)
      const normalizePath = (p: string) => p.replace(/^\/+/, '').replace(/\/+/g, '/');
      const normalizedPath = normalizePath(path);
      
      const fileEntry = repoData.files.find((f: any) => {
        const fPath = normalizePath(f.path || "");
        // Try multiple matching strategies
        return fPath === normalizedPath || 
               fPath === path || 
               fPath === `/${path}` || 
               fPath.endsWith(`/${normalizedPath}`) ||
               fPath.endsWith(`/${path}`) ||
               normalizedPath === fPath ||
               path === fPath;
      });
      
      if (fileEntry) {
        console.log(`🔍 [fetchGithubRaw] Found file entry in Nostr event files array: ${path}`, {
          fileEntryPath: fileEntry.path,
          requestedPath: path,
          hasContent: !!(fileEntry as any).content,
          isBinary: !!(fileEntry as any).isBinary,
        });
        
        // CRITICAL: Check for content in standard field first, then try alternative field names
        // Try common variations: content, data, body, text, fileContent
        const contentFields = ['content', 'data', 'body', 'text', 'fileContent', 'file_content'];
        let foundContent: string | null = null;
        let foundField: string | null = null;
        
        for (const field of contentFields) {
          if ((fileEntry as any)?.[field]) {
            foundContent = (fileEntry as any)[field];
            foundField = field;
            break;
          }
        }
        
        if (foundContent) {
          console.log(`✅ [fetchGithubRaw] Found file content in field '${foundField}' for ${path}`, {
            isBinary: !!(fileEntry as any).isBinary,
          });
          
          // Check if it's a binary file stored as base64
          const ext = path.split('.').pop()?.toLowerCase() || '';
          const htmlExts = ['html', 'htm', 'xhtml'];
          const isHtmlFile = htmlExts.includes(ext);
          const isBinary = (fileEntry as any).isBinary || (fileEntry as any).binary || false;
          
          if (isBinary) {
            // CRITICAL: HTML files should NEVER be stored as binary, but if they are, decode them
            if (isHtmlFile) {
              // HTML file incorrectly marked as binary - decode it
              try {
                const decoded = atob(foundContent);
                return { content: decoded, url: null, isBinary: false };
              } catch (e) {
                console.error(`❌ [fetchGithubRaw] Failed to decode HTML file stored as binary: ${path}`, e);
                // Fall through to treat as binary (will show download link)
              }
            }
            
            // Convert base64 to data URL for binary files (images, PDFs, etc.)
            const mimeTypes: Record<string, string> = {
              'png': 'image/png',
              'jpg': 'image/jpeg',
              'jpeg': 'image/jpeg',
              'gif': 'image/gif',
              'webp': 'image/webp',
              'svg': 'image/svg+xml',
              'ico': 'image/x-icon',
              'pdf': 'application/pdf',
              'woff': 'font/woff',
              'woff2': 'font/woff2',
              'ttf': 'font/ttf',
              'otf': 'font/otf',
              'mp4': 'video/mp4',
              'mp3': 'audio/mpeg',
              'wav': 'audio/wav',
            };
            const mimeType = mimeTypes[ext] || 'application/octet-stream';
            const dataUrl = `data:${mimeType};base64,${foundContent}`;
            return { content: null, url: dataUrl, isBinary: true };
          } else {
            // Text file - content is already decoded
            return { content: typeof foundContent === 'string' ? foundContent : String(foundContent), url: null, isBinary: false };
          }
        } else {
          console.log(`⚠️ [fetchGithubRaw] File ${path} found in files array but no content in any field`, {
            fileEntry: fileEntry ? { path: fileEntry.path, type: fileEntry.type, keys: Object.keys(fileEntry), fullEntry: fileEntry } : null,
            allFiles: repoData.files.slice(0, 5).map((f: any) => ({ path: f.path, keys: Object.keys(f) })),
          });

          // NEW: If we have a GitHub/GitLab/Codeberg source URL, fetch latest content directly
          const sourceUrlForFetch =
            effectiveSourceUrl ||
            repoData?.sourceUrl ||
            null;

          if (
            sourceUrlForFetch &&
            (sourceUrlForFetch.includes("github.com") ||
              sourceUrlForFetch.includes("gitlab.com") ||
              sourceUrlForFetch.includes("codeberg.org"))
          ) {
            try {
              const branchToUse =
                selectedBranch || repoData?.defaultBranch || "main";
              const apiUrl = `/api/git/file-content?sourceUrl=${encodeURIComponent(
                sourceUrlForFetch
              )}&path=${encodeURIComponent(path)}&branch=${encodeURIComponent(
                branchToUse
              )}`;
              console.log(
                `🌐 [fetchGithubRaw] Fetching missing content from source: ${apiUrl}`
              );
              const resp = await fetch(apiUrl);
              if (resp.ok) {
                const data = await resp.json();
                if (data?.content !== undefined) {
                  console.log(
                    `✅ [fetchGithubRaw] Fetched latest content from source for ${path}`
                  );
                  return {
                    content: data.content,
                    url: null,
                    isBinary: !!data.isBinary,
                  };
                }
              } else {
                console.warn(
                  `⚠️ [fetchGithubRaw] Source fetch failed ${resp.status} for ${path}`
                );
              }
            } catch (e) {
              console.warn(
                `⚠️ [fetchGithubRaw] Source fetch errored for ${path}:`,
                e
              );
            }
          }
        }
      } else {
        console.log(`⚠️ [fetchGithubRaw] File ${path} NOT found in files array`, {
          requestedPath: path,
          normalizedPath: normalizePath(path),
          filesCount: repoData.files.length,
          samplePaths: repoData.files.slice(0, 5).map((f: any) => f.path),
        });
      }
    }

    // Strategy 1.5: For GitHub/GitLab/Codeberg repos, ALWAYS try source URL FIRST (before bridge)
    // This ensures we get the latest content, not stale bridge cache
    const sourceUrlForPriorityFetch =
      effectiveSourceUrl ||
      repoData?.sourceUrl ||
      null;

    if (
      sourceUrlForPriorityFetch &&
      (sourceUrlForPriorityFetch.includes("github.com") ||
        sourceUrlForPriorityFetch.includes("gitlab.com") ||
        sourceUrlForPriorityFetch.includes("codeberg.org"))
    ) {
      try {
        const branchToUse =
          selectedBranch || repoData?.defaultBranch || "main";
        const apiUrl = `/api/git/file-content?sourceUrl=${encodeURIComponent(
          sourceUrlForPriorityFetch
        )}&path=${encodeURIComponent(path)}&branch=${encodeURIComponent(
          branchToUse
        )}`;
        console.log(
          `🌐 [fetchGithubRaw] Priority: Fetching from source (GitHub/GitLab/Codeberg) first: ${apiUrl}`
        );
        const resp = await fetch(apiUrl);
        if (resp.ok) {
          const data = await resp.json();
          if (data?.content !== undefined) {
            console.log(
              `✅ [fetchGithubRaw] Got latest content from source for ${path}`
            );
            return {
              content: data.content,
              url: null,
              isBinary: !!data.isBinary,
            };
          }
        } else {
          console.log(
            `⚠️ [fetchGithubRaw] Source fetch failed ${resp.status}, will try bridge`
          );
        }
      } catch (e) {
        console.warn(
          `⚠️ [fetchGithubRaw] Source fetch errored, will try bridge:`,
          e
        );
      }
    }

    // Strategy 2: Try git-nostr-bridge API
    // According to the working insights: "git-nostr-bridge is the primary method for repos that have been cloned locally"
    // Resolve ownerPubkey: check repoData, then localStorage, then decode npub, then resolveEntityToPubkey
    let ownerPubkey: string | null = (repoData as any)?.ownerPubkey;
    
    // If not in repoData, check localStorage
    if (!ownerPubkey || !/^[0-9a-f]{64}$/i.test(ownerPubkey)) {
      try {
        const repos = loadStoredRepos();
        const matchingRepo = repos.find((r) => {
          const entityMatch = r.entity === resolvedParams.entity || 
            (r.entity && resolvedParams.entity && r.entity.toLowerCase() === resolvedParams.entity.toLowerCase());
          const repoMatch = r.repo === resolvedParams.repo || r.slug === resolvedParams.repo || r.name === resolvedParams.repo;
          return entityMatch && repoMatch;
        });
        if (matchingRepo && matchingRepo.ownerPubkey) {
          ownerPubkey = matchingRepo.ownerPubkey;
          if (ownerPubkey) {
            console.log(`✅ [fetchGithubRaw] Found ownerPubkey in localStorage: ${ownerPubkey.slice(0, 8)}...`);
          }
        }
      } catch (e) {
        console.warn(`⚠️ [fetchGithubRaw] Error checking localStorage for ownerPubkey:`, e);
      }
    }
    
    // If still not found, decode npub from resolvedParams.entity
    if (!ownerPubkey || !/^[0-9a-f]{64}$/i.test(ownerPubkey)) {
      if (resolvedParams.entity && resolvedParams.entity.startsWith("npub")) {
        try {
          const decoded = nip19.decode(resolvedParams.entity);
          if (decoded.type === "npub" && /^[0-9a-f]{64}$/i.test(decoded.data as string)) {
            ownerPubkey = decoded.data as string;
            console.log(`✅ [fetchGithubRaw] Decoded ownerPubkey from npub: ${ownerPubkey.slice(0, 8)}...`);
          }
        } catch (e) {
          console.warn(`⚠️ [fetchGithubRaw] Failed to decode npub:`, e);
        }
      }
    }
    
    // Final fallback: use resolveEntityToPubkey utility
    if (!ownerPubkey || !/^[0-9a-f]{64}$/i.test(ownerPubkey)) {
      const resolved = resolveEntityToPubkey(resolvedParams.entity, repoData);
      if (resolved && /^[0-9a-f]{64}$/i.test(resolved)) {
        ownerPubkey = resolved;
        console.log(`⚠️ [fetchGithubRaw] Using resolveEntityToPubkey fallback: ${ownerPubkey.slice(0, 8)}...`);
      }
    }
    
    if (ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey)) {
      // CRITICAL: Use repositoryName from Nostr event (exact name used by git-nostr-bridge)
      // Priority: repositoryName > repo > slug > name > decodedRepo
      // The bridge uses repositoryName from the event, not the human-readable name
      const repoDataAny = repoData as any; // Type assertion for dynamic fields (repo/slug may exist but aren't in type)
      let repoName = repoDataAny?.repositoryName || repoDataAny?.['repo'] || repoDataAny?.['slug'] || repoDataAny?.name || String(decodedRepo || "");
      
      // Extract repo name (handle paths like "gitnostr.com/gitworkshop")
      if (repoName.includes('/')) {
        const parts = repoName.split('/');
        repoName = parts[parts.length - 1] || repoName;
      }
      repoName = repoName.replace(/\.git$/, '');
      
      const branch = selectedBranch || repoData?.defaultBranch || "main";
      const apiUrl = `/api/nostr/repo/file-content?ownerPubkey=${encodeURIComponent(ownerPubkey)}&repo=${encodeURIComponent(repoName)}&path=${encodeURIComponent(path)}&branch=${encodeURIComponent(branch)}`;
      
      // console.log(`🔍 [fetchGithubRaw] Trying git-nostr-bridge API: ${apiUrl}`, { ownerPubkey: ownerPubkey.slice(0, 8) + "...", actualRepoName: repoName, decodedRepoFromUrl: decodedRepo, branch, path });
      
      try {
        const response = await fetch(apiUrl);
        if (response.ok) {
          const data = await response.json();
          if (data.content !== undefined) {
            // Check if it's a binary file
            const isBinary = data.isBinary || false;
            if (isBinary) {
              // For binary files, convert base64 to data URL
              const ext = path.split('.').pop()?.toLowerCase() || '';
              const mimeTypes: Record<string, string> = {
                'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif',
                'webp': 'image/webp', 'svg': 'image/svg+xml', 'ico': 'image/x-icon',
                'pdf': 'application/pdf', 'woff': 'font/woff', 'woff2': 'font/woff2',
                'ttf': 'font/ttf', 'otf': 'font/otf', 'mp4': 'video/mp4', 'mp3': 'audio/mpeg', 'wav': 'audio/wav',
              };
              const mimeType = mimeTypes[ext] || 'application/octet-stream';
              const dataUrl = `data:${mimeType};base64,${data.content}`;
              console.log(`✅ [fetchGithubRaw] Successfully fetched binary file from git-nostr-bridge API: ${path}`);
              return { content: null, url: dataUrl, isBinary: true };
            } else {
              console.log(`✅ [fetchGithubRaw] Successfully fetched from git-nostr-bridge API: ${path}`);
              return { content: data.content, url: null, isBinary: false };
            }
          } else {
            console.log(`⚠️ [fetchGithubRaw] git-nostr-bridge API returned OK but no content: ${path}`, data);
          }
        } else if (response.status === 404 || response.status === 500) {
          // Repo not cloned yet OR repo exists but is empty/corrupted - check if GRASP server and trigger clone
          // 500 errors can occur when repo exists but has no valid branches or is corrupted
          const cloneUrls = (repoData as any)?.clone || [];
          // Use centralized isGraspServer function which includes pattern matching (git., git-\d+.)
          const { isGraspServer: isGraspServerFn } = require("@/lib/utils/grasp-servers");
          const graspCloneUrl = cloneUrls.find((url: string) => 
            isGraspServerFn(url) &&
            (url.startsWith('http://') || url.startsWith('https://'))
          );
          
          if (graspCloneUrl) {
            const errorType = response.status === 404 ? "not cloned yet" : "empty or corrupted";
            console.log(`💡 [fetchGithubRaw] GRASP repo ${errorType} (${response.status}), triggering clone...`);
            try {
              const cloneResponse = await fetch("/api/nostr/repo/clone", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ cloneUrl: graspCloneUrl, ownerPubkey, repo: repoName })
              });
              if (cloneResponse.ok) {
                console.log(`✅ [fetchGithubRaw] Clone triggered, polling for file...`);
                // Poll for file (max 5 attempts, 1s delay - reduced from 10 attempts/2s to speed up)
                for (let attempt = 1; attempt <= 5; attempt++) {
                  await new Promise(resolve => setTimeout(resolve, 1000));
                  console.log(`🔍 [fetchGithubRaw] Polling for file (attempt ${attempt}/5)...`);
                  try {
                    const pollResponse = await fetch(apiUrl);
                    if (pollResponse.ok) {
                      const pollData = await pollResponse.json();
                      if (pollData.content !== undefined) {
                        const isBinary = pollData.isBinary || false;
                        if (isBinary) {
                          const ext = path.split('.').pop()?.toLowerCase() || '';
                          const mimeTypes: Record<string, string> = {
                            'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif',
                            'webp': 'image/webp', 'svg': 'image/svg+xml', 'ico': 'image/x-icon',
                            'pdf': 'application/pdf', 'woff': 'font/woff', 'woff2': 'font/woff2',
                            'ttf': 'font/ttf', 'otf': 'font/otf', 'mp4': 'video/mp4', 'mp3': 'audio/mpeg', 'wav': 'audio/wav',
                          };
                          const mimeType = mimeTypes[ext] || 'application/octet-stream';
                          const dataUrl = `data:${mimeType};base64,${pollData.content}`;
                          console.log(`✅ [fetchGithubRaw] File available after clone (binary)!`);
                          return { content: null, url: dataUrl, isBinary: true };
                        } else {
                          console.log(`✅ [fetchGithubRaw] File available after clone!`);
                          return { content: pollData.content, url: null, isBinary: false };
                        }
                      }
                    } else if (pollResponse.status !== 404) {
                      const errorText = await pollResponse.text().catch(() => "");
                      console.log(`⚠️ [fetchGithubRaw] Poll attempt ${attempt} failed: ${pollResponse.status} - ${errorText.substring(0, 100)}`);
                    }
                  } catch (pollError: any) {
                    console.warn(`⚠️ [fetchGithubRaw] Poll attempt ${attempt} error:`, pollError.message);
                  }
                }
                console.log(`⚠️ [fetchGithubRaw] File not available after clone (tried 5 times), user can retry`);
              } else {
                const cloneErrorData = await cloneResponse.json().catch(() => ({ error: "Unknown error" }));
                console.warn(`⚠️ [fetchGithubRaw] Clone API failed: ${cloneResponse.status} -`, cloneErrorData);
              }
            } catch (cloneError: any) {
              console.warn(`⚠️ [fetchGithubRaw] Failed to trigger clone:`, cloneError.message);
            }
          }
        } else {
          const errorText = await response.text();
          console.log(`⚠️ [fetchGithubRaw] git-nostr-bridge API failed: ${response.status} - ${errorText.substring(0, 200)}`);
        }
      } catch (error: any) {
        console.error(`❌ [fetchGithubRaw] Error fetching from git-nostr-bridge API:`, error.message);
      }
    }

    // Strategy 3: Try external git servers via API proxy
    // According to the working insights: "External Git Servers as Fallback"
    // GitHub, GitLab, Codeberg APIs are used when repo is imported from external git server
    // CRITICAL: Iterate through all successful sources if available, for fallback during file opening
    // IMPORTANT: Only use sources that actually succeeded in fetching files (not sources that returned "No files found")
    const successfulSources = (repoData as any)?.successfulSources || [];
    const sourcesToTry: Array<{ sourceUrl: string; source: any }> = [];
    
    // Priority 1: Use successful sources array (sources that successfully fetched file lists)
    // CRITICAL: Filter out sources that failed - only include sources that have files
    if (successfulSources.length > 0) {
      console.log(`🔍 [fetchGithubRaw] Found ${successfulSources.length} successful sources, filtering for sources with files...`);
      successfulSources.forEach((successfulSource: any) => {
        // CRITICAL: Only add sources that actually have files (not sources that returned "No files found")
        if (successfulSource.sourceUrl && successfulSource.files && Array.isArray(successfulSource.files) && successfulSource.files.length > 0) {
          sourcesToTry.push({
            sourceUrl: successfulSource.sourceUrl,
            source: successfulSource.source,
          });
          console.log(`✅ [fetchGithubRaw] Added successful source to try: ${successfulSource.sourceUrl} (${successfulSource.files.length} files)`);
        } else {
          console.log(`⏭️ [fetchGithubRaw] Skipping source (no files): ${successfulSource.sourceUrl || 'unknown'}`);
        }
      });
    }
    
    // Priority 2: Fallback to sourceUrl/forkedFrom/clone URLs if no successful sources
    if (sourcesToTry.length === 0) {
      let sourceUrl = repoData?.sourceUrl || repoData?.forkedFrom || 
        ((repoData as any)?.clone && Array.isArray((repoData as any).clone) && (repoData as any).clone.length > 0 
          ? (repoData as any).clone.find((url: string) => url.includes('github.com') || url.includes('gitlab.com') || url.includes('codeberg.org'))
          : null);
      
      // CRITICAL: Normalize SSH URLs (git@host:path) to HTTPS format if found
      if (sourceUrl) {
        const sshMatch = sourceUrl.match(/^git@([^:]+):(.+)$/);
        if (sshMatch) {
          const [, host, path] = sshMatch;
          sourceUrl = `https://${host}/${path}`.replace(/\.git$/, '');
          console.log(`🔄 [fetchGithubRaw] Normalized SSH sourceUrl to HTTPS: ${sourceUrl}`);
        }
      }
      
      // CRITICAL: If sourceUrl not in repoData, check localStorage directly
      if (!sourceUrl) {
        try {
          const repos = loadStoredRepos();
          const matchingRepo = repos.find((r: any) => {
            const entityMatch = r.entity === resolvedParams.entity || 
              (r.entity && resolvedParams.entity && r.entity.toLowerCase() === resolvedParams.entity.toLowerCase());
            const repoMatch = r.repo === resolvedParams.repo || r.slug === resolvedParams.repo || r.name === resolvedParams.repo;
            return entityMatch && repoMatch;
          });
          if (matchingRepo) {
            // Priority 1: Use sourceUrl or forkedFrom if available
            sourceUrl = matchingRepo.sourceUrl || matchingRepo.forkedFrom;
            // Priority 2: If no sourceUrl, try to find GitHub/GitLab/Codeberg clone URL (preferred)
            // CRITICAL: Only use GitHub/GitLab/Codeberg URLs as sourceUrl - Nostr git servers are handled by multi-source fetcher
            if (!sourceUrl && matchingRepo.clone && Array.isArray(matchingRepo.clone) && matchingRepo.clone.length > 0) {
              const gitCloneUrl = matchingRepo.clone.find((url: string) => 
                url.includes('github.com') || url.includes('gitlab.com') || url.includes('codeberg.org')
              );
              if (gitCloneUrl) {
                // CRITICAL: Normalize SSH URLs (git@host:path) to HTTPS format
                const sshMatch = gitCloneUrl.match(/^git@([^:]+):(.+)$/);
                if (sshMatch) {
                  const [, host, path] = sshMatch;
                  sourceUrl = `https://${host}/${path}`.replace(/\.git$/, '');
                } else {
                  sourceUrl = gitCloneUrl.replace(/\.git$/, '');
                }
              }
            }
            // Note: We don't use Nostr git server URLs (gittr.space, etc.) as sourceUrl
            // Those are handled by the multi-source fetcher or git-nostr-bridge
            console.log(`🔍 [fetchGithubRaw] Found sourceUrl in localStorage:`, {
              sourceUrl,
              fromSourceUrl: !!matchingRepo.sourceUrl,
              fromForkedFrom: !!matchingRepo.forkedFrom,
              fromClone: !!(matchingRepo.sourceUrl || matchingRepo.forkedFrom) ? false : !!(matchingRepo.clone && Array.isArray(matchingRepo.clone) && matchingRepo.clone.length > 0),
              cloneUrls: matchingRepo.clone || [],
            });
          }
        } catch (e) {
          console.error(`❌ [fetchGithubRaw] Error checking localStorage for sourceUrl:`, e);
        }
      }
      
      // CRITICAL: Only add sourceUrl if it's actually defined and not empty
      if (sourceUrl && typeof sourceUrl === 'string' && sourceUrl.trim().length > 0) {
        sourcesToTry.push({
          sourceUrl: sourceUrl.trim(),
          source: null,
        });
        console.log(`✅ [fetchGithubRaw] Added sourceUrl to sourcesToTry: ${sourceUrl}`);
      } else {
        console.log(`⚠️ [fetchGithubRaw] sourceUrl is invalid (undefined, empty, or not a string):`, sourceUrl);
      }
    }
    
    // Try each source in order until one succeeds
    for (const sourceInfo of sourcesToTry) {
      let sourceUrl = sourceInfo.sourceUrl;
      if (!sourceUrl) continue;
      
      // CRITICAL: Normalize SSH URLs (git@host:path) to HTTPS format for matching
      const sshMatch = sourceUrl.match(/^git@([^:]+):(.+)$/);
      if (sshMatch) {
        const [, host, path] = sshMatch;
        sourceUrl = `https://${host}/${path}`;
        console.log(`🔄 [fetchGithubRaw] Normalized SSH URL to HTTPS: ${sourceUrl}`);
      }
      
      console.log(`🔍 [fetchGithubRaw] Trying source: ${sourceUrl}`, {
        sourceIndex: sourcesToTry.indexOf(sourceInfo) + 1,
        totalSources: sourcesToTry.length,
      });
      try {
        const githubMatch = sourceUrl.match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?$/);
        const gitlabMatch = sourceUrl.match(/gitlab\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?$/);
        const codebergMatch = sourceUrl.match(/codeberg\.org\/([^\/]+)\/([^\/]+?)(?:\.git)?$/);
        
        console.log(`🔍 [fetchGithubRaw] Checking sourceUrl for file fetch:`, {
          sourceUrl,
          hasGithubMatch: !!githubMatch,
          hasGitlabMatch: !!gitlabMatch,
          fromSourceUrl: !!repoData?.sourceUrl,
          fromForkedFrom: !!repoData?.forkedFrom,
          fromClone: !!(repoData?.sourceUrl || repoData?.forkedFrom) ? false : !!((repoData as any)?.clone && Array.isArray((repoData as any).clone) && (repoData as any).clone.length > 0),
        });
        
      // Use selectedBranch, fallback to defaultBranch, then main/master
      const branch = selectedBranch || repoData?.defaultBranch || "main";
      const branchesToTry = [branch, "main", "master"].filter((b, i, arr) => arr.indexOf(b) === i); // dedupe
      
        if (githubMatch) {
          const [, owner, repo] = githubMatch;
          console.log(`🔍 [fetchGithubRaw] Trying GitHub via API proxy for: ${owner}/${repo}`, { branchesToTry });
      for (const tryBranch of branchesToTry) {
            // Use backend API proxy to avoid CORS issues (consistent with GitLab)
            const apiUrl = `/api/git/file-content?sourceUrl=${encodeURIComponent(sourceUrl)}&path=${encodeURIComponent(path)}&branch=${encodeURIComponent(tryBranch)}`;
            const r = await fetch(apiUrl);
        if (r.ok) {
              const data = await r.json();
              console.log(`✅ [fetchGithubRaw] Successfully fetched from GitHub via API proxy: ${path}`);
              if (data.isBinary) {
                // For binary files, convert base64 to data URL
                const ext = path.split('.').pop()?.toLowerCase() || '';
                const mimeTypes: Record<string, string> = {
                  // Images
                  'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif',
                  'webp': 'image/webp', 'svg': 'image/svg+xml', 'ico': 'image/x-icon', 'bmp': 'image/bmp',
                  'tiff': 'image/tiff', 'tif': 'image/tiff', 'avif': 'image/avif', 'heic': 'image/heic',
                  // Videos
                  'mp4': 'video/mp4', 'webm': 'video/webm', 'ogv': 'video/ogg', 'mov': 'video/quicktime',
                  'avi': 'video/x-msvideo', 'mkv': 'video/x-matroska', 'wmv': 'video/x-ms-wmv',
                  // Audio
                  'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'flac': 'audio/flac', 'aac': 'audio/aac',
                  'ogg': 'audio/ogg', 'opus': 'audio/opus', 'm4a': 'audio/mp4',
                  // Documents
                  'pdf': 'application/pdf', 'doc': 'application/msword', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  'xls': 'application/vnd.ms-excel', 'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  'ppt': 'application/vnd.ms-powerpoint', 'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                  // Fonts
                  'woff': 'font/woff', 'woff2': 'font/woff2', 'ttf': 'font/ttf', 'otf': 'font/otf', 'eot': 'application/vnd.ms-fontobject',
                  // Archives
                  'zip': 'application/zip', 'tar': 'application/x-tar', 'gz': 'application/gzip',
                  'bz2': 'application/x-bzip2', 'xz': 'application/x-xz', '7z': 'application/x-7z-compressed',
                  'rar': 'application/x-rar-compressed', 'dmg': 'application/x-apple-diskimage',
                  // Installers & Executables (Release Assets)
                  'exe': 'application/x-msdownload', 'msi': 'application/x-ms-installer', 'msix': 'application/msix',
                  'pkg': 'application/x-newton-compatible-pkg', 'deb': 'application/vnd.debian.binary-package',
                  'rpm': 'application/x-rpm', 'apk': 'application/vnd.android.package-archive', 'ipa': 'application/octet-stream',
                  'appimage': 'application/x-executable', 'snap': 'application/vnd.snap',
                  // Other binaries
                  'bin': 'application/octet-stream', 'dll': 'application/x-msdownload', 'so': 'application/x-sharedlib',
                  'dylib': 'application/x-mach-binary', 'jar': 'application/java-archive', 'wasm': 'application/wasm',
                };
                const mimeType = mimeTypes[ext] || 'application/octet-stream';
                const dataUrl = `data:${mimeType};base64,${data.content}`;
                return { content: null, url: dataUrl, isBinary: true };
              }
              return { content: data.content, url: null, isBinary: false };
            } else {
              console.log(`⚠️ [fetchGithubRaw] GitHub API proxy failed: ${apiUrl} - ${r.status}`);
            }
          }
        } else if (gitlabMatch) {
          const [, owner, repo] = gitlabMatch;
          console.log(`🔍 [fetchGithubRaw] Trying GitLab via API proxy for: ${owner}/${repo}`, { branchesToTry });
          for (const tryBranch of branchesToTry) {
            // Use backend API proxy to avoid CORS issues
            const apiUrl = `/api/git/file-content?sourceUrl=${encodeURIComponent(sourceUrl)}&path=${encodeURIComponent(path)}&branch=${encodeURIComponent(tryBranch)}`;
            const r = await fetch(apiUrl);
            if (r.ok) {
              const data = await r.json();
              console.log(`✅ [fetchGithubRaw] Successfully fetched from GitLab via API proxy: ${path}`);
              if (data.isBinary) {
                // For binary files, convert base64 to data URL
                const ext = path.split('.').pop()?.toLowerCase() || '';
                const mimeTypes: Record<string, string> = {
                  'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif',
                  'webp': 'image/webp', 'svg': 'image/svg+xml', 'ico': 'image/x-icon',
                  'pdf': 'application/pdf', 'woff': 'font/woff', 'woff2': 'font/woff2',
                  'ttf': 'font/ttf', 'otf': 'font/otf', 'mp4': 'video/mp4', 'mp3': 'audio/mpeg', 'wav': 'audio/wav',
                };
                const mimeType = mimeTypes[ext] || 'application/octet-stream';
                const dataUrl = `data:${mimeType};base64,${data.content}`;
                return { content: null, url: dataUrl, isBinary: true };
              }
              return { content: data.content, url: null, isBinary: false };
            } else {
              console.log(`⚠️ [fetchGithubRaw] GitLab API proxy failed: ${apiUrl} - ${r.status}`);
            }
          }
        } else if (codebergMatch) {
          const [, owner, repo] = codebergMatch;
          console.log(`🔍 [fetchGithubRaw] Trying Codeberg via API proxy for: ${owner}/${repo}`, { branchesToTry });
          for (const tryBranch of branchesToTry) {
            // Use backend API proxy to avoid CORS issues
            const apiUrl = `/api/git/file-content?sourceUrl=${encodeURIComponent(sourceUrl)}&path=${encodeURIComponent(path)}&branch=${encodeURIComponent(tryBranch)}`;
            const r = await fetch(apiUrl);
            if (r.ok) {
              const data = await r.json();
              console.log(`✅ [fetchGithubRaw] Successfully fetched from Codeberg via API proxy: ${path}`);
              if (data.isBinary) {
                // For binary files, convert base64 to data URL
                const ext = path.split('.').pop()?.toLowerCase() || '';
                const mimeTypes: Record<string, string> = {
                  'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif',
                  'webp': 'image/webp', 'svg': 'image/svg+xml', 'ico': 'image/x-icon',
                  'pdf': 'application/pdf', 'woff': 'font/woff', 'woff2': 'font/woff2',
                  'ttf': 'font/ttf', 'otf': 'font/otf', 'mp4': 'video/mp4', 'mp3': 'audio/mpeg', 'wav': 'audio/wav',
                };
                const mimeType = mimeTypes[ext] || 'application/octet-stream';
                const dataUrl = `data:${mimeType};base64,${data.content}`;
                return { content: null, url: dataUrl, isBinary: true };
              }
              return { content: data.content, url: null, isBinary: false };
            } else {
              console.log(`⚠️ [fetchGithubRaw] Codeberg API proxy failed: ${apiUrl} - ${r.status}`);
            }
          }
        } else {
          console.log(`⚠️ [fetchGithubRaw] sourceUrl is not GitHub, GitLab, or Codeberg: ${sourceUrl}, trying next source...`);
          // Continue to next source in loop
          continue;
        }
      } catch (error: any) {
        console.error(`❌ [fetchGithubRaw] Error fetching from source ${sourceUrl}:`, error.message);
        // Continue to next source in loop
        continue;
      }
    }
    
    // If we get here, all sources failed
    if (sourcesToTry.length === 0) {
      console.log(`⚠️ [fetchGithubRaw] No sourceUrl, forkedFrom, or clone URL found for fetching file:`, {
        hasSourceUrl: !!repoData?.sourceUrl,
        hasForkedFrom: !!repoData?.forkedFrom,
        hasClone: !!((repoData as any)?.clone && Array.isArray((repoData as any).clone) && (repoData as any).clone.length > 0),
        cloneUrls: (repoData as any)?.clone || [],
      });
    } else {
      console.log(`❌ [fetchGithubRaw] All ${sourcesToTry.length} sources failed to fetch file: ${path}`);
    }
    
    // All strategies failed
    console.error(`❌ [fetchGithubRaw] All strategies failed for: ${path}`);
    return { content: null, url: null, isBinary: false };
  }

  function getFileType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase() || '';
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tiff', 'tif', 'heic', 'heif', 'apng'];
    const videoExts = ['mp4', 'webm', 'ogg', 'ogv', 'mov', 'avi', 'mkv', 'flv', 'wmv', 'm4v', '3gp', '3g2', 'asf', 'rm', 'rmvb', 'vob'];
    const audioExts = ['mp3', 'wav', 'ogg', 'oga', 'flac', 'aac', 'm4a', 'wma', 'opus', 'amr', 'au', 'ra', 'mid', 'midi'];
    const pdfExts = ['pdf'];
    const htmlExts = ['html', 'htm', 'xhtml', 'shtml'];
    const markdownExts = ['md', 'markdown', 'mdown', 'mkdn', 'mkd'];
    const codeExts = ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'php', 'rb', 'go', 'rs', 'swift', 'kt', 'scala', 'clj', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'ps', 'vbs', 'r', 'm', 'mm', 'dart', 'lua', 'pl', 'pm', 'sql', 'hs', 'elm', 'ex', 'exs', 'erl', 'ml', 'mli', 'fs', 'fsx', 'vb', 'dart', 'vim', 'vimrc'];
    const jsonExts = ['json', 'jsonc', 'json5'];
    const xmlExts = ['xml', 'xsl', 'xslt', 'xsd', 'rss', 'atom'];
    const yamlExts = ['yml', 'yaml'];
    const csvExts = ['csv', 'tsv'];
    const textExts = ['txt', 'text', 'log', 'ini', 'conf', 'config', 'cfg', 'properties', 'env', 'gitignore', 'gitattributes', 'dockerignore', 'editorconfig'];
    
    if (imageExts.includes(ext)) return 'image';
    if (videoExts.includes(ext)) return 'video';
    if (audioExts.includes(ext)) return 'audio';
    if (pdfExts.includes(ext)) return 'pdf';
    if (htmlExts.includes(ext)) return 'html';
    if (markdownExts.includes(ext)) return 'markdown';
    if (jsonExts.includes(ext)) return 'json';
    if (xmlExts.includes(ext)) return 'xml';
    if (yamlExts.includes(ext)) return 'yaml';
    if (csvExts.includes(ext)) return 'csv';
    if (codeExts.includes(ext)) return 'code';
    if (textExts.includes(ext)) return 'text';
    return 'text'; // Default to text for unknown extensions (will try to render as text)
  }

  function getFileBadge(fileName: string): JSX.Element | null {
    const name = fileName.toLowerCase();
    // Theme-aware colors: Use colors that contrast with text-gray-400 (default text color)
    // For dark theme: text-gray-400 is light gray, so use vibrant but distinct colors
    const pill = (label: string, color: string) => (
      <span className={`ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] ${color} bg-white/5 border border-white/10`}>{label}</span>
    );
    if (name === "readme.md" || name === "readme") return pill("readme", "text-purple-400");
    if (name === "license" || name === "license.md") return pill("license", "text-emerald-400");
    if (name === "manifest.json" || name.endsWith("/manifest.json")) return pill("manifest", "text-cyan-400");
    if (name === "package.json") return pill("npm", "text-rose-400");
    if (name === "yarn.lock") return pill("yarn", "text-blue-400");
    if (name === "pnpm-lock.yaml") return pill("pnpm", "text-yellow-400");
    if (name === "tsconfig.json") return pill("tsconfig", "text-sky-400");
    if (name === "dockerfile") return pill("docker", "text-cyan-400");
    if (name === "docker-compose.yml" || name === "docker-compose.yaml") return pill("compose", "text-cyan-400");
    if (name === "makefile") return pill("make", "text-amber-400");
    if (name === ".env" || name.startsWith(".env")) return pill("env", "text-lime-400");
    if (name === "go.mod") return pill("go.mod", "text-cyan-400");
    if (name === "cargo.toml") return pill("cargo", "text-orange-400");
    if (name.endsWith(".workflow") || name.includes(".github/workflows/")) return pill("ci", "text-emerald-400");
    return null;
  }

  async function openFile(path: string, skipURLUpdate = false) {
    setSelectedFile(path);
    if (!skipURLUpdate) {
      updateURL({ file: path });
    }
    setLoadingFile(true);
    setFileContent("");
    setProposeEdit(false);
    setProposedContent("");
    
    // Normalize path helper function (remove leading/trailing slashes, handle relative paths)
    const normalizePath = (p: string) => p.replace(/^\/+/, '').replace(/\/+/g, '/');
    const normalizedPath = normalizePath(path);
    
    // Use override if present - check both localStorage directly and state
    const keyBase = `${resolvedParams.entity}__${resolvedParams.repo}`;
    // Check localStorage directly to ensure we have the latest
    const savedOverrides = JSON.parse(
      localStorage.getItem(`gittr_overrides__${keyBase}`) || 
      localStorage.getItem(`gittr_repo_overrides__${keyBase}`) || 
      "{}"
    );
    // Also check state as fallback
    const currentOverrides = Object.keys(savedOverrides).length > 0 ? savedOverrides : overrides;
    if (currentOverrides && currentOverrides[path] !== undefined && currentOverrides[path] !== null) {
      const overrideContent = currentOverrides[path] || "";
      
      // Check if this file is binary by checking the file entry
      const repoData = repoDataRef.current;
      if (repoData && repoData.files) {
        const fileEntry = repoData.files.find((f: any) => {
          const fPath = normalizePath(f.path || "");
          return fPath === normalizedPath || 
                 fPath === path || 
                 fPath === `/${path}` || 
                 fPath.endsWith(`/${normalizedPath}`) ||
                 fPath.endsWith(`/${path}`) ||
                 normalizedPath === fPath ||
                 path === fPath;
        });
        
        if (fileEntry) {
          const isBinary = (fileEntry as any).isBinary || (fileEntry as any).binary || false;
          
          if (isBinary && overrideContent && !overrideContent.startsWith('data:')) {
            // Convert base64 to data URL for binary files
            const ext = path.split('.').pop()?.toLowerCase() || '';
            const mimeTypes: Record<string, string> = {
              'png': 'image/png',
              'jpg': 'image/jpeg',
              'jpeg': 'image/jpeg',
              'gif': 'image/gif',
              'webp': 'image/webp',
              'svg': 'image/svg+xml',
              'ico': 'image/x-icon',
              'pdf': 'application/pdf',
              'woff': 'font/woff',
              'woff2': 'font/woff2',
              'ttf': 'font/ttf',
              'otf': 'font/otf',
              'mp4': 'video/mp4',
              'mp3': 'audio/mpeg',
              'wav': 'audio/wav',
            };
            const mimeType = mimeTypes[ext] || 'application/octet-stream';
            const dataUrl = `data:${mimeType};base64,${overrideContent}`;
            setFileContent(dataUrl);
            setLoadingFile(false);
            return;
          }
        }
      }
      
      // For text files or if file entry not found, use content as-is
      setFileContent(overrideContent);
      setLoadingFile(false);
      return;
    }
    const result = await fetchGithubRaw(path);
    if (result.isBinary && result.url) {
      setFileContent(result.url);
      failedFilesRef.current.delete(path); // Success - remove from failed set
    } else if (result.content) {
      setFileContent(result.content);
      failedFilesRef.current.delete(path); // Success - remove from failed set
    } else {
      setFileContent("(unable to load file)");
      failedFilesRef.current.add(path); // Mark as failed to prevent retry loop
    }
    setLoadingFile(false);
  }
  
  // Sync URL when branch/path changes - only if different and not updating from URL
  useEffect(() => {
    if (updatingFromURLRef.current || isUpdatingURLRef.current) return;
    if (selectedBranch && urlBranch !== selectedBranch) {
      updateURL({ branch: selectedBranch });
    }
  }, [selectedBranch, urlBranch, updateURL]);
  
  useEffect(() => {
    if (updatingFromURLRef.current || isUpdatingURLRef.current) return;
    if (currentPath !== urlPath) {
      updateURL({ path: currentPath });
    }
  }, [currentPath, urlPath, updateURL]);
  
  // Edit/Delete handlers
  const editCurrentFile = useCallback(() => {
    if (!selectedFile) return;
    const type = getFileType(selectedFile);
    const isBinary = ["image","video","audio","pdf","binary"].includes(type);
    if (isBinary) {
      alert("Binary files cannot be edited inline. Please open an issue or upload via PR.");
      return;
    }
    // Switch to inline edit mode with current content prefilled
    setProposeEdit(true);
    setProposedContent(fileContent || "");
  }, [selectedFile, fileContent]);

  const deleteCurrentFile = useCallback(() => {
    if (!selectedFile) return;
    if (!confirm(`Delete ${selectedFile}? This will apply locally.`)) return;
    try {
      const nextDeleted = deletedPaths.includes(selectedFile) ? deletedPaths : [...deletedPaths, selectedFile];
      setDeletedPaths(nextDeleted);
      saveRepoDeletedPaths(resolvedParams.entity, resolvedParams.repo, nextDeleted);
      
      // CRITICAL: Mark repo as having unpushed edits so push button appears
      // This ensures the "Push to Nostr" button is shown after deleting files
      markRepoAsEdited(resolvedParams.repo, resolvedParams.entity);
      console.log(`🗑️ [Delete File] Marked repo as having unpushed edits after deleting: ${selectedFile}`);
      
      setSelectedFile(null);
      setFileContent("");
      setProposeEdit(false);
      setProposedContent("");
    } catch (e) {
      console.error("Failed to delete file:", e);
    }
  }, [selectedFile, deletedPaths, resolvedParams.entity, resolvedParams.repo]);

  // Memoize BranchTagSwitcher callbacks to prevent infinite loops
  const handleBranchSelect = useCallback((branch: string) => {
    console.log("🔄 [Branch Switch] Switching to branch:", branch);
    setSelectedBranch(branch);
    updateURL({ branch, file: null, path: "" });
    setCurrentPath("");
    setSelectedFile(null);
    setFileContent("");
    const repos = loadStoredRepos();
    const repo = repos.find((r: any) => 
      r.entity === resolvedParams.entity && (r.repo === resolvedParams.repo || r.slug === resolvedParams.repo)
    );
    if (repo) {
      setRepoData(prev => prev ? { ...prev, defaultBranch: branch } : prev);
    }
    
    // CRITICAL: Trigger file refetch for the new branch
    // Clear the file fetch attempt ref so files are refetched
    const repoKey = `${resolvedParams.entity}/${resolvedParams.repo}`;
    fileFetchAttemptedRef.current = ""; // Clear so useEffect will refetch
    fileFetchInProgressRef.current = false; // Allow new fetch
    
    // Force a re-render to trigger file fetch useEffect
    // The useEffect will see the branch change and refetch files
    console.log("🔄 [Branch Switch] Cleared file fetch state, will refetch files for branch:", branch);
  }, [resolvedParams.entity, resolvedParams.repo, updateURL]);

  const handleTagSelect = useCallback((tag: string) => {
    console.log("Switching to tag:", tag);
  }, []);

  const handleCreateBranch = useCallback((branchName: string) => {
    try {
      const repos = loadStoredRepos();
      const idx = repos.findIndex((r) => {
        const found = findRepoByEntityAndName([r], resolvedParams.entity, resolvedParams.repo);
        return found !== undefined;
      });
      if (idx >= 0 && repos[idx]) {
        const set = new Set<string>(((repos[idx].branches) || []));
        set.add(branchName);
        repos[idx].branches = Array.from(set);
        saveStoredRepos(repos);
        setSelectedBranch(branchName);
        updateURL({ branch: branchName, file: null, path: "" });
        setCurrentPath("");
        setSelectedFile(null);
        setFileContent("");
        setRepoData(prev => prev ? ({
          ...prev,
          // @ts-ignore
          branches: Array.from(set),
        }) : prev);
      }
    } catch (error) {
      console.error("Failed to create branch:", error);
    }
  }, [resolvedParams.entity, resolvedParams.repo, updateURL]);
  
  const fileType = selectedFile ? getFileType(selectedFile) : null;
  // Check if fileContent is a URL (http/https) or data URL (data:)
  const isBinaryUrl = fileContent && (fileContent.startsWith('http') || fileContent.startsWith('data:'));
  // Check if it's specifically a data URL
  const isDataUrl = fileContent && fileContent.startsWith('data:');
  // For HTML and Markdown files, track whether we're showing preview or code view
  const [htmlViewMode, setHtmlViewMode] = useState<'preview' | 'code'>('preview');
  const [markdownViewMode, setMarkdownViewMode] = useState<'preview' | 'code'>('preview');

  const cloneUrlGroups = useMemo(() => {
    const rawCloneList = Array.isArray((repoData as any)?.clone)
      ? ((repoData as any)?.clone as string[])
      : [];
    const uniqueCloneUrls = Array.from(
      new Set(
        rawCloneList.filter(
          (url): url is string => typeof url === "string" && url.trim().length > 0
        )
      )
    );
    const httpCloneUrls = uniqueCloneUrls.filter(
      (url) => url.startsWith("http://") || url.startsWith("https://")
    );
    const sshCloneUrls = uniqueCloneUrls.filter((url) => url.startsWith("git@"));
    const nostrCloneUrls = uniqueCloneUrls.filter((url) => url.startsWith("nostr://"));
    return { httpCloneUrls, sshCloneUrls, nostrCloneUrls };
  }, [
    Array.isArray((repoData as any)?.clone)
      ? (repoData as any)?.clone.join("|")
      : "",
  ]);

  const { httpCloneUrls, sshCloneUrls, nostrCloneUrls } = cloneUrlGroups;

  // CRITICAL: Use refs to track content and only update when content actually changes
  // This prevents infinite re-renders in BranchTagSwitcher
  // Store previous raw arrays in refs for comparison, and mapped arrays in output refs
  const prevBranchesRawRef = useRef<any[] | undefined>(undefined);
  const prevTagsRawRef = useRef<any[] | undefined>(undefined);
  
  // Get current branches/tags
  const currentBranches = (repoData as any)?.branches;
  const currentTags = (repoData as any)?.tags;
  
  // Shallow comparison helper - only checks length and first few elements for performance
  const arraysEqual = (a: any[] | undefined, b: any[] | undefined): boolean => {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    // Only check first 5 elements for performance (most repos have < 5 branches)
    const checkCount = Math.min(5, a.length);
    for (let i = 0; i < checkCount; i++) {
      if (String(a[i]) !== String(b[i])) return false;
    }
    return true;
  };
  
  // Only update refs when content actually changed (not just reference)
  useLayoutEffect(() => {
    const branchesArray = Array.isArray(currentBranches) ? currentBranches : [];
    // Only update if content actually changed
    if (!arraysEqual(prevBranchesRawRef.current, branchesArray)) {
      prevBranchesRawRef.current = branchesArray;
      branchesRef.current = [...branchesArray];
    }
    
    // For tags, compare the raw array first before doing expensive mapping
    const tagsRawArray = Array.isArray(currentTags) ? currentTags : [];
    if (!arraysEqual(prevTagsRawRef.current, tagsRawArray)) {
      prevTagsRawRef.current = tagsRawArray;
      const tagsArray = tagsRawArray.map((t) => typeof t === "string" ? t : (typeof t === "object" && t !== null && ("name" in t || "tag" in t) ? String((t as { name?: string; tag?: string }).name || (t as { name?: string; tag?: string }).tag || t) : String(t)));
      tagsRef.current = tagsArray;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBranches, currentTags]); // Depend on references, but only update when content changed
  
  // Always return stable ref values (same array reference unless content changed)
  const branchesArray = branchesRef.current || [];
  const tagsArray = tagsRef.current || [];
  
  // Memoize selectedBranch and defaultBranch to ensure stable references
  const stableSelectedBranch = useMemo(() => selectedBranch || "main", [selectedBranch]);
  // Store defaultBranch in ref to avoid dependency on repoData
  const defaultBranchRef = useRef<string>("main");
  if (repoData?.defaultBranch && defaultBranchRef.current !== repoData.defaultBranch) {
    defaultBranchRef.current = repoData.defaultBranch;
  }
  const defaultBranch = defaultBranchRef.current;

  // Auto-scroll to file viewer when a file is opened and content is ready
  useEffect(() => {
    if (selectedFile && !loadingFile && fileViewerRef.current) {
      try {
        fileViewerRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch {}
    }
  }, [selectedFile, loadingFile, fileContent]);

  // Determine active tab from pathname
  const activeTab = useMemo(() => {
    if (!pathname) return "code";
    if (pathname.includes("/pulls")) return "pulls";
    if (pathname.includes("/issues")) return "issues";
    if (pathname.includes("/commits")) return "commits";
    if (pathname.includes("/releases")) return "releases";
    return "code";
  }, [pathname]);

  // CRITICAL: Check if repo was blocked due to corruption
  // For "tides" repos, ALWAYS check ownership even if not in localStorage
  const isCorruptedRepo = useMemo(() => {
    if (!mounted) return false;
    
    // CRITICAL: For "tides" repos, check ownership even if repoData exists
    // This catches repos that were loaded but shouldn't be displayed
    const repoName = decodedRepo.toLowerCase();
    if (repoName === "tides" && resolvedParams.entity && resolvedParams.entity.startsWith("npub")) {
      try {
        const decoded = nip19.decode(resolvedParams.entity);
        if (decoded.type === "npub") {
          const entityPubkey = (decoded.data as string).toLowerCase();
          
          // Check if repoData exists and has ownerPubkey
          if (repoData && (repoData as any).ownerPubkey) {
            const ownerPubkey = ((repoData as any).ownerPubkey as string).toLowerCase();
            if (ownerPubkey !== entityPubkey) {
              return true; // Corrupted - tides repo doesn't belong to this entity
            }
          } else {
            // Check localStorage
            try {
              const repos = loadStoredRepos();
              const repo = findRepoByEntityAndName<StoredRepo>(repos, resolvedParams.entity, decodedRepo);
              if (repo) {
                if (!repo.ownerPubkey || repo.ownerPubkey.toLowerCase() !== entityPubkey) {
                  return true; // Corrupted - tides repo doesn't belong to this entity
                }
              } else {
                // Repo not in localStorage - for tides, this is suspicious
                // But we can't block it without more info, so return false
                // The useEffect will handle blocking it when it tries to load
                return false;
              }
            } catch (e) {
              return false;
            }
          }
        }
      } catch (e) {
        return true; // Can't decode = corrupted
      }
    }
    
    // For non-tides repos or if repoData exists, check general corruption
    if (repoData) {
      return isRepoCorrupted(repoData as any, (repoData as any).nostrEventId || (repoData as any).lastNostrEventId);
    }
    
    // Check localStorage
    try {
      const repos = loadStoredRepos();
      const repo = findRepoByEntityAndName<StoredRepo>(repos, resolvedParams.entity, decodedRepo);
      if (repo) {
        return isRepoCorrupted(repo, repo.nostrEventId || repo.lastNostrEventId);
      }
    } catch (e) {
      return false;
    }
    
    return false;
  }, [mounted, repoData, resolvedParams.entity, decodedRepo]);

  if (isCorruptedRepo) {
    return (
      <div className="mt-4 p-8 text-center">
        <h1 className="text-2xl font-bold text-red-400 mb-4">Repository Not Found</h1>
        <p className="text-gray-400 mb-2">
          This repository appears to be corrupted or invalid.
        </p>
        <p className="text-sm text-gray-500 mb-4">
          The repository "{decodedRepo}" for entity "{resolvedParams.entity}" could not be displayed.
        </p>
        <Link href="/" className="text-purple-400 hover:text-purple-300 underline">
          Return to Homepage
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-4">
      {/* Navigation Tabs */}
      <div className="border-b border-[#383B42] mb-4">
        <nav className="flex gap-1 overflow-x-auto">
          <Link
            href={getRepoLink()}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === "code"
                ? "border-purple-500 text-purple-400"
                : "border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-600"
            }`}
          >
            <Code className="inline h-4 w-4 mr-1" />
            Code
          </Link>
          <Link
            href={getRepoLink("pulls")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === "pulls"
                ? "border-purple-500 text-purple-400"
                : "border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-600"
            }`}
          >
            <GitBranch className="inline h-4 w-4 mr-1" />
            Pulls
          </Link>
          <Link
            href={getRepoLink("issues")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === "issues"
                ? "border-purple-500 text-purple-400"
                : "border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-600"
            }`}
          >
            <CircleDot className="inline h-4 w-4 mr-1" />
            Issues
          </Link>
          <Link
            href={getRepoLink("commits")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === "commits"
                ? "border-purple-500 text-purple-400"
                : "border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-600"
            }`}
          >
            <History className="inline h-4 w-4 mr-1" />
            Commits
          </Link>
          <Link
            href={getRepoLink("releases")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === "releases"
                ? "border-purple-500 text-purple-400"
                : "border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-600"
            }`}
          >
            <Tag className="inline h-4 w-4 mr-1" />
            Releases
          </Link>
        </nav>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 xl:grid-cols-6 gap-6">
      <div className="col-span-1 lg:col-span-4 xl:col-span-5">
        <div className="flex justify-between flex-row">
          <div>
            <div className="flex items-center  gap-4 text-sm">
              <BranchTagSwitcher
                branches={branchesArray}
                tags={tagsArray}
                selectedBranch={stableSelectedBranch}
                defaultBranch={defaultBranch}
                onBranchSelect={handleBranchSelect}
                onTagSelect={handleTagSelect}
                onCreateBranch={handleCreateBranch}
              />
              <div className="hidden lg:inline-block">
                <GitBranch className="text-gray-400 inline h-4 w-4" /> {(((repoData as any)?.branches)||[]).length}{" "}
                <span className="text-gray-400">branches</span>
              </div>
              <div className="hidden lg:inline-block">
                <Tag className="text-gray-400 inline h-4 w-4" /> {(((repoData as any)?.tags)||[]).length}{" "}
                <span className="text-gray-400">tags</span>
              </div>
            </div>
          </div>
          <div className="hidden md:flex md:gap-2">
            <Button
              className="truncate h-8 !border-lightgray bg-dark"
              variant="outline"
              onClick={() => {
                if (repoData?.files && repoData.files.length > 0) {
                  window.location.href = getRepoLink("find");
                }
              }}
            >
              <Search className="h-4 w-4 mr-2" />
              Find in repo
            </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
            <Button
              className="truncate h-8 !border-lightgray bg-dark"
              variant="outline"
            >
              Add file
              <ChevronDown className="ml-2 h-4 w-4 text-white" />
            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem asChild>
                              <a href={getRepoLink("new-file")} onClick={(e) => { e.preventDefault(); window.location.href = getRepoLink("new-file"); }}>Create new file</a>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <a href={getRepoLink("upload")} onClick={(e) => { e.preventDefault(); window.location.href = getRepoLink("upload"); }}>Upload files</a>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button className="truncate h-8" variant="default">
              <Code className="mr-2 h-4 w-4 text-white" /> Code
              <ChevronDown className="ml-2 h-4 w-4 text-white" />
            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="w-56">
                            <DropdownMenuItem 
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                // Open SSH/Git help modal
                                const repos = loadStoredRepos();
                                const repo = repos.find((r: any) => 
                                  r.entity === resolvedParams.entity && (r.repo === resolvedParams.repo || r.slug === resolvedParams.repo)
                                );
                                const gitSshBase = (repo as StoredRepo & { gitSshBase?: string })?.gitSshBase || process.env.NEXT_PUBLIC_GIT_SSH_BASE || 
                                  (typeof window !== 'undefined' ? window.location.hostname : '');
                                if (!gitSshBase) {
                                  console.error("NEXT_PUBLIC_GIT_SSH_BASE is not configured in environment variables");
                                }
                                const sshUrl = `git@${gitSshBase}:${resolvedParams.entity}/${resolvedParams.repo}.git`;
                                const cloneUrls = (repoData as any)?.clone || [];
                                const httpsUrls = cloneUrls.filter((url: string) => typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://")));
                                const nostrUrls = cloneUrls.filter((url: string) => typeof url === "string" && url.startsWith("nostr://"));
                                
                                // Set state to show modal (render outside dropdown)
                                setShowSshGitHelp(true);
                                setSshGitHelpData({ entity: resolvedParams.entity, repo: resolvedParams.repo, sshUrl, httpsUrls, nostrUrls });
                              }}
                            >
                              <HelpCircle className="mr-2 h-4 w-4" />
                              SSH/Git Help
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={async () => {
                              try {
                                const { showToast } = await import("@/components/ui/toast");
                                // CRITICAL: Use NIP-34 clone URLs from event first, then fallback to sourceUrl or localhost
                                const cloneUrls = (repoData as any)?.clone || [];
                                let cloneUrl: string | null = null;
                                
                                // Priority 1: Use first NIP-34 clone URL (from event tags)
                                if (cloneUrls.length > 0) {
                                  // Filter out localhost and nostr:// URLs for HTTP clone
                                  const httpCloneUrl = cloneUrls.find((url: string) => 
                                    (url.startsWith('http://') || url.startsWith('https://')) &&
                                    !url.includes('localhost') && !url.includes('127.0.0.1')
                                  );
                                  if (httpCloneUrl && typeof httpCloneUrl === 'string') {
                                    cloneUrl = httpCloneUrl;
                                    // CRITICAL: Check if this is a base URL that needs the full path constructed
                                    // GRASP servers need: https://relay.ngit.dev/{ownerPubkey}/{repoName}.git
                                    // If URL doesn't have a path after the domain, it's a base URL
                                    try {
                                      const urlObj = new URL(cloneUrl);
                                      const hasPath = urlObj.pathname && urlObj.pathname !== '/' && urlObj.pathname.length > 1;
                                      
                                      if (!hasPath && ownerPubkeyForLink && /^[0-9a-f]{64}$/i.test(ownerPubkeyForLink)) {
                                        // Base URL - check if it's a GRASP server and construct full path
                                        const { isGraspServer } = require("@/lib/utils/grasp-servers");
                                        if (isGraspServer(cloneUrl)) {
                                          cloneUrl = `${cloneUrl}/${ownerPubkeyForLink}/${resolvedParams.repo}.git`;
                                } else {
                                          // Not a GRASP server, just add .git if missing
                                          if (!cloneUrl.endsWith('.git')) {
                                            cloneUrl = `${cloneUrl}.git`;
                                          }
                                        }
                                      } else if (hasPath && !cloneUrl.endsWith('.git') && !cloneUrl.endsWith('/')) {
                                        // Has path but missing .git suffix
                                        cloneUrl = `${cloneUrl}.git`;
                                      }
                                    } catch (e) {
                                      console.error("Failed to parse clone URL:", e);
                                    }
                                  } else {
                                    // If only nostr:// URLs, use the first one
                                    if (cloneUrls.length > 0 && typeof cloneUrls[0] === 'string') {
                                      cloneUrl = cloneUrls[0];
                                    }
                                  }
                                }
                                
                                // Priority 2: Use sourceUrl if no clone URLs
                                if (!cloneUrl && repoData?.sourceUrl && typeof repoData.sourceUrl === 'string') {
                                  cloneUrl = repoData.sourceUrl;
                                  if (!cloneUrl.endsWith('.git')) {
                                    cloneUrl = `${cloneUrl}.git`;
                                  }
                                }
                                
                                // Priority 3: Fallback to localhost (for local development)
                                if (!cloneUrl) {
                                  cloneUrl = `${window.location.origin}/${resolvedParams.entity}/${resolvedParams.repo}.git`;
                                }
                                
                                  await navigator.clipboard.writeText(`git clone ${cloneUrl}`);
                                  showToast("Clone URL copied!", "success");
                              } catch (err) {
                                const { showToast } = await import("@/components/ui/toast");
                                showToast("Failed to copy to clipboard", "error");
                              }
                            }}>
                              Copy clone URL
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={async () => {
                              // All gittr.space repos (native and imported) use gittr.space's SSH infrastructure
                              // Format: git@<gitSshBase>:<ownerPubkey>/<repoName>.git
                              // CRITICAL: Use full pubkey, not npub format
                              let sshUrl: string;
                              
                              // Try to get gitSshBase from repo data (from Nostr event)
                              const repos = loadStoredRepos();
                              const repo = repos.find((r: any) => 
                                r.entity === resolvedParams.entity && (r.repo === resolvedParams.repo || r.slug === resolvedParams.repo)
                              );
                              
                              const gitSshBase = (repo as StoredRepo & { gitSshBase?: string })?.gitSshBase || process.env.NEXT_PUBLIC_GIT_SSH_BASE || "gittr.space";
                              
                              // CRITICAL: Use ownerPubkeyForLink (full pubkey) instead of resolvedParams.entity (might be npub)
                              let ownerPubkey: string;
                              if (ownerPubkeyForLink && /^[0-9a-f]{64}$/i.test(ownerPubkeyForLink)) {
                                ownerPubkey = ownerPubkeyForLink;
                              } else if (repo?.ownerPubkey && /^[0-9a-f]{64}$/i.test(repo.ownerPubkey)) {
                                ownerPubkey = repo.ownerPubkey;
                              } else if (resolvedParams.entity && resolvedParams.entity.length === 64 && /^[0-9a-f]{64}$/i.test(resolvedParams.entity)) {
                                ownerPubkey = resolvedParams.entity;
                              } else if (resolvedParams.entity && resolvedParams.entity.startsWith("npub")) {
                                // Decode npub to pubkey
                                try {
                                  const decoded = nip19.decode(resolvedParams.entity);
                                  if (decoded.type === "npub") {
                                    ownerPubkey = decoded.data as string;
                                  } else {
                                    ownerPubkey = resolvedParams.entity; // Fallback
                                  }
                                } catch {
                                  ownerPubkey = resolvedParams.entity; // Fallback
                                }
                              } else {
                                ownerPubkey = resolvedParams.entity; // Fallback (might be 8-char prefix, but better than nothing)
                              }
                              
                              // Construct SSH URL: git@gitSshBase:ownerPubkey/repoName.git
                              sshUrl = `git@${gitSshBase}:${ownerPubkey}/${resolvedParams.repo}.git`;
                              
                              try {
                                await navigator.clipboard.writeText(`git clone ${sshUrl}`);
                                const { showToast } = await import("@/components/ui/toast");
                                showToast("Clone SSH URL copied!", "success");
                              } catch (err) {
                                const { showToast } = await import("@/components/ui/toast");
                                showToast("Failed to copy to clipboard", "error");
                              }
                            }}>
                              Copy clone SSH URL
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={async () => {
                              try {
                                const currentUrl = new URL(window.location.href);
                                const branch = selectedBranch || searchParams?.get("branch") || "main";
                                const file = selectedFile || searchParams?.get("file");
                                
                                // Build permalink URL
                                let permalink = `${currentUrl.origin}${currentUrl.pathname}`;
                                const params = new URLSearchParams();
                                if (branch && branch !== "main") params.set("branch", branch);
                                if (file) params.set("file", file);
                                if (currentPath) params.set("path", currentPath);
                                
                                if (params.toString()) {
                                  permalink += `?${params.toString()}`;
                                }
                                
                                await navigator.clipboard.writeText(permalink);
                                const { showToast } = await import("@/components/ui/toast");
                                showToast("Permalink copied to clipboard!", "success");
                              } catch (err) {
                                const { showToast } = await import("@/components/ui/toast");
                                showToast("Failed to copy permalink", "error");
                              }
                            }}>
                              Copy permalink
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              onClick={async () => {
                                if (repoData?.sourceUrl) {
                                  const url = repoData.sourceUrl.replace(/\.git$/, "");
                                  window.open(url, "_blank");
                                } else {
                                  const { showToast } = await import("@/components/ui/toast");
                                  showToast("No source URL available", "error");
                                }
                              }}
                              disabled={!repoData?.sourceUrl}
                            >
                              View on GitHub
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              onClick={async () => {
                                if (repoData?.sourceUrl) {
                                  try {
                                    const u = new URL(repoData.sourceUrl);
                                    const parts = u.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
                                    const owner = parts[0];
                                    const repoName = parts[1] || resolvedParams.repo;
                                    const branch = repoData?.defaultBranch || "main";
                                    const zipUrl = `https://github.com/${owner}/${repoName}/archive/refs/heads/${branch}.zip`;
                                    window.open(zipUrl, "_blank");
                                  } catch {
                                    const { showToast } = await import("@/components/ui/toast");
                                    showToast("Failed to generate download URL", "error");
                                  }
                                } else {
                                  // For native repos, create ZIP from files
                                  try {
                                    const files = repoData?.files || [];
                                    if (files.length === 0) {
                                      const { showToast } = await import("@/components/ui/toast");
                                      showToast("No files to download", "error");
                                      return;
                                    }
                                    // Create ZIP using JSZip if available, otherwise fallback
                                    const { showToast } = await import("@/components/ui/toast");
                                    showToast("ZIP download for native repos coming soon", "info");
                                  } catch {
                                    const { showToast } = await import("@/components/ui/toast");
                                    showToast("Failed to create ZIP archive", "error");
                                  }
                                }
                              }}
                              disabled={false}
                            >
                              Download ZIP
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild className="md:hidden">
              <Button
                className="h-8 !border-lightgray bg-dark"
                variant="outline"
              >
                <MoreHorizontal className="text-gray-500" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="py-2 relative -left-6 top-1 w-[9.5rem]">
              <DropdownMenuItem className="mt-1 mb-2 text-white font-normal">
                <a
                  href={getRepoLink("find")}
                  onClick={(e) => { e.preventDefault(); window.location.href = getRepoLink("find"); }}
                  className="block w-full"
                >
                  Find in repo
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild className="text-white font-normal">
                <a href={getRepoLink("new-file")} onClick={(e) => { e.preventDefault(); window.location.href = getRepoLink("new-file"); }} className="block w-full">
                  Create new file
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="text-white font-normal">
                <a href={getRepoLink("upload")} onClick={(e) => { e.preventDefault(); window.location.href = getRepoLink("upload"); }} className="block w-full">
                  Upload files
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <main className="mt-4">
          {/* Sticky breadcrumbs, GitHub-like (hide on repo root) */}
          {pathParts.length > 0 && (
          <div className="sticky top-0 z-20 -mt-4 pt-4 bg-[#0F1217]">
            <div className="mb-2 text-sm text-gray-300 flex items-center gap-2 border-b border-[#383B42] px-2 py-2">
              {logoUrl ? (
                <img 
                  src={logoUrl} 
                  alt="repo logo" 
                  className="h-5 w-5 rounded-sm object-contain" 
                  onError={(e) => {
                    // If logoUrl fails to load (CORS or other error), hide it and use fallback
                    console.warn("Failed to load repo logo:", logoUrl, "Using owner picture as fallback");
                    const target = e.currentTarget;
                    target.style.display = 'none';
                    // Trigger fallback by setting logoUrl to null (will use owner picture)
                    setLogoUrl(null);
                  }}
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="inline-block h-5 w-5 rounded-sm bg-[#22262C]" />
              )}
              <a 
                href={ownerPubkeyForLink && /^[0-9a-f]{64}$/i.test(ownerPubkeyForLink) ? `/${nip19.npubEncode(ownerPubkeyForLink)}` : `/${resolvedParams.entity}`}
                onClick={(e) => { e.preventDefault(); window.location.href = ownerPubkeyForLink && /^[0-9a-f]{64}$/i.test(ownerPubkeyForLink) ? `/${nip19.npubEncode(ownerPubkeyForLink)}` : `/${resolvedParams.entity}`; }}
                className="text-purple-500 hover:underline font-semibold"
              >
                {(() => {
                  // Use owner's Nostr metadata name if available
                  // CRITICAL: Don't use repoData.entityDisplayName - it might be wrong (set to current user's name during sync)
                  // Get ownerPubkey from ownerPubkeysForMetadata (already resolved correctly)
                  const ownerPubkey = ownerPubkeyForLink && /^[0-9a-f]{64}$/i.test(ownerPubkeyForLink) 
                    ? ownerPubkeyForLink 
                    : ownerPubkeysForMetadata[0];
                  
                  // CRITICAL: Use ref to access metadata without causing re-renders that block clicks
                  const currentMetadata = ownerMetadataRef.current;
                  
                  // Use getEntityDisplayName for consistent username resolution
                  return getEntityDisplayName(ownerPubkey ?? null, currentMetadata, resolvedParams.entity ?? null);
                })()}
              </a>
              <span className="text-gray-500">/</span>
              <a 
                href={getRepoLink() + (selectedBranch && selectedBranch !== (repoData?.defaultBranch || "main") ? `?branch=${selectedBranch}` : "")}
                onClick={(e) => { e.preventDefault(); window.location.href = getRepoLink() + (selectedBranch && selectedBranch !== (repoData?.defaultBranch || "main") ? `?branch=${selectedBranch}` : ""); }}
                className="text-purple-500 hover:underline font-semibold"
              >
                {(() => {
                  // CRITICAL: Display decoded repo name (e.g., "Swarm Relay" instead of "Swarm%20Relay")
                  // But use repoData.name if available (from Nostr event) for consistency
                  const repoDataAny = repoData as any;
                  return repoDataAny?.name || repoDataAny?.repo || decodedRepo;
                })()}
              </a>
              {pathParts.map((part, i) => (
                <span key={i} className="flex items-center gap-1">
                  <span className="text-gray-500">/</span>
                  <button
                    className={`hover:text-purple-500 hover:underline ${i === pathParts.length - 1 ? "text-gray-100 font-medium" : "text-gray-300"}`}
                    onClick={() => {
                      const newPath = pathParts.slice(0, i + 1).join("/");
                      setCurrentPath(newPath);
                      updateURL({ path: newPath }); // branch is already in URL, this just updates path
                    }}
                  >
                    {part}
                  </button>
                </span>
              ))}
            </div>
          </div>
          )}
          <div className="rounded-md rounded-bl-none rounded-br-none border bg-[#171B21] py-2 px-4 text-sm font-medium dark:border-[#383B42]">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 text-gray-300 min-w-0 flex-1">
                    {(() => {
                  // CRITICAL: Use ref to access metadata without causing re-renders that block clicks
                  const currentMetadata = ownerMetadataRef.current;
                      // Get owner picture from metadata - CRITICAL: Only use full pubkey, not 8-char prefix
                      const ownerMeta = ownerPubkeyForLink && ownerPubkeyForLink.length === 64 
                    ? currentMetadata[ownerPubkeyForLink.toLowerCase()] || currentMetadata[ownerPubkeyForLink]
                        : undefined;
                      const ownerPicture = ownerMeta?.picture;
                      // CRITICAL: Use metadata name/display_name if available, otherwise fallback to shortened npub
                      // Use safe initial displayName to prevent hydration mismatch
                      let displayName: string;
                      if (mounted) {
                        // After mount, use metadata if available
                        displayName = ownerMeta?.display_name || ownerMeta?.name || "";
                        if (!displayName || displayName.trim().length === 0 || displayName === "Anonymous Nostrich") {
                          // Fallback to shortened npub format
                          if (resolvedParams.entity && resolvedParams.entity.startsWith("npub")) {
                            displayName = resolvedParams.entity.substring(0, 16) + "...";
                          } else {
                            displayName = resolvedParams.entity || "U";
                          }
                        }
                      } else {
                        // On server/initial render, use consistent fallback
                        if (resolvedParams.entity && resolvedParams.entity.startsWith("npub")) {
                          displayName = resolvedParams.entity.substring(0, 16) + "...";
                        } else {
                          displayName = resolvedParams.entity || "U";
                        }
                      }
                  const ownerNpub = mounted && ownerPubkeyForLink && /^[0-9a-f]{64}$/i.test(ownerPubkeyForLink) 
                    ? nip19.npubEncode(ownerPubkeyForLink) 
                    : null;
                  const profileUrl = ownerNpub ? `/${ownerNpub}` : `/${resolvedParams.entity}`;
                  // Use safe initial tooltip content to prevent hydration mismatch
                  const tooltipContent = mounted ? [
                    displayName,
                    ownerNpub ? `npub: ${ownerNpub}` : null,
                    ownerPubkeyForLink && /^[0-9a-f]{64}$/i.test(ownerPubkeyForLink) ? `pubkey: ${ownerPubkeyForLink}` : null,
                  ].filter(Boolean).join('\n') : displayName; // On server/initial render, only show displayName
                  
                  return (
                    <Tooltip content={tooltipContent}>
                      <a 
                        href={profileUrl}
                        onClick={(e) => { e.preventDefault(); window.location.href = profileUrl; }}
                      >
                        <Avatar className="h-6 w-6 ring-2 ring-purple-500">
                          {ownerPicture && ownerPicture.startsWith("http") ? (
                        <AvatarImage 
                          src={ownerPicture} 
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                          ) : null}
                    {/* CRITICAL: Show platform default logo when no picture, not initials */}
                    {!ownerPicture ? (
                      <AvatarFallback className="bg-transparent">
                        <img 
                          src="/logo.svg" 
                          alt="platform default"
                          className="h-full w-full object-contain p-0.5"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                    </AvatarFallback>
                    ) : null}
                </Avatar>
                      </a>
                    </Tooltip>
                  );
                })()}
                {repoData?.forkedFrom ? (
              <>
                    <a 
                      href={ownerPubkeyForLink && /^[0-9a-f]{64}$/i.test(ownerPubkeyForLink) ? `/${nip19.npubEncode(ownerPubkeyForLink)}` : `/${resolvedParams.entity}`}
                      onClick={(e) => { e.preventDefault(); window.location.href = ownerPubkeyForLink && /^[0-9a-f]{64}$/i.test(ownerPubkeyForLink) ? `/${nip19.npubEncode(ownerPubkeyForLink)}` : `/${resolvedParams.entity}`; }}
                      className="text-purple-500 hover:underline font-semibold"
                    >
                      {(() => {
                        // CRITICAL: Use ref to access metadata without causing re-renders that block clicks
                        const currentMetadata = ownerMetadataRef.current;
                        // Use Nostr metadata for display name
                        // CRITICAL: Never use repoData.entityDisplayName - it might be wrong (set to current user's name)
                        const ownerMeta = ownerPubkeyForLink && ownerPubkeyForLink.length === 64 
                          ? currentMetadata[ownerPubkeyForLink] 
                          : undefined;
                        return ownerMeta?.display_name || ownerMeta?.name || resolvedParams.entity;
                      })()}
                  </a>
                    <span className="text-gray-400 whitespace-nowrap">forked</span>
                    <a 
                      href={repoData.forkedFrom} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-purple-500 hover:underline truncate min-w-0"
                    >
                      <span className="truncate block">{repoData.forkedFrom.replace(/^https?:\/\//, '').replace(/\.git$/, '').replace(/^github\.com\//, '')}</span>
                    </a>
                  </>
                ) : (
                  <a 
                    href={ownerPubkeyForLink && /^[0-9a-f]{64}$/i.test(ownerPubkeyForLink) ? `/${nip19.npubEncode(ownerPubkeyForLink)}` : `/${resolvedParams.entity}`}
                    onClick={(e) => { e.preventDefault(); window.location.href = ownerPubkeyForLink && /^[0-9a-f]{64}$/i.test(ownerPubkeyForLink) ? `/${nip19.npubEncode(ownerPubkeyForLink)}` : `/${resolvedParams.entity}`; }}
                    className="text-purple-500 hover:underline font-semibold"
                  >
                    {(() => {
                      // CRITICAL: Use ref to access metadata without causing re-renders that block clicks
                      const currentMetadata = ownerMetadataRef.current;
                      // Use getEntityDisplayName for consistent username resolution
                      return getEntityDisplayName(ownerPubkeyForLink, currentMetadata, resolvedParams.entity);
                    })()}
                  </a>
                )}
                {repoData?.createdAt && (
                  <span className="text-gray-400 whitespace-nowrap truncate">
                    {formatDate24h(repoData.createdAt)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 text-gray-400 text-xs">
                <Tooltip content={`Total number of files in this repository: ${repoData?.files ? repoData.files.filter(f => f.type === "file").length : 0}`}>
                  <span className="hover:text-purple-500 flex items-center gap-1 cursor-help">
                    <History className="h-4 w-4" />
                    <span className="hidden sm:inline">
                      {repoData?.files ? repoData.files.filter(f => f.type === "file").length : 0} files
                    </span>
                  </span>
                </Tooltip>
              </div>
            </div>
          </div>
          {fetchingFilesFromGit.source && (
            <div className="rounded-md rounded-tr-none rounded-tl-none border border-t-0 dark:border-lightgray bg-[#171B21] p-4">
              <div className="flex items-center gap-3 text-sm text-gray-300">
                <div className="animate-spin h-4 w-4 border-2 border-purple-500 border-t-transparent rounded-full"></div>
                <span>
                  {fetchingFilesFromGit.source === 'github' && '🐙 '}
                  {fetchingFilesFromGit.source === 'gitlab' && '🦊 '}
                  {fetchingFilesFromGit.message}
                </span>
              </div>
            </div>
          )}
          {fetchStatuses.length > 0 && (() => {
            // Check if we have files - if so, show success message briefly, then hide
            const hasFiles = repoData?.files && Array.isArray(repoData.files) && repoData.files.length > 0;
            const hasSuccess = fetchStatuses.some(s => s.status === 'success');
            const allDone = fetchStatuses.every(s => s.status === 'success' || s.status === 'failed');
            const stillFetching = fetchStatuses.some(s => s.status === 'fetching' || s.status === 'pending');
            const successfulSourcesList = (repoData as any)?.successfulSources || [];
            
            // Count statuses for summary
            const successCount = fetchStatuses.filter(s => s.status === 'success').length;
            const failedCount = fetchStatuses.filter(s => s.status === 'failed').length;
            const fetchingCount = fetchStatuses.filter(s => s.status === 'fetching' || s.status === 'pending').length;
            
            // Only show section if there are statuses or if actively fetching
            if (fetchStatuses.length === 0 && !stillFetching) {
              return null;
            }
            
            return (
              <div className="rounded-md rounded-tr-none rounded-tl-none border border-t-0 dark:border-lightgray bg-[#171B21]">
                <button
                  onClick={() => setFetchStatusExpanded(!fetchStatusExpanded)}
                  className="w-full flex items-center justify-between p-4 hover:bg-[#1a1f28] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">
                      {stillFetching ? '⟳ Fetching from sources...' : 
                       hasFiles && hasSuccess ? '✓ Files found' : 
                       'File sources'}
                    </span>
                    {stillFetching && (
                      <RefreshCw className="h-3 w-3 text-blue-400 animate-spin" />
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {!fetchStatusExpanded && (
                      <span className="text-xs text-gray-500">
                        {successCount > 0 && <span className="text-green-400">{successCount}✓</span>}
                        {failedCount > 0 && <span className="text-red-400 ml-1">{failedCount}✗</span>}
                        {fetchingCount > 0 && <span className="text-blue-400 ml-1">{fetchingCount}⟳</span>}
                      </span>
                    )}
                    {fetchStatusExpanded ? (
                      <ChevronUp className="h-4 w-4 text-gray-400" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-gray-400" />
                    )}
                  </div>
                </button>
                {fetchStatusExpanded && (
                  <div className="px-4 pb-4 space-y-3">
                    {/* Show successful sources first and prominently */}
                    {successCount > 0 && (
                <div className="space-y-1">
                        <p className="text-xs text-green-400 font-semibold mb-1">✓ Successful Sources:</p>
                        {fetchStatuses
                          .filter(s => s.status === 'success')
                          .map((status, index) => (
                            <div key={`success-${index}`} className="flex items-center justify-between text-xs bg-green-900/20 border border-green-600/30 rounded px-2 py-1">
                              <span className="text-green-300 truncate flex-1 mr-2 font-medium">
                                {(status.source === 'github.com' || status.source.includes('github')) && '🐙 '}
                                {(status.source === 'codeberg.org' || status.source.includes('codeberg')) && '🐙 '}
                                {(status.source === 'gitlab.com' || status.source.includes('gitlab')) && '🦊 '}
                                {status.source}
                      </span>
                              <span className="text-green-400 flex-shrink-0">✓ Files available</span>
                    </div>
                  ))}
                </div>
                    )}
                    
                    {/* Show all sources (grouped: success, fetching, failed) */}
                    <div className="space-y-1">
                      {fetchingCount > 0 && (
                        <>
                          <p className="text-xs text-blue-400 font-semibold mb-1">⟳ Fetching:</p>
                          {fetchStatuses
                            .filter(s => s.status === 'fetching' || s.status === 'pending')
                            .map((status, index) => (
                              <div key={`fetching-${index}`} className="flex items-center justify-between text-xs">
                                <span className="text-gray-300 truncate flex-1 mr-2">{status.source}</span>
                                <span className="text-blue-400 flex-shrink-0">⟳ Fetching...</span>
                              </div>
                            ))}
                        </>
                      )}
                      
                      {failedCount > 0 && (
                        <>
                          {fetchingCount > 0 && <div className="pt-1"></div>}
                          <p className="text-xs text-gray-400 font-semibold mb-1">✗ Unavailable:</p>
                          {fetchStatuses
                            .filter(s => s.status === 'failed')
                            .map((status, index) => (
                              <div key={`failed-${index}`} className="flex items-center justify-between text-xs text-gray-500">
                                <span className="text-gray-500 truncate flex-1 mr-2">{status.source}</span>
                                <span className="text-gray-500 flex-shrink-0 text-xs">
                                  {status.error || 'No files from this source'}
                          </span>
                        </div>
                      ))}
                        </>
                      )}
                    </div>
                    
                    {/* Show which source is currently being used for files */}
                    {hasFiles && successCount > 0 && (
                      <div className="pt-2 border-t border-[#383B42]">
                        <p className="text-xs text-gray-400 mb-1">
                          <span className="text-green-400">✓</span> Files loaded from: <span className="text-green-300 font-medium">
                            {fetchStatuses.find(s => s.status === 'success')?.source || 'localStorage'}
                          </span>
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
          {items.length > 0 && (
          <div className="overflow-hidden rounded-md rounded-tr-none rounded-tl-none border border-t-0 dark:border-lightgray">
            <ul className="divide-y dark:divide-lightgray">
                {items.map((it) => (
                  <li key={it.path} className="text-gray-400 grid grid-cols-2 p-2 text-sm sm:grid-cols-4 hover:bg-[#171B21]">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                      {it.type === "dir" ? (
                        <>
                  <Folder className="text-gray-400 ml-2 h-4 w-4" />{" "}
                          <button
                            className="hover:text-purple-500 hover:underline cursor-pointer text-left truncate min-w-0"
                            onClick={(e) => {
                              e.preventDefault();
                              setCurrentPath(it.path);
                              updateURL({ path: it.path });
                            }}
                          >
                            <span className="truncate block">{it.path.split("/").pop()}</span>
                            {(() => {
                              const name = it.path.split("/").pop() || it.path;
                              const lower = name.toLowerCase();
                              const pill = (label: string, color: string) => (
                                <span className={`ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] ${color} bg-white/10 border border-white/10`}>{label}</span>
                              );
                              if (lower === "readme.md" || lower === "readme") return pill("readme", "text-purple-300");
                              if (lower === "license" || lower === "license.md") return pill("license", "text-green-300");
                              if (lower === "manifest.json") return pill("manifest", "text-cyan-300");
                              if (lower === "package.json") return pill("npm", "text-red-300");
                              if (lower === "yarn.lock") return pill("yarn", "text-blue-300");
                              if (lower === "pnpm-lock.yaml") return pill("pnpm", "text-yellow-300");
                              if (lower === "tsconfig.json") return pill("tsconfig", "text-sky-300");
                              if (lower === "dockerfile") return pill("docker", "text-cyan-300");
                              if (lower === "docker-compose.yml" || lower === "docker-compose.yaml") return pill("compose", "text-cyan-300");
                              if (lower === "makefile") return pill("make", "text-amber-300");
                              if (lower === ".env" || lower.startsWith(".env")) return pill("env", "text-lime-300");
                              if (lower === "go.mod") return pill("go.mod", "text-cyan-300");
                              if (lower === "cargo.toml") return pill("cargo", "text-orange-300");
                              if (lower.endsWith(".workflow") || it.path.includes(".github/workflows/")) return pill("ci", "text-green-300");
                              return null;
                            })()}
                          </button>
                        </>
                      ) : (
                        <>
                  {(() => {
                    const name = it.path.split("/").pop() || it.path;
                    const lower = name.toLowerCase();
                    // Theme-aware colors: Use colors that contrast with text-gray-400 (default icon color)
                    // For dark theme: text-gray-400 is light gray, so use vibrant but distinct colors
                    // Ensure highlight colors are different from text color
                    let cls = "text-gray-400"; // Default: matches text color for normal files
                    if (["readme.md","readme"].includes(lower)) cls = "text-purple-500"; // Purple (distinct from gray)
                    else if (["license","license.md"].includes(lower)) cls = "text-emerald-500"; // Green (distinct from gray)
                    else if (lower === "manifest.json") cls = "text-cyan-500"; // Cyan (distinct from gray)
                    else if (lower === "package.json") cls = "text-rose-500"; // Rose/Red (distinct from gray)
                    else if (lower === "yarn.lock") cls = "text-blue-500"; // Blue (distinct from gray)
                    else if (lower === "pnpm-lock.yaml") cls = "text-yellow-500"; // Yellow (distinct from gray)
                    else if (lower === "tsconfig.json") cls = "text-sky-500"; // Sky blue (distinct from gray)
                    else if (lower === "dockerfile" || lower.startsWith("docker-")) cls = "text-cyan-500"; // Cyan (distinct from gray)
                    else if (lower === "makefile") cls = "text-amber-500"; // Amber (distinct from gray)
                    else if (lower === ".env" || lower.startsWith(".env")) cls = "text-lime-500"; // Lime (distinct from gray)
                    else if (lower === "go.mod") cls = "text-cyan-500"; // Cyan (distinct from gray)
                    else if (lower === "cargo.toml") cls = "text-orange-500"; // Orange (distinct from gray)
                    else if (lower.endsWith(".workflow") || it.path.includes(".github/workflows/")) cls = "text-emerald-500"; // Green (distinct from gray)
                    return <File className={`${cls} ml-2 h-4 w-4`} />;
                  })()}{" "}
                          <button
                            className="hover:text-purple-500 hover:underline cursor-pointer text-left truncate min-w-0"
                            onClick={(e) => {
                              e.preventDefault();
                              openFile(it.path);
                            }}
                          >
                            <span className="truncate block">{it.path.split("/").pop()}</span>
                          </button>
                        </>
                      )}
                </div>
                <div className="hidden col-span-2 sm:block pl-4">
                      {it.type === "file" ? (
                        <button
                          className="hover:text-purple-500 hover:underline cursor-pointer text-gray-400 truncate"
                          onClick={(e) => {
                            e.preventDefault();
                            openFile(it.path);
                          }}
                          title={it.path}
                        >
                          {/* Only show path if it's different from filename (i.e., in a subdirectory) */}
                          {it.path.includes("/") ? it.path : <span className="text-gray-500 italic">-</span>}
                        </button>
                      ) : it.type === "dir" ? (
                        <button
                          className="hover:text-purple-500 hover:underline cursor-pointer text-gray-400"
                          onClick={(e) => {
                            e.preventDefault();
                            setCurrentPath(it.path);
                            updateURL({ path: it.path });
                          }}
                        >
                          {it.path}/
                        </button>
                      ) : (
                        <span className="text-gray-500">-</span>
                      )}
                </div>
                    <div className="text-right whitespace-nowrap">{it.size ? `${it.size} B` : "-"}</div>
              </li>
                ))}
            </ul>
          </div>
          )}
          {items.length === 0 && repoData && (
            <div className="border p-4 text-center text-gray-400">No files found</div>
          )}
          {!selectedFile && !fileContent && repoData?.readme && (
          <div className="mt-4 rounded-md border dark:border-[#383B42]">
            <div className="flex items-center gap-2 border-b p-2 dark:border-[#383B42]">
              <List className="text-gray-400 ml-2 h-4 w-4" />{" "}
                <span className="text-gray-400">README.md</span>
            </div>
            <article
              id="readme"
                className="prose prose-invert max-w-full p-4 text-white prose-headings:text-white prose-p:text-gray-300 prose-a:text-purple-500 prose-strong:text-white prose-code:text-green-400 prose-pre:bg-gray-900 prose-code:bg-gray-900 prose-code:px-1 prose-code:rounded"
            >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw]}
                  components={{
                    img: ({ node, ...props }) => {
                      // Transform relative image paths to absolute URLs
                      let imageSrc = props.src || "";
                      
                      // If src is already an absolute URL (http:// or https://) or data URL, use it as-is
                      if (imageSrc.startsWith("http://") || imageSrc.startsWith("https://") || imageSrc.startsWith("data:")) {
                        return <img {...props} className="max-w-full h-auto rounded" alt={props.alt || ""} />;
                      }
                      
                      // For relative paths, resolve them using the repository's sourceUrl or API
                      if (imageSrc && repoData) {
                        try {
                          // Get the branch to use
                          const branch = selectedBranch || repoData?.defaultBranch || "main";
                          
                          // Resolve relative path: remove leading slash or ./ if present
                          // Images in markdown are typically relative to the repository root
                          let imagePath = imageSrc;
                          if (imagePath.startsWith("./")) {
                            imagePath = imagePath.slice(2);
                          } else if (imagePath.startsWith("/")) {
                            imagePath = imagePath.slice(1);
                          }
                          
                          // Construct raw URL based on git provider
                          const sourceUrl = repoData.sourceUrl || '';
                          const githubMatch = sourceUrl.match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?$/);
                          const gitlabMatch = sourceUrl.match(/gitlab\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?$/);
                          const codebergMatch = sourceUrl.match(/codeberg\.org\/([^\/]+)\/([^\/]+?)(?:\.git)?$/);
                          
                          if (githubMatch) {
                            const [, owner, repo] = githubMatch;
                            imageSrc = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${imagePath}`;
                          } else if (gitlabMatch) {
                            // GitLab raw URL format: https://gitlab.com/owner/repo/-/raw/branch/path
                            const [, owner, repo] = gitlabMatch;
                            imageSrc = `https://gitlab.com/${owner}/${repo}/-/raw/${encodeURIComponent(branch)}/${imagePath}`;
                          } else if (codebergMatch) {
                            // Codeberg raw URL format: https://codeberg.org/owner/repo/raw/branch/path
                            const [, owner, repo] = codebergMatch;
                            imageSrc = `https://codeberg.org/${owner}/${repo}/raw/branch/${encodeURIComponent(branch)}/${imagePath}`;
                          } else if (!repoData.sourceUrl) {
                            // For gittr/nostr repos without external sourceUrl, try to use the bridge API
                            // Note: The API returns JSON with base64, so we'd need special handling
                            // For now, log a warning - this case needs a custom image component
                            console.warn("⚠️ [README] Image in nostr repo without sourceUrl - needs special handling:", imageSrc);
                          } else {
                            // For other git providers, try to construct a raw URL pattern
                            // This is a best-effort approach for unknown providers
                            try {
                              const url = new URL(repoData.sourceUrl.replace(/\.git$/, ""));
                              const pathParts = url.pathname.split("/").filter(Boolean);
                              if (pathParts.length >= 2) {
                                const owner = pathParts[0];
                                const repo = pathParts[1];
                                // Try common raw URL patterns
                                imageSrc = `${url.protocol}//${url.host}/${owner}/${repo}/raw/${encodeURIComponent(branch)}/${imagePath}`;
                              } else {
                                console.warn("⚠️ [README] Could not parse sourceUrl for image:", repoData.sourceUrl);
                              }
                            } catch (e) {
                              console.warn("⚠️ [README] Failed to construct raw URL for image:", imageSrc, e);
                            }
                          }
                        } catch (e) {
                          console.warn("⚠️ [README] Failed to resolve image URL:", imageSrc, e);
                          // Fallback to original src
                        }
                      }
                      
                      return (
                        <div className="my-4 overflow-x-auto">
                          <img 
                            {...props} 
                            src={imageSrc} 
                            className="max-w-full h-auto rounded" 
                            alt={props.alt || ""} 
                            style={{ maxWidth: '100%', width: 'auto', height: 'auto' }}
                            onError={(e) => {
                              console.warn("⚠️ [README] Image failed to load:", imageSrc);
                              // Optionally hide broken images or show a placeholder
                              (e.target as HTMLImageElement).style.display = 'none';
                            }} 
                          />
                        </div>
                      );
                    },
                    a: ({ node, href, children, ...props }: any) => {
                      // Convert YouTube URLs to embeds
                      if (href && typeof href === 'string') {
                        const youtubeRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
                        const match = href.match(youtubeRegex);
                        if (match && match[1]) {
                          const videoId = match[1];
                          return (
                            <div className="my-4">
                              <iframe
                                width="560"
                                height="315"
                                src={`https://www.youtube.com/embed/${videoId}`}
                                title="YouTube video player"
                                frameBorder="0"
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                allowFullScreen
                                referrerPolicy="no-referrer-when-downgrade"
                                className="w-full max-w-full rounded"
                                style={{ aspectRatio: '16/9' }}
                              />
                            </div>
                          );
                        }
                      }
                      // Regular link
                      return <a href={href} target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300" {...props}>{children}</a>;
                    },
                    code: ({ node, inline, className, children, ...props }: any) => {
                      const match = /language-([\w-]+)/.exec(className || "");
                      const language = match?.[1]?.toLowerCase();
                      const content = String(children).replace(/\n$/, "");

                      if (!inline && language === "mermaid") {
                        return <MermaidRenderer code={content} className="my-4" />;
                      }

                      // Use CopyableCodeBlock for all code blocks
                      return (
                        <CopyableCodeBlock 
                          inline={inline} 
                          className={inline ? "bg-gray-900 px-1 rounded text-green-400" : className || "bg-gray-900 rounded p-4 overflow-x-auto"}
                        >
                          {children}
                        </CopyableCodeBlock>
                      );
                    },
                  }}
                >
                  {repoData.readme}
                </ReactMarkdown>
            </article>
          </div>
          )}
          {selectedFile && (
            <div ref={fileViewerRef} className="mt-4 rounded-md border dark:border-[#383B42]">
              <div className="flex items-center gap-2 border-b p-2 dark:border-[#383B42] flex-wrap">
                <File className="text-gray-400 ml-2 h-4 w-4 flex-shrink-0" />{" "}
                <span className="text-gray-400 truncate min-w-0 flex-1">{selectedFile}</span>
                <div className="ml-auto flex items-center gap-2 flex-wrap justify-end min-w-0">
                  {/* HTML and Markdown files: Toggle between preview and code view */}
                  {/* Media types (image, video, audio) always show preview - no toggle needed */}
                  {(fileType === 'html' || fileType === 'markdown') && !proposeEdit && (
                    <button
                      className="text-sm text-purple-400 hover:text-purple-300 border border-purple-500/50 rounded px-2 py-1"
                      onClick={() => {
                        if (fileType === 'html') {
                          setHtmlViewMode(htmlViewMode === 'preview' ? 'code' : 'preview');
                        } else if (fileType === 'markdown') {
                          setMarkdownViewMode(markdownViewMode === 'preview' ? 'code' : 'preview');
                        }
                      }}
                    >
                      {(fileType === 'html' ? htmlViewMode : markdownViewMode) === 'preview' ? 'View Code' : 'Preview'}
                    </button>
                  )}
                  {selectedFile && (() => {
                    const rawUrl = getRawUrl(selectedFile);
                    return rawUrl ? (
                      <a
                        href={rawUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-gray-400 hover:text-purple-400 hover:underline whitespace-nowrap"
                      >
                        Raw
                      </a>
                    ) : null;
                  })()}
                  <a
                    href={getRepoLink("commits") + `?file=${encodeURIComponent(selectedFile || "")}`}
                    onClick={(e) => { e.preventDefault(); window.location.href = getRepoLink("commits") + `?file=${encodeURIComponent(selectedFile || "")}`; }}
                    className="text-sm text-gray-400 hover:text-purple-400 hover:underline"
                  >
                    History
                  </a>
                  <a
                    href={getRepoLink("blame") + `?file=${encodeURIComponent(selectedFile || "")}`}
                    onClick={(e) => { e.preventDefault(); window.location.href = getRepoLink("blame") + `?file=${encodeURIComponent(selectedFile || "")}`; }}
                    className="text-sm text-gray-400 hover:text-purple-400 hover:underline"
                  >
                    Blame
                  </a>
                  {isOwner ? (
                    <>
                      {/* Edit button - only show in code view for HTML/Markdown, or for other text files (not media) */}
                      {((fileType === 'html' && htmlViewMode === 'code') || (fileType === 'markdown' && markdownViewMode === 'code') || (fileType !== 'image' && fileType !== 'video' && fileType !== 'audio' && fileType !== 'pdf' && fileType !== 'html' && fileType !== 'markdown')) && (
                      <button
                        className="text-sm text-purple-500 hover:underline whitespace-nowrap"
                        onClick={() => editCurrentFile()}
                      >
                        Edit
                      </button>
                      )}
                      <button
                        className="text-sm text-red-400 hover:underline whitespace-nowrap"
                        onClick={() => deleteCurrentFile()}
                      >
                        Delete
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Edit button - only show in code view for HTML/Markdown, or for other text files (not media) */}
                      {!proposeEdit && ((fileType === 'html' && htmlViewMode === 'code') || (fileType === 'markdown' && markdownViewMode === 'code') || (fileType !== 'image' && fileType !== 'video' && fileType !== 'audio' && fileType !== 'pdf' && fileType !== 'html' && fileType !== 'markdown')) && (
                        <button
                          className="text-sm text-purple-500 hover:underline whitespace-nowrap"
                          onClick={() => {
                            if (!selectedFile) return;
                            const type = getFileType(selectedFile);
                            if (["image","video","audio","pdf","binary"].includes(type)) {
                              alert("Binary files cannot be edited inline. Please open an issue or upload via PR.");
                              return;
                            }
                            setProposeEdit(true);
                            setProposedContent(fileContent || "");
                          }}
                        >
                          Edit and propose change
                        </button>
                      )}
                    </>
                  )}
                  <button
                    className="text-sm text-gray-400 hover:underline whitespace-nowrap"
                    onClick={() => { 
                      setSelectedFile(null); 
                      setFileContent(""); 
                      setProposeEdit(false);
                      setProposedContent("");
                      setHtmlViewMode('preview'); // Reset HTML view mode
                      setMarkdownViewMode('preview'); // Reset Markdown view mode
                      updateURL({ file: null });
                    }}
                  >
                    Back
                  </button>
                </div>
              </div>
              <div className="p-4">
                {loadingFile ? (
                  <p className="text-gray-400">Loading...</p>
                ) : fileType === 'image' && isBinaryUrl ? (
                  <div className="flex justify-center">
                    <img src={fileContent} alt={selectedFile} className="max-w-full max-h-[70vh] object-contain" />
                  </div>
                ) : fileType === 'video' && isBinaryUrl ? (
                  <div className="flex justify-center">
                    <video src={fileContent} controls className="max-w-full max-h-[70vh]" />
                  </div>
                ) : fileType === 'audio' && isBinaryUrl ? (
                  <div className="flex justify-center">
                    <audio src={fileContent} controls className="w-full" />
                  </div>
                ) : fileType === 'pdf' && isBinaryUrl ? (
                  // PDF files: Use object tag for data URLs (iframes are blocked by CSP)
                  (() => {
                    // For data URLs, create a blob URL to avoid CSP issues
                    if (isDataUrl && fileContent.startsWith('data:application/pdf')) {
                      try {
                        const base64Match = fileContent.match(/data:application\/pdf[^,]*base64,(.+)/);
                        if (base64Match && base64Match[1]) {
                          const binaryString = atob(base64Match[1]);
                          const bytes = new Uint8Array(binaryString.length);
                          for (let i = 0; i < binaryString.length; i++) {
                            bytes[i] = binaryString.charCodeAt(i);
                          }
                          const blob = new Blob([bytes], { type: 'application/pdf' });
                          const blobUrl = URL.createObjectURL(blob);
                          return (
                  <div className="w-full h-[70vh]">
                              <object 
                                data={blobUrl} 
                                type="application/pdf" 
                                className="w-full h-full border-0"
                                title={selectedFile}
                              >
                                <p className="text-gray-400 p-4">
                                  PDF cannot be displayed. <a href={blobUrl} download={selectedFile} className="text-purple-500 hover:underline">Download PDF</a>
                                </p>
                              </object>
                  </div>
                          );
                        }
                      } catch (e) {
                        console.error('Failed to create PDF blob URL:', e);
                      }
                    }
                    // Fallback: Use iframe for regular URLs or object tag
                    return (
                      <div className="w-full h-[70vh]">
                        <object 
                          data={fileContent} 
                          type="application/pdf" 
                          className="w-full h-full border-0"
                          title={selectedFile}
                        >
                          <iframe 
                            src={fileContent} 
                            className="w-full h-full border-0" 
                            title={selectedFile}
                          />
                        </object>
                      </div>
                    );
                  })()
                ) : fileType === 'html' && selectedFile ? (
                  // HTML files: Toggle between preview (iframe) and code view
                  loadingFile ? (
                    <div className="p-4 text-gray-400">Loading HTML file...</div>
                  ) : !fileContent || fileContent === "(unable to load file)" || (fileContent.trim && fileContent.trim().length === 0) ? (
                    <div className="p-4 text-gray-400">Unable to load HTML file</div>
                  ) : htmlViewMode === 'preview' ? (
                    // Preview mode: Render in iframe
                    (() => {
                      const content = fileContent || '';
                      if (!content || content === "(unable to load file)" || (typeof content === 'string' && content.trim().length === 0)) {
                        return (
                          <div className="p-4 text-gray-400">
                            {loadingFile ? "Loading HTML file..." : "No HTML content available"}
                          </div>
                        );
                      }

                      // Handle HTTP/HTTPS URLs - use as src
                      if (typeof content === 'string' && (content.startsWith('http://') || content.startsWith('https://'))) {
                        return (
                          <div className="w-full h-[70vh] border border-[#383B42] rounded">
                            <iframe 
                              src={content}
                              className="w-full h-full border-0" 
                              title={selectedFile}
                              sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                            />
                          </div>
                        );
                      }

                      // Handle data URLs (base64 or URL-encoded)
                      let htmlContent = '';
                      if (typeof content === 'string' && content.startsWith('data:text/html')) {
                        try {
                          const base64Match = content.match(/data:text\/html[^,]*base64,(.+)/);
                          if (base64Match && base64Match[1]) {
                            htmlContent = atob(base64Match[1]);
                          } else {
                            const urlMatch = content.match(/data:text\/html[^,]*, (.+)/);
                            if (urlMatch && urlMatch[1]) {
                              htmlContent = decodeURIComponent(urlMatch[1]);
                            } else {
                              htmlContent = content.replace(/^data:text\/html[^,]*,?\s*/, '');
                            }
                          }
                        } catch (e) {
                          htmlContent = content.replace(/^data:text\/html[^,]*,?\s*/, '');
                        }
                      } else {
                        // Plain HTML text content
                        htmlContent = typeof content === 'string' ? content : String(content);
                      }
                      
                      // Ensure we have valid content
                      if (!htmlContent || htmlContent.trim().length === 0) {
                        return (
                          <div className="p-4 text-gray-400">
                            No HTML content available
                          </div>
                        );
                      }
                      
                      // Ensure HTML has proper structure (add if missing)
                      if (!htmlContent.trim().toLowerCase().startsWith('<!doctype') && 
                          !htmlContent.trim().toLowerCase().startsWith('<html')) {
                        htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${htmlContent}</body></html>`;
                      }
                      
                      return (
                        <div className="w-full h-[70vh] border border-[#383B42] rounded">
                          <iframe 
                            srcDoc={htmlContent}
                            className="w-full h-full border-0" 
                            title={selectedFile}
                            sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals"
                          />
                        </div>
                      );
                    })()
                  ) : (
                    // Code mode: Show as text with syntax highlighting using CodeViewer
                    <CodeViewer 
                      content={(() => {
                        // Decode if it's a data URL
                        if (isDataUrl && fileContent.startsWith('data:text/html')) {
                          try {
                            const base64Match = fileContent.match(/data:text\/html[^,]*base64,(.+)/);
                            if (base64Match && base64Match[1]) {
                              return atob(base64Match[1]);
                            } else {
                              const urlMatch = fileContent.match(/data:text\/html[^,]*, (.+)/);
                              if (urlMatch && urlMatch[1]) {
                                return decodeURIComponent(urlMatch[1]);
                              }
                            }
                          } catch (e) {
                            console.error('Failed to decode HTML data URL:', e);
                          }
                        }
                        return fileContent;
                      })()}
                      filePath={selectedFile}
                      entity={resolvedParams.entity}
                      repo={resolvedParams.repo}
                      branch={selectedBranch}
                    />
                  )
                ) : fileType === 'markdown' && fileContent ? (
                  // Markdown files: Toggle between preview (rendered) and code view
                  markdownViewMode === 'preview' ? (
                    // Preview mode: Render as markdown
                    <div className="prose prose-invert max-w-none p-4">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeRaw]}
                        components={{
                          p: ({ node, children, ...props }: any) => {
                            // CRITICAL: Check if paragraph contains code elements that will render as blocks
                            // ReactMarkdown wraps code blocks in paragraphs, but CopyableCodeBlock renders as div/pre
                            // This creates invalid HTML: <p><div><pre>...</pre></div></p>
                            
                            // Recursively check AST node for code elements with language classes (block code)
                            const checkForBlockCode = (child: any): boolean => {
                              if (!child) return false;
                              
                              // Check if this is a code element with language class (block code)
                              if (child.type === 'element' && child.tagName === 'code') {
                                const className = child.properties?.className || '';
                                if (typeof className === 'string' && className.includes('language-')) {
                                  return true;
                                }
                              }
                              
                              // Check for other block-level elements
                              if (child.type === 'element' && 
                                  (child.tagName === 'div' || child.tagName === 'iframe' || child.tagName === 'img' || child.tagName === 'pre')) {
                                return true;
                              }
                              
                              // Recursively check children
                              if (child.children && Array.isArray(child.children)) {
                                return child.children.some(checkForBlockCode);
                              }
                              
                              return false;
                            };
                            
                            const hasBlockCode = node?.children?.some(checkForBlockCode);
                            
                            // Check React children for CopyableCodeBlock components or div/pre elements
                            // IMPORTANT: We need to check if ANY child will render as a block-level element
                            const childrenArray = Array.isArray(children) ? children : [children];
                            const hasBlockElement = childrenArray.some((child: any) => {
                              if (!child || typeof child !== 'object') return false;
                              
                              // Check if it's CopyableCodeBlock component
                              if (child.type) {
                                const componentName = child.type.name || child.type.displayName || '';
                                if (componentName === 'CopyableCodeBlock') {
                                  // CopyableCodeBlock renders as div/pre when inline is false or undefined
                                  // Default is inline=false, so we need to check the actual prop value
                                  // If inline is explicitly true, it renders as <code> (inline)
                                  // Otherwise, it renders as <div><pre> (block)
                                  if (child.props?.inline !== true) {
                                    return true; // Block-level rendering
                                  }
                                }
                                
                                // Check if it's already a div or pre element
                                if (child.type === 'div' || child.type === 'pre') {
                                  return true;
                                }
                              }
                              
                              return false;
                            });
                            
                            // If paragraph contains block-level code or other block elements, render as div
                            if (hasBlockCode || hasBlockElement) {
                              return <div {...props}>{children}</div>;
                            }
                            
                            return <p {...props}>{children}</p>;
                          },
                          img: ({ node, ...props }) => {
                            // Transform relative image paths to absolute URLs
                            let imageSrc = props.src || "";
                            
                            // If src is already an absolute URL (http:// or https://) or data URL, use it as-is
                            if (imageSrc.startsWith("http://") || imageSrc.startsWith("https://") || imageSrc.startsWith("data:")) {
                              return <img {...props} className="max-w-full h-auto rounded" alt={props.alt || ""} />;
                            }
                            
                            // For relative paths, resolve them using the repository's sourceUrl or API
                            if (imageSrc && repoData) {
                              try {
                                // Get the branch to use
                                const branch = selectedBranch || repoData?.defaultBranch || "main";
                                
                          // Resolve relative path: remove leading slash or ./ if present
                          // Images in markdown are typically relative to the repository root
                          let imagePath = imageSrc;
                          if (imagePath.startsWith("./")) {
                            imagePath = imagePath.slice(2);
                          } else if (imagePath.startsWith("/")) {
                            imagePath = imagePath.slice(1);
                          }
                          
                          // Construct raw URL based on git provider
                          const sourceUrl = repoData.sourceUrl || '';
                          const githubMatch = sourceUrl.match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?$/);
                          const gitlabMatch = sourceUrl.match(/gitlab\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?$/);
                          const codebergMatch = sourceUrl.match(/codeberg\.org\/([^\/]+)\/([^\/]+?)(?:\.git)?$/);
                          
                          if (githubMatch) {
                            const [, owner, repo] = githubMatch;
                            imageSrc = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${imagePath}`;
                          } else if (gitlabMatch) {
                            // GitLab raw URL format: https://gitlab.com/owner/repo/-/raw/branch/path
                            const [, owner, repo] = gitlabMatch;
                            imageSrc = `https://gitlab.com/${owner}/${repo}/-/raw/${encodeURIComponent(branch)}/${imagePath}`;
                          } else if (codebergMatch) {
                            // Codeberg raw URL format: https://codeberg.org/owner/repo/raw/branch/path
                            const [, owner, repo] = codebergMatch;
                            imageSrc = `https://codeberg.org/${owner}/${repo}/raw/branch/${encodeURIComponent(branch)}/${imagePath}`;
                          } else {
                                  // For other git providers, try to construct a raw URL pattern
                                  // This is a best-effort approach for unknown providers
                                  try {
                                    const url = new URL((repoData.sourceUrl || '').replace(/\.git$/, ""));
                                    const pathParts = url.pathname.split("/").filter(Boolean);
                                    if (pathParts.length >= 2) {
                                      const owner = pathParts[0];
                                      const repo = pathParts[1];
                                      // Try common raw URL patterns
                                      imageSrc = `${url.protocol}//${url.host}/${owner}/${repo}/raw/${encodeURIComponent(branch)}/${imagePath}`;
                                    } else {
                                      console.warn("⚠️ [README] Could not parse sourceUrl for image:", repoData.sourceUrl);
                                    }
                                  } catch (e) {
                                    console.warn("⚠️ [README] Failed to construct raw URL for image:", imageSrc, e);
                                  }
                                }
                              } catch (e) {
                                console.warn("⚠️ [README] Failed to resolve image URL:", imageSrc, e);
                                // Fallback to original src
                              }
                            }
                            
                            return (
                              <div className="my-4 overflow-x-auto">
                                <img 
                                  {...props} 
                                  src={imageSrc} 
                                  className="max-w-full h-auto rounded" 
                                  alt={props.alt || ""} 
                                  style={{ maxWidth: '100%', width: 'auto', height: 'auto' }}
                                  onError={(e) => {
                                    console.warn("⚠️ [README] Image failed to load:", imageSrc);
                                    // Optionally hide broken images or show a placeholder
                                    (e.target as HTMLImageElement).style.display = 'none';
                                  }} 
                                />
                              </div>
                            );
                          },
                          a: ({ node, href, children, ...props }: any) => {
                            // Convert YouTube URLs to embeds
                            if (href && typeof href === 'string') {
                              const youtubeRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
                              const match = href.match(youtubeRegex);
                              if (match && match[1]) {
                                const videoId = match[1];
                                return (
                                  <div className="my-4">
                                    <iframe
                                      width="560"
                                      height="315"
                                      src={`https://www.youtube.com/embed/${videoId}`}
                                      title="YouTube video player"
                                      frameBorder="0"
                                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                      allowFullScreen
                                      referrerPolicy="no-referrer-when-downgrade"
                                      className="w-full max-w-full rounded"
                                      style={{ aspectRatio: '16/9' }}
                                    />
                                  </div>
                                );
                              }
                            }
                            // Regular link
                            return <a href={href} target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300" {...props}>{children}</a>;
                          },
                          code: ({ node, inline, className, children, ...props }: any) => {
                            const match = /language-([\w-]+)/.exec(className || "");
                            const language = match?.[1]?.toLowerCase();
                            const content = String(children).replace(/\n$/, "");

                            // Use CopyableCodeBlock for all code blocks
                            return (
                              <CopyableCodeBlock 
                                inline={inline} 
                                className={inline ? "bg-gray-900 px-1 rounded text-green-400" : className || "bg-gray-900 rounded p-4 overflow-x-auto"}
                              >
                                {children}
                              </CopyableCodeBlock>
                            );
                          },
                        }}
                      >
                        {(() => {
                          // Decode if it's a data URL
                          if (isDataUrl && fileContent.startsWith('data:text/markdown')) {
                            try {
                              const base64Match = fileContent.match(/data:text\/markdown[^,]*base64,(.+)/);
                              if (base64Match && base64Match[1]) {
                                return atob(base64Match[1]);
                              } else {
                                const urlMatch = fileContent.match(/data:text\/markdown[^,]*, (.+)/);
                                if (urlMatch && urlMatch[1]) {
                                  return decodeURIComponent(urlMatch[1]);
                                }
                              }
                            } catch (e) {
                              console.error('Failed to decode Markdown data URL:', e);
                            }
                          }
                          return fileContent;
                        })()}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    // Code mode: Show as text with syntax highlighting using CodeViewer
                    <CodeViewer 
                      content={(() => {
                        // Decode if it's a data URL
                        if (isDataUrl && fileContent.startsWith('data:text/markdown')) {
                          try {
                            const base64Match = fileContent.match(/data:text\/markdown[^,]*base64,(.+)/);
                            if (base64Match && base64Match[1]) {
                              return atob(base64Match[1]);
                            } else {
                              const urlMatch = fileContent.match(/data:text\/markdown[^,]*, (.+)/);
                              if (urlMatch && urlMatch[1]) {
                                return decodeURIComponent(urlMatch[1]);
                              }
                            }
                          } catch (e) {
                            console.error('Failed to decode Markdown data URL:', e);
                          }
                        }
                        return fileContent;
                      })()}
                      filePath={selectedFile}
                      entity={resolvedParams.entity}
                      repo={resolvedParams.repo}
                      branch={selectedBranch}
                    />
                  )
                ) : (fileType === 'code' || fileType === 'json' || fileType === 'xml' || fileType === 'yaml' || fileType === 'csv' || fileType === 'text') && fileContent ? (
                  // Code, JSON, XML, YAML, CSV, and text files: Show with syntax highlighting and code snippet sharing
                  <CodeViewer 
                    content={fileContent}
                    filePath={selectedFile}
                    entity={resolvedParams.entity}
                    repo={resolvedParams.repo}
                    branch={selectedBranch}
                  />
                ) : isBinaryUrl ? (
                  <div className="text-center p-8">
                    <p className="text-gray-400 mb-4">
                      {fileType === 'image' || fileType === 'video' || fileType === 'audio' || fileType === 'pdf' 
                        ? 'File preview not available' 
                        : 'Binary file preview not available'}
                    </p>
                    {selectedFile && (() => {
                      const fileName = selectedFile.split('/').pop() || 'file';
                      const ext = fileName.split('.').pop()?.toLowerCase() || '';
                      const isArchive = ['zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar', 'dmg', 'deb', 'rpm', 'pkg'].includes(ext);
                      const isInstaller = ['exe', 'msi', 'msix', 'dmg', 'pkg', 'deb', 'rpm', 'apk', 'ipa', 'appimage', 'snap'].includes(ext);
                      const isExecutable = ['bin', 'exe', 'app', 'sh', 'bat', 'cmd'].includes(ext);
                      
                      return (
                        <>
                          <p className="text-gray-500 text-sm mb-4">
                            File type: {fileType || 'binary'}
                            {isArchive && ' (Archive)'}
                            {isInstaller && ' (Installer)'}
                            {isExecutable && ' (Executable)'}
                          </p>
                          <p className="text-gray-500 text-xs mb-4">
                            {isArchive && 'This is an archive file. Extract it to view contents.'}
                            {isInstaller && 'This is an installer package. Run it to install the software.'}
                            {isExecutable && 'This is an executable file. Run it to execute the program.'}
                          </p>
                        </>
                      );
                    })()}
                    <a 
                      href={fileContent} 
                      download={selectedFile?.split('/').pop() || 'file'}
                      className="inline-block px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded transition"
                    >
                      Download {selectedFile?.split('/').pop() || 'file'}
                    </a>
                  </div>
                  ) : (
                  <>
                    {proposeEdit ? (
                      <div className="space-y-2">
                        <textarea
                          className="w-full h-[60vh] bg-[#0E1116] border border-[#383B42] text-white p-3 rounded font-mono text-sm"
                          value={proposedContent}
                          onChange={(e)=>setProposedContent(e.target.value)}
                        />
                        <div className="flex items-center gap-3">
                          <>
                            <button
                              className="px-3 py-1 border border-purple-500 bg-purple-600 hover:bg-purple-700 rounded"
                              onClick={async () => {
                                if (!selectedFile) return;
                                const before = fileContent || "";
                                const after = proposedContent;
                                if (after === before) { 
                                  setProposeEdit(false);
                                  setProposedContent("");
                                  return; 
                                }
                                
                                try {
                                  // For both owners and non-owners: save as pending edit and redirect to PR creation
                                  // This allows owners to create PRs with multiple files instead of auto-committing
                                  const { addPendingEdit } = await import("@/lib/pending-changes");
                                  addPendingEdit(
                                    resolvedParams.entity,
                                    resolvedParams.repo,
                                    currentUserPubkey || "",
                                    {
                                      path: selectedFile,
                                      before,
                                      after,
                                      type: "edit",
                                      timestamp: Date.now(),
                                    }
                                  );
                                  setProposeEdit(false);
                                  setProposedContent("");
                                  window.location.href = `/${resolvedParams.entity}/${resolvedParams.repo}/pulls/new`;
                                } catch (error) {
                                  console.error('Failed to create PR/commit:', error);
                                  alert('Failed to save changes. Please try again.');
                                }
                              }}
                            >
                              Create Pull Request
                            </button>
                            <button
                              className="px-3 py-1 border border-gray-500 bg-gray-700 rounded"
                              onClick={() => { 
                                setProposeEdit(false); 
                                setProposedContent("");
                              }}
                            >
                              Cancel
                            </button>
                          </>
                        </div>
                      </div>
                    ) : (
                      <CodeViewer 
                        content={fileContent} 
                        filePath={selectedFile} 
                        entity={resolvedParams.entity}
                        repo={resolvedParams.repo}
                        branch={selectedBranch}
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      <aside className="col-span-1 lg:col-span-1 xl:col-span-1 space-y-2" suppressHydrationWarning>
        <div className="flex justify-between">
          <h3 className="font-bold">About</h3>
          {mounted && isOwner && (
            <a 
              href={getRepoLink("settings")}
              onClick={(e) => { e.preventDefault(); window.location.href = getRepoLink("settings"); }}
            >
              <Settings className="text-gray-400 h-4 w-4 hover:text-purple-500 cursor-pointer" />
            </a>
          )}
        </div>
        <div className="pb-2 prose prose-invert max-w-none prose-p:text-sm prose-p:text-gray-300 prose-a:text-purple-400 prose-a:no-underline hover:prose-a:underline" suppressHydrationWarning>
          {mounted && repoData?.description ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={{
                a: ({ node, href, children, ...props }: any) => {
                  // Convert YouTube URLs to embeds
                  if (href && typeof href === 'string') {
                    const youtubeRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
                    const match = href.match(youtubeRegex);
                    if (match && match[1]) {
                      const videoId = match[1];
                      return (
                        <div className="my-4">
                          <iframe
                            width="560"
                            height="315"
                            src={`https://www.youtube.com/embed/${videoId}`}
                            title="YouTube video player"
                            frameBorder="0"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            allowFullScreen
                            referrerPolicy="no-referrer-when-downgrade"
                            className="w-full max-w-full rounded"
                            style={{ aspectRatio: '16/9' }}
                          />
                        </div>
                      );
                    }
                  }
                  // Regular link
                  return <a href={href} target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300" {...props}>{children}</a>;
                },
              }}
            >
              {repoData.description}
            </ReactMarkdown>
          ) : (
            <p className="text-gray-500">No description available</p>
          )}
        </div>
        
        {/* Source URL / Git Server Info */}
        {mounted && repoData?.sourceUrl ? (
          <div className="pt-2 border-t border-gray-700" suppressHydrationWarning>
            <p className="text-xs text-gray-400 mb-1">Git Server</p>
            <a 
              href={repoData.sourceUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-sm text-purple-400 hover:text-purple-300 hover:underline break-all"
            >
              {repoData.sourceUrl.replace(/^https?:\/\//, '').replace(/\.git$/, '')}
            </a>
            <p className="text-xs text-gray-500 mt-1">
              Files are stored on this git server (per NIP-34 architecture)
            </p>
          </div>
        ) : null}
        
        {mounted && (httpCloneUrls.length > 0 || sshCloneUrls.length > 0 || nostrCloneUrls.length > 0) ? (
          <div className="pt-2 border-t border-gray-700">
            <button
              onClick={() => setCloneUrlsExpanded(!cloneUrlsExpanded)}
              className="flex items-center justify-between w-full text-xs text-gray-400 hover:text-gray-300 mb-1"
            >
              <span>Clone URLs (from NIP-34 event)</span>
              {cloneUrlsExpanded ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>
            {cloneUrlsExpanded && (
              <div className="space-y-3 mt-2">
                {(httpCloneUrls.length > 0 || sshCloneUrls.length > 0) && (
                  <div className="space-y-1">
                    {[...httpCloneUrls, ...sshCloneUrls].map((url, idx) => {
                      const command = `git clone ${url}`;
                      return (
                        <div
                          key={`std-clone-${idx}`}
                          className="flex items-center gap-2 text-xs"
                        >
                          <code className="flex-1 text-gray-100 bg-gray-900/70 px-2 py-1 rounded break-all">
                            {command}
            </code>
                          <button
                            className="text-purple-300 hover:text-purple-100 p-1 rounded hover:bg-white/5 transition-colors"
                            onClick={() => copyCloneCommand(command)}
                            title="Copy clone command"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {nostrCloneUrls.length > 0 && (
                  <div className="space-y-2 rounded border border-purple-900/40 bg-purple-900/10 p-2">
                    <p className="text-xs text-purple-200">nostr:// clone (requires git-remote-nostr)</p>
                    {nostrCloneUrls.map((url, idx) => {
                      const command = `git clone ${url}`;
                      return (
                        <div
                          key={`nostr-clone-${idx}`}
                          className="flex items-center gap-2 text-xs"
                        >
                          <code className="flex-1 text-purple-100 bg-purple-950/50 px-2 py-1 rounded break-all">
                            {command}
                          </code>
                          <button
                            className="text-purple-200 hover:text-white p-1 rounded hover:bg-white/5 transition-colors"
                            onClick={() => copyCloneCommand(command)}
                            title="Copy clone command"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                    <p className="text-[11px] text-purple-200/80 leading-snug">
                      Compatible with other clients. Install{" "}
                      <a
                        href="https://github.com/aljazceru/awesome-nostr#git"
                        target="_blank"
                        rel="noreferrer"
                        className="underline hover:text-white"
                      >
                        git-remote-nostr
                      </a>{" "}
                      to use nostr:// clone URLs.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
        
        {/* Push to Nostr button for local repos */}
        {mounted ? (() => {
          try {
            const repos = loadStoredRepos();
            // CRITICAL: Use findRepoByEntityAndName to support npub format
            const repo = findRepoByEntityAndName(repos, resolvedParams.entity, decodedRepo);
            
            // Check ownership even if repo is not in localStorage
            const ownsByRepoRecord = currentUserPubkey && repo?.ownerPubkey &&
              currentUserPubkey.toLowerCase() === repo.ownerPubkey.toLowerCase();
            const repoIsOwnerFlag = repoIsOwner || Boolean(ownsByRepoRecord);
            
            // If repo is missing from localStorage but user owns it, show re-import option
            if (!repo && repoIsOwnerFlag && currentUserPubkey) {
              return (
                <div className="mb-4 pb-4 border-b border-lightgray">
                  <h3 className="text-sm font-semibold mb-2">Repository Status</h3>
                  <p className="text-sm text-gray-400 mb-3">
                    Repository data not found. You can re-import it from the original source.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const sourceUrl = prompt("Enter the repository URL (GitHub, GitLab, or Codeberg):");
                      if (sourceUrl) {
                        window.location.href = `/import?sourceUrl=${encodeURIComponent(sourceUrl)}`;
                      }
                    }}
                  >
                    Re-import Repository
                  </Button>
                </div>
              );
            }
            
            if (!repo) {
              return null;
            }
            
            let status = getRepoStatus(repo);
            
            // CRITICAL: Reset "pushing" status if it's been stuck for more than 5 minutes
            // This handles cases where push was canceled or failed but status wasn't reset
            if (status === "pushing" && repo.status === "pushing") {
              const lastPushAttempt = (repo as any).lastPushAttempt || 0;
              const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
              if (lastPushAttempt < fiveMinutesAgo) {
                // Status stuck for more than 5 minutes - reset to local
                setRepoStatus(resolvedParams.repo, resolvedParams.entity, "local");
                status = "local";
                console.log("🔄 [Push Button] Reset stuck 'pushing' status to 'local'");
              }
            }
            
            // Show refetch button if repo has sourceUrl (imported from GitHub/GitLab/Codeberg) OR is synced from Nostr
            // Also show if user owns it and repo has files (even if missing sourceUrl, they might want to refetch from Nostr)
            // CRITICAL: Check multiple sources in priority order:
            // 1. effectiveSourceUrl state (from useEffect - includes clone URL extraction)
            // 2. repoData.sourceUrl (React state)
            // 3. repo.sourceUrl (localStorage)
            // 4. Clone URLs from repoData or repo (extract GitHub/GitLab/Codeberg URLs)
            // Check clone URLs as fallback (for repos synced from Nostr that have clone URLs but no sourceUrl)
            const hasCloneUrl = (
              ((repoData as any)?.clone && Array.isArray((repoData as any).clone) && (repoData as any).clone.some((url: string) => 
                url && typeof url === "string" && (
                  url.includes("github.com") || 
                  url.includes("gitlab.com") || 
                  url.includes("codeberg.org")
                )
              )) ||
              (repo.clone && Array.isArray(repo.clone) && repo.clone.some((url: string) => 
                url && typeof url === "string" && (
                  url.includes("github.com") || 
                  url.includes("gitlab.com") || 
                  url.includes("codeberg.org")
                )
              ))
            );
            
            const hasSourceUrl = (
              (effectiveSourceUrl && typeof effectiveSourceUrl === "string" && (
                effectiveSourceUrl.includes("github.com") || 
                effectiveSourceUrl.includes("gitlab.com") || 
                effectiveSourceUrl.includes("codeberg.org")
              )) ||
              (repoData?.sourceUrl && typeof repoData.sourceUrl === "string" && (
                repoData.sourceUrl.includes("github.com") || 
                repoData.sourceUrl.includes("gitlab.com") || 
                repoData.sourceUrl.includes("codeberg.org")
              )) ||
              (repo.sourceUrl && typeof repo.sourceUrl === "string" && (
                repo.sourceUrl.includes("github.com") || 
                repo.sourceUrl.includes("gitlab.com") || 
                repo.sourceUrl.includes("codeberg.org")
              )) ||
              hasCloneUrl
            );
            
            // Debug logging
            if (repoIsOwnerFlag && !hasSourceUrl) {
              console.log("🔍 [Refetch Button Debug] hasSourceUrl is false:", {
                effectiveSourceUrl,
                repoDataSourceUrl: repoData?.sourceUrl,
                repoSourceUrl: repo.sourceUrl,
                hasCloneUrl,
                repoDataClone: (repoData as any)?.clone,
                repoClone: repo.clone,
              });
            }
            const isNostrRepo = repo.syncedFromNostr || repo.lastNostrEventId || repo.nostrEventId;
            const hasLocalEdits = repo.hasUnpushedEdits || (repo.files && Array.isArray(repo.files) && repo.files.length > 0);
            // Show refetch if: (has sourceUrl OR is Nostr repo) AND user owns it AND (has local edits OR no files found)
            // OR if user owns it but sourceUrl is missing (needs re-import)
            const showRefetchButton = (hasSourceUrl || isNostrRepo) && repoIsOwnerFlag && (hasLocalEdits || !repo.files || repo.files.length === 0);
            // Show re-import button if repo exists but has no sourceUrl and user owns it
            const showReimportButton = !hasSourceUrl && !isNostrRepo && repoIsOwnerFlag && currentUserPubkey;
            
            // Debug log removed - too verbose on every render
            // if (!repoIsOwnerFlag || !currentUserPubkey || !publish || !subscribe || !defaultRelays || defaultRelays.length === 0) {
            //   console.log("🔍 [Push Button] Button not showing because:", {...});
            // }
            
            // CRITICAL: Show push button for ALL repos the user owns, regardless of status
            // This allows users to push/re-push their repos at any time
            if (repoIsOwnerFlag && currentUserPubkey && publish && subscribe && defaultRelays && defaultRelays.length > 0) {
              return (
                <div className="mb-4 pb-4 border-b border-lightgray">
                  <h3 className="text-sm font-semibold mb-2">Repository Status</h3>
                  
                  {/* Re-import button - shown when repo exists but sourceUrl is missing */}
                  {showReimportButton && (
                    <div className="mb-3">
                      <p className="text-sm text-gray-400 mb-2">
                        Repository data is incomplete. Re-import from the original source to restore files.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const sourceUrl = prompt("Enter the repository URL (GitHub, GitLab, or Codeberg):");
                          if (sourceUrl) {
                            window.location.href = `/import?sourceUrl=${encodeURIComponent(sourceUrl)}`;
                          }
                        }}
                      >
                        Re-import Repository
                      </Button>
                    </div>
                  )}
                  
                  {/* Refetch button - works for both GitHub/GitLab/Codeberg AND Nostr repos */}
                  {showRefetchButton && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isRefetching || isPushing}
                        onClick={async () => {
                        // CRITICAL: Check for sourceUrl in local repo OR in Nostr event
                        // This ensures repos imported from GitHub but synced from Nostr can still refetch from GitHub
                        let effectiveSourceUrl = repo?.sourceUrl;
                        
                        // If no sourceUrl in local repo, try to get it from Nostr event
                        if (!effectiveSourceUrl && isNostrRepo) {
                          try {
                            const ownerPubkey = repo?.ownerPubkey || (resolvedParams.entity.startsWith("npub") 
                              ? (nip19.decode(resolvedParams.entity).data as string)
                              : resolvedParams.entity);
                            const repoName = repo?.repo || repo?.slug || resolvedParams.repo;
                            
                            if (ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey) && subscribe && defaultRelays && defaultRelays.length > 0) {
                              await new Promise<void>((resolve, reject) => {
                                const timeout = setTimeout(() => {
                                  unsub();
                                  resolve(); // Timeout - continue without sourceUrl
                                }, 5000);
                                
                                const unsub = subscribe(
                                  [{
                                    kinds: [KIND_REPOSITORY, KIND_REPOSITORY_NIP34],
                                    authors: [ownerPubkey],
                                    "#d": [repoName],
                                  }],
                                  defaultRelays,
                                  (event) => {
                                    // Extract sourceUrl from "source" tag
                                    for (const tag of event.tags) {
                                      if (tag[0] === "source" && tag[1]) {
                                        effectiveSourceUrl = tag[1];
                                        console.log(`✅ [Refetch] Found sourceUrl in Nostr event: ${effectiveSourceUrl}`);
                                        clearTimeout(timeout);
                                        break;
                                      }
                                    }
                                  },
                                  undefined,
                                  () => {
                                    clearTimeout(timeout);
                                    unsub();
                                    resolve();
                                  }
                                );
                              });
                            }
                          } catch (e) {
                            console.warn("⚠️ [Refetch] Failed to get sourceUrl from Nostr event:", e);
                          }
                        }
                        
                        // Check if we have a valid sourceUrl (GitHub/GitLab/Codeberg)
                        const hasEffectiveSourceUrl = effectiveSourceUrl && typeof effectiveSourceUrl === "string" && (
                          effectiveSourceUrl.includes("github.com") || 
                          effectiveSourceUrl.includes("gitlab.com") || 
                          effectiveSourceUrl.includes("codeberg.org")
                        );
                        
                        // Handle refetch for GitHub/GitLab/Codeberg repos
                        if (hasEffectiveSourceUrl) {
                        if (!effectiveSourceUrl) {
                          alert("No source URL found for this repository");
                          return;
                        }
                        
                        try {
                          setIsRefetching(true);
                            console.log(`🔄 [Refetch] Starting refetch for ${resolvedParams.repo} from source: ${effectiveSourceUrl}`);
                          
                          // Call import API to fetch latest from GitHub/GitLab/Codeberg
                          console.log(`📡 [Refetch] Calling /api/import with sourceUrl: ${effectiveSourceUrl}`);
                          const importResponse = await fetch("/api/import", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ sourceUrl: effectiveSourceUrl }),
                          });
                          
                          console.log(`📡 [Refetch] Import API response status: ${importResponse.status}`);
                          
                          if (!importResponse.ok) {
                            const errorText = await importResponse.text();
                            console.error(`❌ [Refetch] Import API failed: ${importResponse.status} - ${errorText.substring(0, 500)}`);
                            throw new Error(`Import failed: ${importResponse.status} - ${errorText.substring(0, 200)}`);
                          }
                          
                          const importData = await importResponse.json();
                          
                          console.log(`✅ [Refetch] Import API returned data:`, {
                            status: importData.status,
                            filesCount: importData.files?.length || 0,
                            hasReadme: !!importData.readme,
                            hasDescription: !!importData.description,
                            filesArray: importData.files ? importData.files.slice(0, 5) : null, // First 5 files for debugging
                            allKeys: Object.keys(importData),
                          });
                          
                          if (importData.status !== "completed") {
                            console.error(`❌ [Refetch] Import status is not 'completed': ${importData.status}`);
                            throw new Error(`Import failed: ${importData.status}`);
                          }
                          
                          // Validate that we got files back
                          if (!importData.files || !Array.isArray(importData.files)) {
                            console.error(`❌ [Refetch] Import API returned invalid files:`, {
                              files: importData.files,
                              isArray: Array.isArray(importData.files),
                              type: typeof importData.files,
                            });
                            throw new Error(`Import API returned invalid files data. Expected array, got: ${typeof importData.files}`);
                          }
                          
                          // Update repo in localStorage with new data
                          const repos = loadStoredRepos();
                          const repoIndex = repos.findIndex((r: any) => 
                            (r.slug === resolvedParams.repo || r.repo === resolvedParams.repo) && r.entity === resolvedParams.entity
                          );
                          
                          if (repoIndex >= 0) {
                            const existingRepo = repos[repoIndex];
                            if (!existingRepo) return;
                            
                            // Build links array - add GitHub Pages if available
                            let links = existingRepo.links || [];
                            if (importData.homepage && typeof importData.homepage === "string" && importData.homepage.trim().length > 0) {
                              // Check if homepage link already exists
                              const homepageExists = links.some((l: any) => l.url === importData.homepage.trim());
                              if (!homepageExists) {
                                links.push({
                                  type: "docs",
                                  url: importData.homepage.trim(),
                                  label: "OPEN HERE"
                                });
                              }
                            }
                            
                          // CRITICAL: Refetch is a FULL REPLACEMENT from GitHub (source of truth)
                          // This means:
                          // - COMPLETE REPLACEMENT: Delete all local files, import everything from GitHub
                          // - Files on GitHub → Add them
                          // - Files locally but not on GitHub → DELETE them (they were deleted on GitHub)
                          // - GitHub is the absolute source of truth - no merging, no safety checks
                          
                          const githubFiles = importData.files || [];
                          
                          console.log(`🔄 [Refetch] Full replacement from GitHub:`, {
                            githubFilesTotal: githubFiles.length,
                            githubFiles: githubFiles.filter((f: any) => f.type === "file").length,
                            githubDirs: githubFiles.filter((f: any) => f.type === "dir").length,
                            localFilesBefore: (existingRepo.files || []).filter((f: any) => f.type === "file").length,
                            importDataFilesLength: importData.files?.length || 0,
                          });
                          
                          // FULL REPLACEMENT: Use GitHub files exactly as returned (no merging, no safety checks)
                          // CRITICAL: Only replace if we actually got files from GitHub
                          // If GitHub API failed or returned empty, preserve existing files
                          if (githubFiles.length === 0) {
                            console.warn(`⚠️ [Refetch] GitHub returned no files - preserving existing ${(existingRepo.files || []).length} local files`);
                            // Don't update files if GitHub returned empty (might be API error)
                            setIsRefetching(false);
                            return;
                          }
                          
                          const newFiles = githubFiles;
                          
                          console.log(`🔄 [Refetch] Replacing local files with ${newFiles.length} files from GitHub (full replacement)`);
                          
                          // CRITICAL: Detect if there's a diff between local and GitHub
                          // This determines if we should mark as having unpushed edits
                          const localFiles = existingRepo.files || [];
                          const localFileMap = new Map(
                            localFiles
                              .filter((f: any) => f.type === "file")
                              .map((f: any) => [f.path, f])
                          );
                          const githubFileMap = new Map(
                            newFiles
                              .filter((f: any) => f.type === "file")
                              .map((f: any) => [f.path, f])
                          );
                          
                          // Check for differences:
                          // 1. Files added (in GitHub but not local)
                          // 2. Files removed (in local but not GitHub)
                          // 3. Files modified (different content)
                          // 4. Metadata changes (readme, description, etc.)
                          const addedFiles = Array.from(githubFileMap.keys()).filter(path => !localFileMap.has(path));
                          const removedFiles = Array.from(localFileMap.keys()).filter(path => !githubFileMap.has(path));
                          const modifiedFiles: string[] = [];
                          
                          // Check for content changes in existing files
                          for (const [path, githubFile] of githubFileMap.entries()) {
                            const localFile = localFileMap.get(path);
                            if (localFile) {
                              // Compare content (handle both text and binary)
                              const localContent = String((localFile as any).content || "");
                              const githubContent = String((githubFile as any).content || "");
                              const localIsBinary = Boolean((localFile as any).isBinary || false);
                              const githubIsBinary = Boolean((githubFile as any).isBinary || false);
                              
                              // Content changed if: binary flag changed, or content string differs
                              if (localIsBinary !== githubIsBinary || localContent !== githubContent) {
                                modifiedFiles.push(String(path));
                              }
                            }
                          }
                          
                          // Check metadata changes
                          const readmeChanged = (importData.readme || "") !== (existingRepo.readme || "");
                          const descriptionChanged = (importData.description || "") !== (existingRepo.description || "");
                          const metadataChanged = readmeChanged || descriptionChanged;
                          
                          const hasDiff = addedFiles.length > 0 || removedFiles.length > 0 || modifiedFiles.length > 0 || metadataChanged;
                          
                          console.log(`🔍 [Refetch] Diff detection:`, {
                            hasDiff,
                            addedFiles: addedFiles.length,
                            removedFiles: removedFiles.length,
                            modifiedFiles: modifiedFiles.length,
                            metadataChanged,
                            wasLive: !!(existingRepo.lastNostrEventId || existingRepo.nostrEventId || existingRepo.syncedFromNostr),
                          });
                          
                          // Update repo with COMPLETE REPLACEMENT from GitHub (GitHub is absolute source of truth)
                          // CRITICAL: Preserve sourceUrl from effectiveSourceUrl (from Nostr event) or existing repo
                          // This ensures bridge sync doesn't trigger for GitHub repos
                          const updatedSourceUrl = effectiveSourceUrl || existingRepo.sourceUrl || importData.sourceUrl || "";
                          repos[repoIndex] = {
                            ...existingRepo,
                            sourceUrl: updatedSourceUrl, // CRITICAL: Preserve sourceUrl to prevent bridge sync
                            files: newFiles, // COMPLETE REPLACEMENT - use GitHub files exactly as returned
                            readme: importData.readme || existingRepo.readme,
                            description: importData.description || existingRepo.description,
                            stars: importData.stars !== undefined ? importData.stars : existingRepo.stars,
                            forks: importData.forks !== undefined ? importData.forks : existingRepo.forks,
                            languages: importData.languages || existingRepo.languages,
                            topics: importData.topics || existingRepo.topics,
                            defaultBranch: importData.defaultBranch || existingRepo.defaultBranch,
                            // CRITICAL: Include issues, pulls, commits, releases for imported repos
                            branches: importData.branches || existingRepo.branches,
                            issues: importData.issues || existingRepo.issues || [],
                            pulls: importData.pulls || existingRepo.pulls || [],
                            commits: importData.commits || existingRepo.commits || [],
                            links: links.length > 0 ? links : existingRepo.links,
                            // Note: releases and lastModifiedAt are not part of StoredRepo interface but may exist at runtime
                            ...(importData.releases || (existingRepo as StoredRepo & { releases?: unknown[] }).releases ? { releases: importData.releases || (existingRepo as StoredRepo & { releases?: unknown[] }).releases || [] } : {}),
                            ...({ lastModifiedAt: Date.now() } as { lastModifiedAt: number }),
                          } as StoredRepo & { releases?: unknown[]; lastModifiedAt?: number };
                          
                          // CRITICAL: Update effectiveSourceUrl state immediately so button text updates
                          if (updatedSourceUrl && (
                            updatedSourceUrl.includes("github.com") || 
                            updatedSourceUrl.includes("gitlab.com") || 
                            updatedSourceUrl.includes("codeberg.org")
                          )) {
                            setEffectiveSourceUrl(updatedSourceUrl);
                          }
                          
                          // CRITICAL: Update repoData state immediately so button text updates
                          setRepoData((prev: any) => ({
                            ...prev,
                            sourceUrl: updatedSourceUrl,
                            files: newFiles,
                            readme: importData.readme || prev?.readme,
                            description: importData.description || prev?.description,
                            stars: importData.stars !== undefined ? importData.stars : prev?.stars,
                            forks: importData.forks !== undefined ? importData.forks : prev?.forks,
                            languages: importData.languages || prev?.languages,
                            topics: importData.topics || prev?.topics,
                            defaultBranch: importData.defaultBranch || prev?.defaultBranch,
                            branches: importData.branches || prev?.branches,
                            issues: importData.issues || prev?.issues || [],
                            pulls: importData.pulls || prev?.pulls || [],
                            commits: importData.commits || prev?.commits || [],
                            links: links.length > 0 ? links : prev?.links,
                          }));
                          
                          // CRITICAL: Also save files to separate storage key (for optimized storage)
                          // This ensures file list is available even if repo object is large
                          try {
                            saveRepoFiles(resolvedParams.entity, resolvedParams.repo, newFiles as RepoFileEntry[]);
                            console.log(`✅ [Refetch] Saved ${newFiles.length} files to separate storage key`);
                          } catch (e: any) {
                            if (e.name === 'QuotaExceededError' || e.message?.includes('quota')) {
                              console.error(`❌ [Refetch] Quota exceeded when saving files separately`);
                            } else {
                              console.error(`❌ [Refetch] Failed to save files separately:`, e);
                            }
                          }
                          
                          // CRITICAL: Also save issues, pulls, and commits to separate localStorage keys
                          if (importData.issues && Array.isArray(importData.issues) && importData.issues.length > 0) {
                            try {
                              const issuesKey = getRepoStorageKey("gittr_issues", resolvedParams.entity, resolvedParams.repo);
                              const formattedIssues = importData.issues.map((issue: any) => ({
                                id: `issue-${issue.number}`,
                                entity: resolvedParams.entity,
                                repo: resolvedParams.repo,
                                title: issue.title || "",
                                number: String(issue.number || ""),
                                status: issue.state === "closed" ? "closed" : "open",
                                author: issue.user?.login || "",
                                labels: issue.labels?.map((l: any) => l.name || l) || [],
                                assignees: [],
                                createdAt: issue.created_at ? new Date(issue.created_at).getTime() : Date.now(),
                                body: issue.body || "",
                                html_url: issue.html_url || "",
                              }));
                              localStorage.setItem(issuesKey, JSON.stringify(formattedIssues));
                              console.log(`✅ [Refetch] Saved ${formattedIssues.length} issues`);
                            } catch (e) {
                              console.error(`❌ [Refetch] Failed to save issues:`, e);
                            }
                          }
                          
                          if (importData.pulls && Array.isArray(importData.pulls) && importData.pulls.length > 0) {
                            try {
                              const pullsKey = getRepoStorageKey("gittr_prs", resolvedParams.entity, resolvedParams.repo);
                              const formattedPRs = importData.pulls.map((pr: any) => ({
                                id: `pr-${pr.number}`,
                                entity: resolvedParams.entity,
                                repo: resolvedParams.repo,
                                title: pr.title || "",
                                number: String(pr.number || ""),
                                status: pr.merged_at ? "merged" : (pr.state === "closed" ? "closed" : "open"),
                                author: pr.user?.login || "",
                                labels: pr.labels?.map((l: any) => l.name || l) || [],
                                assignees: [],
                                createdAt: pr.created_at ? new Date(pr.created_at).getTime() : Date.now(),
                                body: pr.body || "",
                                html_url: pr.html_url || "",
                                merged_at: pr.merged_at || null,
                                head: pr.head?.ref || null,
                                base: pr.base?.ref || null,
                              }));
                              localStorage.setItem(pullsKey, JSON.stringify(formattedPRs));
                              console.log(`✅ [Refetch] Saved ${formattedPRs.length} pull requests`);
                            } catch (e) {
                              console.error(`❌ [Refetch] Failed to save pull requests:`, e);
                            }
                          }
                          
                          if (importData.commits && Array.isArray(importData.commits) && importData.commits.length > 0) {
                            try {
                              const commitsKey = getRepoStorageKey("gittr_commits", resolvedParams.entity, resolvedParams.repo);
                              interface CommitData {
                                sha?: string;
                                message?: string;
                                author?: { email?: string; name?: string; date?: string };
                                committer?: { email?: string; name?: string; date?: string };
                                html_url?: string;
                              }
                              const formattedCommits = (importData.commits as CommitData[]).map((commit) => ({
                                id: commit.sha || `commit-${Date.now()}`,
                                message: commit.message || "",
                                author: commit.author?.email || commit.committer?.email || "",
                                authorName: commit.author?.name || commit.committer?.name || "",
                                timestamp: (commit.author?.date || commit.committer?.date)
                                  ? new Date(commit.author?.date || commit.committer?.date || "").getTime() 
                                  : Date.now(),
                                branch: importData.defaultBranch || "main",
                                html_url: commit.html_url || "",
                              }));
                              localStorage.setItem(commitsKey, JSON.stringify(formattedCommits));
                              console.log(`✅ [Refetch] Saved ${formattedCommits.length} commits`);
                            } catch (e) {
                              console.error(`❌ [Refetch] Failed to save commits:`, e);
                            }
                          }
                            
                            // CRITICAL: Only mark as having unpushed edits if:
                            // 1. Repo was previously live on Nostr (has event ID)
                            // 2. AND there's an actual diff (files/metadata changed)
                            // This ensures the "Push to Nostr" button appears after refetch if there are changes
                            if (repoIndex >= 0 && repos[repoIndex]) {
                              const repoToUpdate = repos[repoIndex];
                              const wasLive = existingRepo.lastNostrEventId || existingRepo.nostrEventId || existingRepo.syncedFromNostr;
                              if (wasLive && hasDiff) {
                                repoToUpdate.hasUnpushedEdits = true;
                                markRepoAsEdited(resolvedParams.repo, resolvedParams.entity);
                                console.log(`📝 [Refetch] Marked repo as having unpushed edits after refetch (diff detected)`);
                              } else if (wasLive && !hasDiff) {
                                // No diff - clear unpushed edits flag if it was set
                                repoToUpdate.hasUnpushedEdits = false;
                                console.log(`✅ [Refetch] No diff detected - repo is in sync with GitHub`);
                              } else if (!wasLive && hasDiff) {
                                // Repo wasn't live, but now has changes from GitHub - mark as local with changes
                                // This will show "Push to Nostr" button for local repos
                                repoToUpdate.hasUnpushedEdits = false; // Local repos don't use this flag
                                repoToUpdate.status = "local"; // Ensure it's marked as local
                                console.log(`📝 [Refetch] Local repo updated from GitHub (not yet pushed to Nostr)`);
                              }
                            }
                            
                            saveStoredRepos(repos);
                            
                            // Verify files were saved
                            const savedRepos = loadStoredRepos();
                            const savedRepo = savedRepos.find((r: any) => 
                              (r.slug === resolvedParams.repo || r.repo === resolvedParams.repo) && r.entity === resolvedParams.entity
                            );
                            const savedFileCount = savedRepo?.files?.filter((f: any) => f.type === "file").length || 0;
                            
                            console.log(`✅ [Refetch] Updated repo:`, {
                              importFilesCount: importData.files?.length || 0,
                              savedFilesCount: savedFileCount,
                              savedRepoFilesLength: savedRepo?.files?.length || 0,
                              firstFewFiles: savedRepo?.files?.slice(0, 3),
                            });
                            
                            if (savedFileCount === 0 && (importData.files?.length || 0) > 0) {
                              console.error(`❌ [Refetch] Files were not saved correctly!`, {
                                importFiles: importData.files?.length || 0,
                                savedFiles: savedFileCount,
                              });
                              alert(`⚠️ Warning: Files were fetched (${importData.files?.length || 0}) but not saved correctly. Please check console for details.`);
                            } else {
                              // Reload page to show updated data
                              alert(`✅ Refetched from GitHub!\n\nFound ${savedFileCount} files.\n\nIf this repo was already pushed to Nostr, you'll need to push again to update it.`);
                              window.location.reload();
                            }
                          } else {
                            // Repo not in localStorage - CREATE it from fetched data
                            console.log(`📝 [Refetch] Repo not in localStorage, creating new entry from source`);
                            const githubFiles = importData.files || [];
                            const newFiles = githubFiles;
                            
                            const newRepo: StoredRepo = {
                              slug: resolvedParams.repo,
                              entity: resolvedParams.entity,
                              repo: resolvedParams.repo,
                              repositoryName: resolvedParams.repo,
                              name: importData.name || resolvedParams.repo,
                              sourceUrl: repo?.sourceUrl || importData.sourceUrl || "",
                              forkedFrom: repo?.sourceUrl || importData.sourceUrl || "",
                              readme: importData.readme || "",
                              files: newFiles,
                              description: importData.description || "",
                              stars: importData.stars || 0,
                              forks: importData.forks || 0,
                              languages: importData.languages || [],
                              topics: importData.topics || [],
                              defaultBranch: importData.defaultBranch || "main",
                              branches: importData.branches || [],
                              contributors: importData.contributors || [],
                              createdAt: Date.now(),
                              ownerPubkey: repo?.ownerPubkey || currentUserPubkey || undefined,
                            } as StoredRepo & { releases?: unknown[]; lastModifiedAt?: number };
                            
                            repos.push(newRepo);
                            saveStoredRepos(repos);
                            
                            alert(`✅ Refetched from GitHub!\n\nFound ${newFiles.filter((f: any) => f.type === "file").length} files.\n\nRepository created in localStorage.`);
                            window.location.reload();
                          }
                        } catch (error: any) {
                          console.error("Failed to refetch from source:", error);
                          alert(`❌ Failed to refetch: ${error.message || "Unknown error"}`);
                        } finally {
                          setIsRefetching(false);
                        }
                        return;
                        }
                        
                        // Handle refetch for Nostr repos
                        if (isNostrRepo) {
                          try {
                            setIsRefetching(true);
                            console.log(`🔄 [Refetch] Starting refetch for ${resolvedParams.repo} from Nostr`);
                            
                            // Get owner pubkey - handle case where repo might not be in localStorage
                            const ownerPubkey = repo?.ownerPubkey || (resolvedParams.entity.startsWith("npub") 
                              ? (nip19.decode(resolvedParams.entity).data as string)
                              : resolvedParams.entity);
                            
                            if (!ownerPubkey || !/^[0-9a-f]{64}$/i.test(ownerPubkey)) {
                              throw new Error("Could not determine repository owner");
                            }
                            
                            // Query Nostr for the latest repository event
                            const repoName = repo?.repo || repo?.slug || resolvedParams.repo;
                            let latestEvent: any = null;
                            let latestEventCreatedAt = 0;
                            
                            await new Promise<void>((resolve, reject) => {
                              if (!subscribe || !defaultRelays || defaultRelays.length === 0) {
                                reject(new Error("Nostr not available"));
                                return;
                              }
                              
                              const unsub = subscribe(
                                [{
                                  kinds: [KIND_REPOSITORY, KIND_REPOSITORY_NIP34],
                                  authors: [ownerPubkey],
                                  "#d": [repoName],
                                }],
                                defaultRelays,
                                (event, isAfterEose) => {
                                  // Collect all events and pick the latest
                                  if (event.created_at > latestEventCreatedAt) {
                                    latestEvent = event;
                                    latestEventCreatedAt = event.created_at;
                                  }
                                },
                                undefined,
                                () => {
                                  // EOSE - process the latest event
                                  unsub();
                                  if (!latestEvent) {
                                    reject(new Error("Repository not found on Nostr"));
                                    return;
                                  }
                                  resolve();
                                }
                              );
                              
                              // Timeout after 10 seconds
                              setTimeout(() => {
                                unsub();
                                if (!latestEvent) {
                                  reject(new Error("Timeout waiting for repository event"));
                                } else {
                                  resolve();
                                }
                              }, 10000);
                            });
                            
                            // Parse the latest event
                            let eventRepoData: any = {};
                            if (latestEvent.kind === KIND_REPOSITORY_NIP34) {
                              // Parse NIP-34 format
                              if (latestEvent.tags && Array.isArray(latestEvent.tags)) {
                                for (const tag of latestEvent.tags) {
                                  if (!Array.isArray(tag) || tag.length < 2) continue;
                                  const tagName = tag[0];
                                  const tagValue = tag[1];
                                  if (tagName === "d") eventRepoData.repositoryName = tagValue;
                                  else if (tagName === "name" && !eventRepoData.repositoryName) eventRepoData.repositoryName = tagValue;
                                  else if (tagName === "description") eventRepoData.description = tagValue;
                                  else if (tagName === "clone" && tagValue) {
                                    if (!eventRepoData.clone) eventRepoData.clone = [];
                                    eventRepoData.clone.push(tagValue);
                                  }
                                }
                              }
                              // Parse files from content if present
                              if (latestEvent.content) {
                                try {
                                  const contentData = JSON.parse(latestEvent.content);
                                  if (contentData.files) eventRepoData.files = contentData.files;
                                } catch {}
                              }
                            } else {
                              // Parse gitnostr format
                              eventRepoData = JSON.parse(latestEvent.content);
                            }
                            
                            // CRITICAL: Complete replacement from Nostr - erase localStorage and rewrite
                            const repos = loadStoredRepos();
                            const repoIndex = repos.findIndex((r: any) => 
                              (r.slug === resolvedParams.repo || r.repo === resolvedParams.repo) && r.entity === resolvedParams.entity
                            );
                            
                            if (repoIndex >= 0) {
                              const existingRepo = repos[repoIndex];
                              if (!existingRepo) {
                                // Repo index found but repo is null - create new entry
                                console.log(`📝 [Refetch] Repo index found but repo is null, creating new entry from Nostr`);
                                const newRepo: StoredRepo = {
                                  slug: resolvedParams.repo,
                                  entity: resolvedParams.entity,
                                  repo: eventRepoData.repositoryName || resolvedParams.repo,
                                  repositoryName: eventRepoData.repositoryName || resolvedParams.repo,
                                  name: eventRepoData.name || eventRepoData.repositoryName || resolvedParams.repo,
                                  readme: eventRepoData.readme || "",
                                  files: eventRepoData.files || [],
                                  description: eventRepoData.description || "",
                                  stars: eventRepoData.stars || 0,
                                  forks: eventRepoData.forks || 0,
                                  languages: eventRepoData.languages || [],
                                  topics: eventRepoData.topics || [],
                                  defaultBranch: eventRepoData.defaultBranch || "main",
                                  branches: eventRepoData.branches || [],
                                  contributors: eventRepoData.contributors || [],
                                  clone: eventRepoData.clone || [],
                                  nostrEventId: latestEvent.id,
                                  lastNostrEventId: latestEvent.id,
                                  syncedFromNostr: true,
                                  hasUnpushedEdits: false,
                                  ownerPubkey: ownerPubkey,
                                  createdAt: Date.now(),
                                } as StoredRepo & { lastNostrEventCreatedAt?: number; logoUrl?: string };
                                
                                repos[repoIndex] = newRepo;
                                saveStoredRepos(repos);
                                
                                alert(`✅ Refetched from Nostr!\n\nFound ${eventRepoData.files?.length || 0} files.\n\nRepository created in localStorage.`);
                                window.location.reload();
                                return;
                              }
                              
                              // COMPLETE REPLACEMENT: Use Nostr event data exactly as returned
                              repos[repoIndex] = {
                                ...existingRepo,
                                // Replace with Nostr data
                                files: eventRepoData.files || [],
                                name: eventRepoData.name || eventRepoData.repositoryName || existingRepo.name,
                                repo: eventRepoData.repositoryName || existingRepo.repo,
                                description: eventRepoData.description || existingRepo.description,
                                clone: eventRepoData.clone || existingRepo.clone,
                                // Update event metadata
                                nostrEventId: latestEvent.id,
                                lastNostrEventId: latestEvent.id,
                                syncedFromNostr: true,
                                // Clear unpushed edits flag (we just synced from Nostr)
                                hasUnpushedEdits: false,
                                // Preserve local-only data (logoUrl may not be in StoredRepo type but exists at runtime)
                                ...((existingRepo as any).logoUrl ? { logoUrl: (existingRepo as any).logoUrl } : {}),
                                // Store created_at timestamp in SECONDS (NIP-34 format) - not milliseconds
                                ...({ lastNostrEventCreatedAt: latestEvent.created_at } as any),
                              } as StoredRepo & { lastNostrEventCreatedAt?: number; logoUrl?: string };
                              
                              saveStoredRepos(repos);
                              
                              console.log(`✅ [Refetch] Refetched from Nostr:`, {
                                eventId: latestEvent.id.slice(0, 8),
                                filesCount: eventRepoData.files?.length || 0,
                                created_at: new Date(latestEvent.created_at * 1000).toISOString(),
                              });
                              
                              alert(`✅ Refetched from Nostr!\n\nFound ${eventRepoData.files?.length || 0} files.\n\nLocal edits have been replaced with the latest version from Nostr.`);
                              window.location.reload();
                            } else {
                              // Repo not in localStorage - CREATE it from Nostr data
                              console.log(`📝 [Refetch] Repo not in localStorage, creating new entry from Nostr`);
                              const newRepo: StoredRepo = {
                                slug: resolvedParams.repo,
                                entity: resolvedParams.entity,
                                repo: eventRepoData.repositoryName || resolvedParams.repo,
                                repositoryName: eventRepoData.repositoryName || resolvedParams.repo,
                                name: eventRepoData.name || eventRepoData.repositoryName || resolvedParams.repo,
                                readme: eventRepoData.readme || "",
                                files: eventRepoData.files || [],
                                description: eventRepoData.description || "",
                                stars: eventRepoData.stars || 0,
                                forks: eventRepoData.forks || 0,
                                languages: eventRepoData.languages || [],
                                topics: eventRepoData.topics || [],
                                defaultBranch: eventRepoData.defaultBranch || "main",
                                branches: eventRepoData.branches || [],
                                contributors: eventRepoData.contributors || [],
                                clone: eventRepoData.clone || [],
                                nostrEventId: latestEvent.id,
                                lastNostrEventId: latestEvent.id,
                                syncedFromNostr: true,
                                hasUnpushedEdits: false,
                                ownerPubkey: ownerPubkey,
                                createdAt: Date.now(),
                              } as StoredRepo & { lastNostrEventCreatedAt?: number; logoUrl?: string };
                              
                              repos.push(newRepo);
                              saveStoredRepos(repos);
                              
                              alert(`✅ Refetched from Nostr!\n\nFound ${eventRepoData.files?.length || 0} files.\n\nRepository created in localStorage.`);
                              window.location.reload();
                            }
                          } catch (error: any) {
                            console.error("Failed to refetch from Nostr:", error);
                            alert(`❌ Failed to refetch from Nostr: ${error.message || "Unknown error"}`);
                          } finally {
                            setIsRefetching(false);
                          }
                          return;
                        }
                      }}
                      className="w-full mb-2"
                    >
                      <RefreshCw className={`h-4 w-4 mr-2 ${isRefetching ? "animate-spin" : ""}`} />
                      {isRefetching 
                        ? (hasSourceUrl ? "Refetching from source..." : "Refetching from Nostr...") 
                        : (hasSourceUrl ? "Refetch from source" : "Refetch from Nostr")
                      }
                    </Button>
                    <p className="text-xs text-gray-500 mt-1 mb-2 px-1">
                      ⚠️ This will completely overwrite your local repository with the latest version from {hasSourceUrl ? `the source (${effectiveSourceUrl || repo.sourceUrl})` : "Nostr"}. 
                      Files deleted {hasSourceUrl ? "on the source" : "on Nostr"} will be removed locally. Local edits not pushed will be lost.
                    </p>
                    </>
                  )}
                  
                  {/* Push to Nostr button */}
                  {repoIsOwner && currentUserPubkey && publish && subscribe && defaultRelays && defaultRelays.length > 0 && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPushing || isRefetching}
                        onClick={async () => {
                          if (!currentUserPubkey || !publish || !subscribe || !defaultRelays) {
                            alert("Please log in to push repositories");
                            return;
                          }
                          
                          try {
                            // Check for NIP-07 first (preferred method)
                            const hasNip07 = typeof window !== "undefined" && window.nostr;
                            let privateKey: string | undefined;
                            
                            if (!hasNip07) {
                              // Fallback to stored private key only if NIP-07 not available
                              privateKey = await getNostrPrivateKey() || undefined;
                              if (!privateKey) {
                                alert("No signing method available.\n\nPlease use a NIP-07 extension (like Alby or nos2x) or configure a private key in Settings.");
                                return;
                              }
                            }
                            
                            setIsPushing(true);
                            
                            // Warn user if they try to leave during push
                            const beforeUnloadHandler = (e: BeforeUnloadEvent) => {
                              e.preventDefault();
                              e.returnValue = "Push is in progress! A second signature is required. Are you sure you want to leave?";
                              return e.returnValue;
                            };
                            window.addEventListener("beforeunload", beforeUnloadHandler);
                            
                            // CRITICAL: Validate repo before pushing (prevent signing corrupted repos)
                            const validation = validateRepoForForkOrSign(repo);
                            if (!validation.valid) {
                              alert(`Cannot push corrupted repository: ${validation.error}`);
                              setIsPushing(false);
                              return;
                            }
                            
                            // Track progress messages for user feedback
                            const progressMessages: string[] = [];
                            
                            // Flag to track when state event signature is about to happen
                            let stateEventReady = false;
                            
                            const result = await pushRepoToNostr({
                              repoSlug: resolvedParams.repo,
                              entity: resolvedParams.entity,
                              publish,
                              subscribe,
                              defaultRelays,
                              privateKey, // Optional - will use NIP-07 if available
                              pubkey: currentUserPubkey,
                              onProgress: (message) => {
                                console.log(`[Push ${resolvedParams.repo}] ${message}`);
                                progressMessages.push(message);
                                // Remove handler right before second signature (state event ready)
                                if (message.includes("Second signature prompt appearing now")) {
                                  stateEventReady = true;
                                  window.removeEventListener("beforeunload", beforeUnloadHandler);
                                }
                                // Show critical warnings as alerts
                                if (message.includes("⚠️ DO NOT close") || message.includes("Second signature")) {
                                  // Don't spam alerts, but show important ones
                                  if (progressMessages.filter(m => m.includes("⚠️ DO NOT close")).length === 1) {
                                    alert("⚠️ IMPORTANT: Please stay on this page!\n\nA second signature prompt will appear shortly.\n\nDo not close or navigate away until both signatures are complete.");
                                  }
                                }
                              },
                            });
                            
                            // Remove warning handler after push completes (if not already removed)
                            if (!stateEventReady) {
                              window.removeEventListener("beforeunload", beforeUnloadHandler);
                            }
                            
                            if (result.success && result.eventId) {
                              // Update state directly from push result
                              setNostrEventId(result.eventId);
                              
                              const bridgeOwnerPubkey =
                                repoOwnerPubkey ||
                                entityPubkey ||
                                (repo.ownerPubkey ? repo.ownerPubkey.toLowerCase() : null);
                              // CRITICAL: Don't bridge sync if repo has sourceUrl (GitHub/GitLab/Codeberg)
                              // Check both local repo sourceUrl AND effectiveSourceUrl (from Nostr event)
                              const hasAnySourceUrl = repo.sourceUrl || effectiveSourceUrl;
                              const shouldAutoBridge =
                                repoIsOwnerFlag &&
                                !hasAnySourceUrl &&
                                bridgeOwnerPubkey &&
                                result.filesForBridge &&
                                result.filesForBridge.length > 0;

                              if (shouldAutoBridge) {
                                try {
                                  await pushFilesToBridge({
                                    ownerPubkey: bridgeOwnerPubkey!,
                                    repoSlug: decodedRepo,
                                    entity: resolvedParams.entity,
                                    branch: repo.defaultBranch || repoData?.defaultBranch || "main",
                                    files: result.filesForBridge!,
                                  });
                                } catch (bridgeError: any) {
                                  console.error("Bridge sync failed:", bridgeError);
                                  alert(
                                    `⚠️ Repository event published but bridge sync failed: ${
                                      bridgeError?.message || bridgeError?.toString() || "Unknown error"
                                    }`
                                  );
                                }
                              }

                              // Show success message BEFORE reload (so user can see it)
                              if (result.confirmed && result.stateEventId) {
                                const announcementId = result.eventId?.slice(0, 16) || "unknown";
                                const stateId = result.stateEventId?.slice(0, 16) || "unknown";
                                alert(`✅ Repository pushed to Nostr!\n\n✅ Announcement event (30617): ${announcementId}...\n✅ State event (30618): ${stateId}...\n\nBoth events published and confirmed.\n\nPage will reload to show updated status.`);
                              } else if (result.stateEventId) {
                                // Both events published but not yet confirmed
                                const announcementId = result.eventId?.slice(0, 16) || "unknown";
                                const stateId = result.stateEventId?.slice(0, 16) || "unknown";
                                alert(`⚠️ Repository published but awaiting confirmation.\n\n✅ Announcement event (30617): ${announcementId}...\n✅ State event (30618): ${stateId}...\n\nBoth events published - confirmation may take a few moments.\n\nPage will reload to show updated status.`);
                              } else {
                                // Only first event published (shouldn't happen with the fix, but handle gracefully)
                                alert(`⚠️ Repository partially published.\n\nEvent ID: ${result.eventId?.slice(0, 16)}...\n\nSecond signature may not have completed. Please try pushing again.\n\nPage will reload.`);
                              }
                              
                              // Reload page data after push + bridge sync
                              window.location.reload();
                            } else {
                              alert(`❌ Failed to push: ${result.error || "Unknown error"}`);
                            }
                          } catch (error: any) {
                            console.error("Failed to push repo:", error);
                            alert(`Failed to push: ${error.message || "Unknown error"}`);
                          } finally {
                            setIsPushing(false);
                          }
                        }}
                        className="w-full"
                      >
                        <Upload className="h-4 w-4 mr-2" />
                        {isPushing ? "Pushing to Nostr..." : "Push to Nostr"}
                      </Button>
                      <p className="text-xs text-gray-500 mt-2">
                        Requires 2 signatures. Confirmed after both are signed.
                      </p>
                    </>
                  )}
                </div>
              );
            }
          } catch {}
          return null;
        })() : null}
        
        {mounted && showZap && currentUserPubkey && (
          <div className="mb-4 pb-4 border-b border-lightgray">
            <h3 className="text-sm font-semibold mb-2">Zap this repo</h3>
            <RepoZapButton
              repoId={`${resolvedParams.entity}/${resolvedParams.repo}`}
              ownerPubkey={(() => {
                // Resolve actual owner pubkey
                if (isOwner && currentUserPubkey) return currentUserPubkey;
                // Try to get owner pubkey from repo data or entity lookup
                try {
      const repos = loadStoredRepos();
      const repo = findRepoByEntityAndName<StoredRepo>(repos, resolvedParams.entity, decodedRepo);
                  if (repo?.ownerPubkey) return repo.ownerPubkey;
                  // Fallback: try to resolve from entity/pubkey mapping
                  if (resolvedParams.entity && resolvedParams.entity.length === 8) {
                    // Might be a pubkey prefix, try to match
                    const sess = JSON.parse(localStorage.getItem('nostr:session') || '{}');
                    const pk = sess?.pubkey || "";
                    if (pk && pk.slice(0, 8).toLowerCase() === resolvedParams.entity.toLowerCase()) return pk;
                  }
                } catch {}
                return currentUserPubkey || ""; // Final fallback
              })()}
              contributors={(repoData?.contributors || []).map(c => ({ ...c, weight: c.weight ?? 0 }))}
              amount={10}
              comment={`Zap for ${resolvedParams.entity}/${resolvedParams.repo}`}
            />
          </div>
        )}
        <Badge className="mr-2">nostr</Badge>
        <Badge className="mr-2">git</Badge>
        {repoData?.topics && repoData.topics.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {repoData.topics.map((topic) => (
              <Badge key={topic} className="mr-1 mb-1">{topic}</Badge>
            ))}
          </div>
        )}
        {repoData?.languages && Object.keys(repoData.languages).length > 0 && (
          <div className="mt-2">
            <p className="text-xs text-gray-400 mb-1">Languages</p>
            <div className="flex flex-wrap gap-1">
              {Object.keys(repoData.languages).slice(0, 5).map((lang) => (
                <Badge key={lang} variant="outline" className="text-xs">{lang}</Badge>
              ))}
              {Object.keys(repoData.languages).length > 5 && (
                <Badge variant="outline" className="text-xs">+{Object.keys(repoData.languages).length - 5}</Badge>
              )}
            </div>
          </div>
        )}
        <ul className="text-gray-400 space-y-2 border-b border-lightgray pt-4 pb-8 text-sm">
          {repoData?.readme && (
          <li>
            <BookOpen className="mr-2 inline h-4 w-4" />
            Readme
          </li>
          )}
          <li>
            <Star className="mr-2 inline h-4 w-4" />
            <strong>{liveStarCount}</strong> stars
          </li>
          <li>
            <Eye className="mr-2 inline h-4 w-4" />
            <strong>{liveWatchCount}</strong> watching
          </li>
          <li>
            <GitFork className="mr-2 inline h-4 w-4" />
            <strong>{liveForkCount}</strong> forks
          </li>
          {repoData?.files && (
            <li>
              <File className="mr-2 inline h-4 w-4" />
              <strong>{repoData.files.filter(f => f.type === "file").length}</strong> files
            </li>
          )}
        </ul>
        {repoData?.forkedFrom && (() => {
          // Determine if this is a GitHub URL or internal gittr fork
          const forkedFrom = repoData.forkedFrom;
          const isGitHubUrl = forkedFrom.startsWith("http://") || forkedFrom.startsWith("https://");
          // Internal fork format: /entity/repo or entity/repo (no http/https)
          const isInternalFork = !isGitHubUrl && (forkedFrom.startsWith("/") || forkedFrom.match(/^[^\/]+\/[^\/]+$/));
          
          // Parse internal fork format
          let internalForkUrl: string | null = null;
          let displayText = forkedFrom;
          
          if (isInternalFork) {
            // Internal fork: normalize to /entity/repo format
            internalForkUrl = forkedFrom.startsWith("/") ? forkedFrom : `/${forkedFrom}`;
            displayText = forkedFrom.replace(/^\//, ''); // Remove leading slash for display
          } else if (isGitHubUrl) {
            // GitHub URL: show owner/repo
            displayText = forkedFrom.replace(/^https?:\/\//, '').replace(/\.git$/, '').replace(/^github\.com\//, '');
          }
          
          return (
            <div className="mb-4">
              <h3 className="mb-2 font-bold text-sm">Forked from</h3>
              {isInternalFork && internalForkUrl ? (
                <a 
                  href={internalForkUrl}
                  onClick={(e) => { e.preventDefault(); if (internalForkUrl) window.location.href = internalForkUrl; }}
                  className="text-purple-500 hover:underline text-xs flex items-center gap-1"
                >
                  <GitFork className="h-3 w-3" />
                  {displayText}
                </a>
              ) : (
                <a 
                  href={forkedFrom} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-purple-500 hover:underline text-xs flex items-center gap-1"
                >
                  <GitFork className="h-3 w-3" />
                  {displayText}
                </a>
              )}
            </div>
          );
        })()}
        <div className="">
          <h3 className="mb-4 font-bold">
            Contributors <Badge className="ml-2">{repoData?.contributors?.filter((c) => c.pubkey && /^[0-9a-f]{64}$/i.test(c.pubkey)).length || 0}</Badge>
          </h3>
          <Contributors contributors={repoData?.contributors || []} />
        </div>
        {repoLinksList && repoLinksList.length > 0 && (
          <div className="mt-4 space-y-2">
            {repoIsOwner && !linksPublished && (
              <div className="text-xs text-yellow-200 bg-yellow-900/30 border border-yellow-700/50 rounded px-2 py-1">
                Only you can see these links until you push this repository to Nostr.
                  </div>
            )}
            <RepoLinks links={repoLinksList} />
            {repoIsOwner && linksPublished && (
              <p className="text-[11px] text-gray-500">
                Links are embedded in the latest NIP-34 push and visible to all clients.
              </p>
                      )}
                  </div>
                )}
        
        {/* Display configured relays and Grasp servers */}
        <RelayDisplay 
          relays={useMemo(() => {
            // Combine default relays (from env: NEXT_PUBLIC_NOSTR_RELAYS) with repo-specific relays from Nostr event
            // Repo-specific relays come from "relay" or "relays" tags in the repository event
            const repoRelays = (repoData as any)?.relays || [];
            const combined = [...(defaultRelays || []), ...repoRelays.filter((r: string) => !defaultRelays.includes(r))];
            return combined;
          }, [defaultRelays, (repoData as any)?.relays])}
          graspServers={useMemo(() => {
            // CRITICAL: graspServers should be wss:// URLs (Nostr relays that are also git servers)
            // GRASP servers are automatically extracted from relays by RelayDisplay component
            // This prop is for additional explicit GRASP servers (currently unused, but kept for future use)
            // Clone URLs (git:///http:///https://) are NOT passed here - they're git servers, not Nostr relays
            return [];
          }, [])}
          userRelays={useMemo(() => {
            // Get user-configured relays from relay pool statuses
            // This shows relays the user has added via addRelay() or that are currently connected
            if (!getRelayStatuses) return [];
            try {
              const statuses = getRelayStatuses();
              // getRelayStatuses returns [url: string, status: number][] (array of tuples)
              // Return relays that are connected (status 2) or connecting (status 1)
              return statuses
                .filter((item: any) => {
                  // Handle tuple format: [url, status]
                  if (Array.isArray(item) && item.length >= 2) {
                    const [, status] = item;
                    return typeof status === 'number' && status >= 1;
                  }
                  // Fallback: Handle object format
                  if (item && typeof item === 'object') {
                    const status = item.status !== undefined ? item.status : (item.staus !== undefined ? item.staus : undefined);
                    return typeof status === 'number' && status >= 1;
                  }
                  return false;
                })
                .map((item: any) => {
                  // Extract URL from tuple or object
                  if (Array.isArray(item) && item.length >= 2) {
                    return item[0];
                  }
                  if (item && typeof item === 'object') {
                    return item.url || item.relay;
                  }
                  return null;
                })
                .filter((url: string | null): url is string => url !== null);
            } catch {
              return [];
            }
          }, [getRelayStatuses])}
          gitSourceStatuses={useMemo(() => {
            // Convert fetchStatuses to format expected by RelayDisplay
            // Only include git sources (GitHub, GitLab, Codeberg, etc.) - exclude Nostr git servers (grasp)
            // NOTE: fetchStatuses state uses string source, but FetchStatus from git-source-fetcher uses GitSource object
            // We need to handle both formats for compatibility
            return fetchStatuses
              .filter((status) => {
                const source = status.source;
                
                // Handle string format (from state)
                if (typeof source === 'string') {
                  const isGrasp = source.includes('relay.ngit.dev') || 
                                  source.includes('ngit.danconwaydev.com') ||
                                  source.includes('git.vanderwarker.family');
                  return !isGrasp && (
                    source.includes('github.com') || 
                    source.includes('gitlab.com') || 
                    source.includes('codeberg.org') ||
                    source.startsWith('git://')
                  );
                }
                
                // Handle GitSource object format (from FetchStatus)
                if (source && typeof source === 'object' && 'type' in source) {
                  const gitSource = source as any;
                  const sourceType = gitSource.type;
                  const sourceUrl = gitSource.url || '';
                  
                  // Check if it's a grasp server
                  const isGrasp = sourceUrl.includes('relay.ngit.dev') || 
                                  sourceUrl.includes('ngit.danconwaydev.com') ||
                                  sourceUrl.includes('git.vanderwarker.family') ||
                                  sourceType === 'nostr-git';
                  
                  // Only show external git sources (not grasp servers)
                  return !isGrasp && (
                    sourceType === 'github' || 
                    sourceType === 'gitlab' || 
                    sourceType === 'codeberg' ||
                    (sourceType === 'unknown' && (
                      sourceUrl.includes('github.com') || 
                      sourceUrl.includes('gitlab.com') || 
                      sourceUrl.includes('codeberg.org') ||
                      sourceUrl.startsWith('git://')
                    ))
                  );
                }
                
                return false;
              })
              .map((status) => {
                const source = status.source;
                let sourceUrl: string;
                let displayName: string | undefined;
                
                // Handle string format
                if (typeof source === 'string') {
                  sourceUrl = source;
                  const urlMatch = sourceUrl.match(/https?:\/\/([^\/]+)\/([^\/]+)\/([^\/]+)/);
                  if (urlMatch) {
                    displayName = `${urlMatch[1]}/${urlMatch[2]}/${urlMatch[3]}`.replace(/\.git$/, '');
                  } else {
                    displayName = sourceUrl.replace(/^https?:\/\//, '').replace(/^git:\/\//, '').replace(/\.git$/, '');
                  }
                } else if (source && typeof source === 'object' && 'url' in source) {
                  // Handle GitSource object format
                  const gitSource = source as any;
                  sourceUrl = gitSource.url || '';
                  displayName = gitSource.displayName || 
                    (gitSource.owner && gitSource.repo 
                      ? `${gitSource.displayName || gitSource.type}/${gitSource.owner}/${gitSource.repo}`
                      : sourceUrl.replace(/^https?:\/\//, '').replace(/^git:\/\//, '').replace(/\.git$/, ''));
                } else {
                  sourceUrl = String(source);
                  displayName = undefined;
                }
                
                return {
                  source: sourceUrl,
                  status: status.status,
                  error: status.error,
                  displayName,
                };
              });
          }, [fetchStatuses])}
        />
        
        {/* Display last successful Nostr event ID (if available) */}
        {mounted && nostrEventId ? (
                <div className="mt-4 pt-4 border-t border-lightgray">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-bold text-sm">Nostr Event ID</h3>
                    <button
                      onClick={async () => {
                        try {
                    await navigator.clipboard.writeText(nostrEventId);
                          // Show temporary feedback
                          const btn = document.activeElement as HTMLElement;
                          const originalText = btn.innerHTML;
                          btn.innerHTML = "✓ Copied";
                          setTimeout(() => {
                            btn.innerHTML = originalText;
                          }, 2000);
                        } catch (err) {
                          console.error("Failed to copy event ID:", err);
                        }
                      }}
                      className="text-xs text-gray-400 hover:text-gray-300 flex items-center gap-1 px-2 py-1 rounded hover:bg-white/5 transition-colors"
                      title="Copy full event ID"
                    >
                      <Copy className="h-3 w-3" />
                      Copy
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 break-all font-mono">
              {nostrEventId.slice(0, 16)}...
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Last successful push to Nostr
                  </p>
                </div>
        ) : null}
      </aside>

      {/* Fuzzy File Finder Modal */}
      {repoData?.files && (
        <FuzzyFileFinder
          files={(repoData.files || []).map(f => ({
            type: (f?.type === "file" || f?.type === "dir" ? f.type : "file") as "file" | "dir",
            path: f?.path || "",
            size: f?.size,
          }))}
          isOpen={showFuzzyFinder}
          onClose={() => setShowFuzzyFinder(false)}
          onSelectFile={(path) => {
            openFile(path);
          }}
          currentPath={currentPath}
        />
      )}
      {showSshGitHelp && sshGitHelpData && (
        <SSHGitHelp
          entity={sshGitHelpData.entity}
          repo={sshGitHelpData.repo}
          sshUrl={sshGitHelpData.sshUrl}
          httpsUrls={sshGitHelpData.httpsUrls}
          nostrUrls={sshGitHelpData.nostrUrls}
          onClose={() => {
            setShowSshGitHelp(false);
            setSshGitHelpData(null);
          }}
        />
      )}
      </div>
    </div>
  );
}