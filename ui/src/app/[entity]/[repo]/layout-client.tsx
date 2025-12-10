"use client";

import { useEffect, useState, useCallback, useMemo, use } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { getRepoStorageKey } from "@/lib/utils/entity-normalizer";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";
import { clsx } from "clsx";
import { isOwner, canManageSettings } from "@/lib/repo-permissions";
import { getRepoOwnerPubkey } from "@/lib/utils/entity-resolver";
import { loadStoredRepos, type StoredRepo, type StoredContributor } from "@/lib/repos/storage";
import {
  BarChart4,
  Book,
  ChevronDown,
  CircleDot,
  Code,
  Eye,
  Folder,
  GitCommit,
  GitFork,
  GitPullRequest,
  Globe2,
  MessageCircle,
  MoreHorizontal,
  Settings,
  Share2,
  Star,
  Zap,
  GitBranch,
  Layers,
} from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { getZapTotal } from "@/lib/payments/zap-tracker";
import { RepoQRShare } from "@/components/ui/repo-qr-share";
import { useEntityOwner } from "@/lib/utils/use-entity-owner";
import { nip19 } from "nostr-tools";

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
const MENU_ITEM_WIDTH = 165;

export default function RepoLayoutClient({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ entity: string; repo: string; subpage?: string }>;
}) {
  const resolvedParams = use(params);
  const pathname = usePathname() || "";
  const searchParams = useSearchParams();
  // Use consistent default width on server and initial client render to prevent hydration mismatch
  const [windowWidth, setWindowWidth] = useState(1920);
  const { pubkey } = useNostrContext();
  const [isWatching, setIsWatching] = useState(false);
  const [isStarred, setIsStarred] = useState(false);
  const [starCount, setStarCount] = useState<number>(0);
  const [zapTotal, setZapTotal] = useState<number>(0);
  const [issueCount, setIssueCount] = useState<number>(0);
  const [prCount, setPrCount] = useState<number>(0);
  const [showRepoQR, setShowRepoQR] = useState(false);
  const [repo, setRepo] = useState<any>(null);
  const [repoLogo, setRepoLogo] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [isOwnerUser, setIsOwnerUser] = useState(false);
  
  // Calculate safe initial display name that matches on server and client
  const safeInitialDisplayName = useMemo(() => {
    if (resolvedParams.entity?.startsWith("npub")) {
      return `${resolvedParams.entity.substring(0, 16)}...`;
    }
    return resolvedParams.entity || "Unknown";
  }, [resolvedParams.entity]);
  
  // Resolve owner using utility hook (needs repo to be loaded)
  // Note: ownerMetadata is fetched internally by the hook but not used directly here
  const { ownerPubkey: rawOwnerPubkey, ownerDisplayName: rawOwnerDisplayName, ownerPicture: rawOwnerPicture } = useEntityOwner({
    entity: resolvedParams.entity,
    repo: repo,
    repoName: resolvedParams.repo,
  });
  
  // Use safe initial values on server/initial render to prevent hydration mismatches
  // After mount, use actual values from hook
  const ownerPubkey = mounted ? rawOwnerPubkey : null;
  const ownerDisplayName = mounted ? rawOwnerDisplayName : safeInitialDisplayName;
  const ownerPicture = mounted ? rawOwnerPicture : null;
  
  // Helper function to generate href for repo links (avoids duplication)
  // Use consistent href on initial render to prevent hydration mismatches
  const getRepoLink = useCallback((subpath: string = "", includeSearchParams: boolean = false) => {
    // On initial render (before mount), always use resolvedParams.entity to ensure consistency
    const effectiveOwnerPubkey = mounted ? ownerPubkey : null;
    const basePath = effectiveOwnerPubkey && /^[0-9a-f]{64}$/i.test(effectiveOwnerPubkey) 
      ? `/${nip19.npubEncode(effectiveOwnerPubkey)}/${resolvedParams.repo}${subpath ? `/${subpath}` : ""}`
      : `/${resolvedParams.entity}/${resolvedParams.repo}${subpath ? `/${subpath}` : ""}`;
    return includeSearchParams && searchParams?.toString() 
      ? `${basePath}?${searchParams.toString()}`
      : basePath;
  }, [mounted, ownerPubkey, resolvedParams.entity, resolvedParams.repo, searchParams]);
  
  // Track mount state to prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);
  
  // Load repo data first (used by useEntityOwner hook)
  const loadRepoAndLogo = useCallback(() => {
    if (!mounted) return; // Don't access localStorage until mounted
    
    try {
      const repos = loadStoredRepos();
      const foundRepo = findRepoByEntityAndName<StoredRepo>(repos, resolvedParams.entity, resolvedParams.repo);
      setRepo(foundRepo || null);
      
      // Check if current user is owner
      if (foundRepo && pubkey) {
        const repoOwnerPubkey = getRepoOwnerPubkey(foundRepo, resolvedParams.entity);
        const userIsOwner = isOwner(pubkey, foundRepo.contributors, repoOwnerPubkey);
        const canManage = canManageSettings(
          foundRepo.contributors?.find((c: StoredContributor) => 
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
          if (!logoUrl.startsWith("http://") && !logoUrl.startsWith("https://") && 
              !logoUrl.startsWith("data:") && !logoUrl.startsWith("/") &&
              logoUrl.includes(".") && !logoUrl.includes("@")) {
            logoUrl = `https://${logoUrl}`;
          }
          if (logoUrl.startsWith("http://") || logoUrl.startsWith("https://") || logoUrl.startsWith("data:") || logoUrl.startsWith("/")) {
            setRepoLogo(logoUrl);
            return;
          }
        }
        
        // Priority 2: Logo files from repo
        const repoName = (foundRepo.name || foundRepo.repo || "").toLowerCase().replace(/[^a-z0-9]/g, "");
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
            if (baseName.includes("logo") && !baseName.includes("logo-alby") && !baseName.includes("alby-logo")) return true;
            
            // Match repo-name-based files (e.g., "gittr.png" for gittr repo)
            if (repoName && baseName === repoName) return true;
            
            // Match common icon names in root directory only
            if (isRoot && (baseName === "repo" || baseName === "icon" || baseName === "favicon")) return true;
            
            return false;
          })
          .sort((a: string, b: string) => {
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
        
        // Try each candidate logo file
        for (const logoPath of candidates) {
          // Try sourceUrl first
          let gitUrl: string | undefined = foundRepo.sourceUrl;
          let ownerRepo: { owner: string; repo: string; hostname: string } | null = null;
          
          if (gitUrl) {
            ownerRepo = extractOwnerRepo(gitUrl);
          }
          
          // If sourceUrl didn't work, try clone array
          if (!ownerRepo && foundRepo.clone && Array.isArray(foundRepo.clone) && foundRepo.clone.length > 0) {
            // Find first GitHub/GitLab/Codeberg URL in clone array
            const gitCloneUrl = foundRepo.clone.find((url: string) => 
              url && (url.includes('github.com') || url.includes('gitlab.com') || url.includes('codeberg.org'))
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
              setRepoLogo(`https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${logoPath}`);
              return;
            } else if (hostname === "gitlab.com" || hostname.includes("gitlab.com")) {
              setRepoLogo(`https://gitlab.com/${owner}/${repo}/-/raw/${encodeURIComponent(branch)}/${logoPath}`);
              return;
            } else if (hostname === "codeberg.org" || hostname.includes("codeberg.org")) {
              setRepoLogo(`https://codeberg.org/${owner}/${repo}/raw/branch/${encodeURIComponent(branch)}/${logoPath}`);
              return;
            }
          }
          
          // For Nostr-native repos without sourceUrl, try bridge API directly
          // Get owner pubkey from entity or repo
          let ownerPubkeyForBridge: string | undefined;
          if (resolvedParams.entity && resolvedParams.entity.length === 64 && /^[0-9a-f]{64}$/i.test(resolvedParams.entity)) {
            ownerPubkeyForBridge = resolvedParams.entity;
          } else if (foundRepo.ownerPubkey && /^[0-9a-f]{64}$/i.test(foundRepo.ownerPubkey)) {
            ownerPubkeyForBridge = foundRepo.ownerPubkey;
          } else if (ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey)) {
            ownerPubkeyForBridge = ownerPubkey;
          }
          
          // CRITICAL: Use repositoryName from Nostr event (exact name used by git-nostr-bridge)
          // Priority: repositoryName > name > repo > slug
          const repoDataAny = foundRepo as any;
          let repoName = repoDataAny?.repositoryName || foundRepo.name || foundRepo.repo || foundRepo.slug;
          
          // Extract repo name (handle paths like "gitnostr.com/gitworkshop")
          if (repoName && typeof repoName === 'string' && repoName.includes('/')) {
            const parts = repoName.split('/');
            repoName = parts[parts.length - 1] || repoName;
          }
          if (repoName) {
            repoName = String(repoName).replace(/\.git$/, '');
          }
          
          if (ownerPubkeyForBridge && repoName) {
            const branch = foundRepo.defaultBranch || "main";
            const bridgeApiUrl = `/api/nostr/repo/file-content?ownerPubkey=${encodeURIComponent(ownerPubkeyForBridge)}&repo=${encodeURIComponent(repoName)}&path=${encodeURIComponent(logoPath)}&branch=${encodeURIComponent(branch)}`;
            
            // For images, try using the API URL directly (browser can load it)
            setRepoLogo(bridgeApiUrl);
            return;
          }
        }
      }
      
      // No repo logo found
      setRepoLogo(null);
    } catch {}
  }, [resolvedParams.entity, resolvedParams.repo, mounted, ownerPubkey, pubkey]);
  
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
  
  // Load watch/star state from localStorage and star count from repo data
  useEffect(() => {
    if (!pubkey) return;
    try {
      const repoId = `${resolvedParams.entity}/${resolvedParams.repo}`;
      const watched = JSON.parse(localStorage.getItem("gittr_watched_repos") || "[]") as string[];
      const starred = JSON.parse(localStorage.getItem("gittr_starred_repos") || "[]") as string[];
      setIsWatching(watched.includes(repoId));
      setIsStarred(starred.includes(repoId));
      
      // Get star count from repo data
      setStarCount(repo?.stars || 0);
    } catch {}
  }, [resolvedParams.entity, resolvedParams.repo, pubkey, repo]);
  
  // Update zap total badge (local tracker for now)
  useEffect(() => {
    try {
      const contextId = `${resolvedParams.entity}/${resolvedParams.repo}`;
      const total = pubkey ? getZapTotal(pubkey, contextId) : 0;
      setZapTotal(total);
    } catch {
      setZapTotal(0);
    }
  }, [resolvedParams.entity, resolvedParams.repo, pubkey, isStarred, isWatching]);

  // Dynamic counts for issues/PRs (only open items)
  useEffect(() => {
    const updateCounts = () => {
    try {
      const prKey = getRepoStorageKey("gittr_prs", resolvedParams.entity, resolvedParams.repo);
      const issueKey = getRepoStorageKey("gittr_issues", resolvedParams.entity, resolvedParams.repo);
        const prs = JSON.parse(localStorage.getItem(prKey) || "[]") as any[];
        const issues = JSON.parse(localStorage.getItem(issueKey) || "[]") as any[];
        // Only count open PRs and issues
        setPrCount(prs.filter((pr: any) => (pr.status || "open") === "open").length);
        setIssueCount(issues.filter((issue: any) => (issue.status || "open") === "open").length);
    } catch {
      setPrCount(0);
      setIssueCount(0);
    }
    };
    
    updateCounts();
    
    // Listen for changes to PRs and issues
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key?.includes(getRepoStorageKey("gittr_prs", resolvedParams.entity, resolvedParams.repo)) || 
          e.key?.includes(getRepoStorageKey("gittr_issues", resolvedParams.entity, resolvedParams.repo))) {
        updateCounts();
      }
    };
    
    // Listen for custom events when PRs/issues are updated
    const handlePRUpdate = () => updateCounts();
    const handleIssueUpdate = () => updateCounts();
    
    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("gittr:pr-updated", handlePRUpdate);
    window.addEventListener("gittr:issue-updated", handleIssueUpdate);
    
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("gittr:pr-updated", handlePRUpdate);
      window.removeEventListener("gittr:issue-updated", handleIssueUpdate);
    };
  }, [resolvedParams.entity, resolvedParams.repo]);

  const handleWatch = useCallback(() => {
    if (!pubkey) return;
    try {
      const repoId = `${resolvedParams.entity}/${resolvedParams.repo}`;
      const watched = JSON.parse(localStorage.getItem("gittr_watched_repos") || "[]") as string[];
      if (isWatching) {
        localStorage.setItem("gittr_watched_repos", JSON.stringify(watched.filter(r => r !== repoId)));
        setIsWatching(false);
      } else {
        localStorage.setItem("gittr_watched_repos", JSON.stringify([...watched, repoId]));
        setIsWatching(true);
      }
      // Notify repo pages to refresh their counters
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("gittr:repos-updated"));
      }
    } catch {}
  }, [resolvedParams.entity, resolvedParams.repo, isWatching, pubkey]);
  
  const handleStar = useCallback(() => {
    if (!pubkey) return;
    try {
      const repoId = `${resolvedParams.entity}/${resolvedParams.repo}`;
      const starred = JSON.parse(localStorage.getItem("gittr_starred_repos") || "[]") as string[];
      
      // Update repos list to increment/decrement star count
      const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as any[];
      const repoIndex = repos.findIndex(r => {
        const found = findRepoByEntityAndName([r], resolvedParams.entity, resolvedParams.repo);
        return found !== undefined;
      });
      
      if (isStarred) {
        // Unstar: remove from starred list and decrement count
        localStorage.setItem("gittr_starred_repos", JSON.stringify(starred.filter(r => r !== repoId)));
        setIsStarred(false);
        if (repoIndex >= 0) {
          repos[repoIndex].stars = Math.max(0, (repos[repoIndex].stars || 0) - 1);
          setStarCount(repos[repoIndex].stars);
        }
      } else {
        // Star: add to starred list and increment count
        localStorage.setItem("gittr_starred_repos", JSON.stringify([...starred, repoId]));
        setIsStarred(true);
        if (repoIndex >= 0) {
          repos[repoIndex].stars = (repos[repoIndex].stars || 0) + 1;
          setStarCount(repos[repoIndex].stars);
        } else {
          // Repo not found in repos list, create minimal entry
          repos.push({
            slug: repoId,
            entity: resolvedParams.entity,
            repo: resolvedParams.repo,
            name: resolvedParams.repo,
            stars: 1,
          });
          setStarCount(1);
        }
      }
      
      localStorage.setItem("gittr_repos", JSON.stringify(repos));
      // Notify repo pages to refresh their counters
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("gittr:repos-updated"));
      }
    } catch {}
  }, [resolvedParams.entity, resolvedParams.repo, isStarred, pubkey]);
  
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

  // Filter menu items based on permissions (hide Settings for non-owners)
  const filteredMenuItems = useMemo(() => {
    return menuItems.filter(item => {
      // Always show all items except Settings
      if (item.link !== "settings") return true;
      // Only show Settings if user is owner
      return isOwnerUser;
    });
  }, [isOwnerUser]);
  
  // Memoize the number of visible menu items to prevent recalculation on every render
  const visibleMenuItemsCount = useMemo(() => {
    return mounted ? Math.floor(windowWidth / MENU_ITEM_WIDTH) : Math.floor(1920 / MENU_ITEM_WIDTH);
  }, [mounted, windowWidth]);

  // Removed onClick handler that was interfering with navigation

  return (
    <>
      <section className="max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] mx-auto px-4 md:px-6 py-6">
        <div className="justify-between overflow-hidden flex flex-col lg:flex-row">
          <div className="mb-4 flex items-center text-lg">
            <Book className="mr-2 inline h-4 w-4 text-gray-400" />
            {/* Unified repo icon (circle): repo pic -> owner profile pic -> logo.svg */}
            <div className="mr-2 flex-shrink-0">
              <div className="relative h-5 w-5 rounded-full overflow-hidden ring-2 ring-purple-500" style={{ maxWidth: "20px", maxHeight: "20px" }}>
                {/* Always render a single img tag to avoid hydration mismatch */}
                {/* On server and initial client render, always use /logo.svg to match */}
                  <img 
                  src={mounted && repoLogo ? repoLogo : (mounted && !repoLogo && ownerPicture ? ownerPicture : "/logo.svg")}
                  alt={mounted && repoLogo ? "repo logo" : (mounted && !repoLogo && ownerPicture ? ownerDisplayName : "repo")}
                    className="h-5 w-5 rounded-full object-cover absolute inset-0"
                    style={{ maxWidth: "20px", maxHeight: "20px" }}
                    onError={(e) => {
                    const target = e.currentTarget;
                    if (target.src !== "/logo.svg") {
                      // If the current src is not the fallback, try the next fallback
                      if (mounted && repoLogo) {
                      setRepoLogo(null);
                        if (ownerPicture) {
                          target.src = ownerPicture;
                        } else {
                          target.src = "/logo.svg";
                        }
                      } else if (mounted && !repoLogo && ownerPicture) {
                        target.src = "/logo.svg";
                      } else {
                        target.style.display = 'none';
                      }
                    } else {
                      target.style.display = 'none';
                    }
                    }}
                    referrerPolicy="no-referrer"
                  suppressHydrationWarning
                />
              </div>
            </div>
            <a
              className="text-purple-500 hover:underline cursor-pointer"
              href={ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey) ? `/${nip19.npubEncode(ownerPubkey)}` : `/${resolvedParams.entity}`}
              onClick={(e) => {
                e.preventDefault();
                window.location.href = ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey) ? `/${nip19.npubEncode(ownerPubkey)}` : `/${resolvedParams.entity}`;
              }}
              suppressHydrationWarning
            >
              {ownerDisplayName}
            </a>
            <span className="text-gray-400 px-2">/</span>
            <a
              className="text-purple-500 hover:underline cursor-pointer"
              href={getRepoLink()}
              onClick={(e) => {
                e.preventDefault();
                window.location.href = getRepoLink();
              }}
            >
              {decodeURIComponent(resolvedParams.repo)}
            </a>
            <span className="border-lightgray text-gray-400 ml-1.5 mt-px rounded-full border px-1.5 text-xs">
              Public
            </span>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="h-8 !border-[#383B42] bg-[#22262C] text-xs md:hidden"
                variant="outline"
                type="button"
              >
                Actions <ChevronDown className="ml-2 h-4 w-4 text-white" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="ml-8 mt-2">
              <DropdownMenuItem key="watch" onClick={handleWatch}>
                <Eye className="mr-2 h-4 w-4" /> {isWatching ? "Unwatch" : "Watch"}
                <Badge className="ml-2">{isWatching ? 1 : 0}</Badge>
              </DropdownMenuItem>
              <DropdownMenuItem key="zaps" asChild>
                <a href={getRepoLink("", false) + "?zap=true"} onClick={(e) => { e.preventDefault(); window.location.href = getRepoLink("", false) + "?zap=true"; }} className="flex items-center">
                <Zap className="mr-2 h-4 w-4" /> Zaps
                  <Badge className="ml-2">{zapTotal}</Badge>
                </a>
              </DropdownMenuItem>
              {/* Relays status not yet implemented */}
              <DropdownMenuItem key="fork" onClick={handleFork}>
                <GitFork className="mr-2 h-4 w-4" /> Fork
                <Badge className="ml-2">0</Badge>
              </DropdownMenuItem>
              <DropdownMenuItem key="star" onClick={handleStar}>
                <Star className={`mr-2 h-4 w-4 ${isStarred ? "text-yellow-500 fill-yellow-500" : ""}`} /> {isStarred ? "Starred" : "Star"}
                <Badge className="ml-2">{starCount}</Badge>
              </DropdownMenuItem>
              <DropdownMenuItem key="share" onClick={() => setShowRepoQR(true)}>
                <Share2 className="mr-2 h-4 w-4" /> Share
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex justify-end">
            <div className="hidden md:flex md:flex-row md:gap-2">
              <Button
                className="h-8 !border-[#383B42] bg-[#22262C] text-xs"
                variant="outline"
                onClick={handleWatch}
                disabled={!mounted || !pubkey}
                suppressHydrationWarning
              >
                <Eye className="mr-2 h-4 w-4" /> {isWatching ? "Unwatch" : "Watch"}
                <Badge className="ml-2">{isWatching ? 1 : 0}</Badge>
              </Button>
              <a href={getRepoLink("", false) + "?zap=true"} onClick={(e) => { e.preventDefault(); window.location.href = getRepoLink("", false) + "?zap=true"; }}>
              <Button
                className="h-8 !border-[#383B42] bg-[#22262C] text-xs"
                variant="outline"
              >
                <Zap className="mr-2 h-4 w-4" /> Zaps
                <Badge className="ml-2">{zapTotal}</Badge>
              </Button>
                          </a>
              {/* Relays status not yet implemented */}
              <Button
                className="h-8 !border-[#383B42] bg-[#22262C] text-xs"
                variant="outline"
                onClick={handleFork}
                disabled={!mounted || !pubkey}
                suppressHydrationWarning
              >
                <GitFork className="mr-2 h-4 w-4" /> Fork
                <Badge className="ml-2">0</Badge>
              </Button>
              <Button
                className={`h-8 !border-[#383B42] bg-[#22262C] text-xs ${isStarred ? "hover:bg-[#22262C]" : ""}`}
                variant="outline"
                onClick={handleStar}
                disabled={!mounted || !pubkey}
                suppressHydrationWarning
              >
                <Star className={`mr-2 h-4 w-4 ${isStarred ? "text-yellow-500 fill-yellow-500" : ""}`} /> {isStarred ? "Starred" : "Star"}
                <Badge className="ml-2">{starCount}</Badge>
              </Button>
              <Button
                className="h-8 !border-[#383B42] bg-[#22262C] text-xs"
                variant="outline"
                onClick={() => setShowRepoQR(true)}
              >
                <Share2 className="mr-2 h-4 w-4" /> Share
              </Button>
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center gap-4">
          <div className="flex-1 overflow-x-hidden">
            <ul className="my-4 flex items-center gap-x-4 min-w-max">
              {filteredMenuItems
                .slice(0, visibleMenuItemsCount)
                .map((item, index) => (
                  <li key={`${item.name}-${item.link}-${index}`} className="flex-shrink-0">
                    <a
                      href={getRepoLink(item.link || "", item.name === "Code")}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        window.location.href = getRepoLink(item.link || "", item.name === "Code");
                      }}
                      className={clsx(
                        "flex items-center whitespace-nowrap border-b-2 border-transparent transition-all ease-in-out px-3 py-4 text-sm cursor-pointer",
                        {
                          "border-b-purple-600":
                            item.name === "Code"
                              ? pathname === `/${resolvedParams.entity}/${resolvedParams.repo}`
                              : pathname.includes(
                                  `/${resolvedParams.entity}/${resolvedParams.repo}/${item.link}`
                                ),
                        }
                      )}
                    >
                      {item.icon}
                      {item.name} {item.link === "issues" ? (<Badge className="ml-2">{issueCount}</Badge>) : item.link === "pulls" ? (<Badge className="ml-2">{prCount}</Badge>) : null}
                    </a>
                  </li>
                ))}
            </ul>
          </div>

          <DropdownMenu modal={false}>

            <DropdownMenuTrigger asChild className={clsx("block", {
              "hidden":
                (filteredMenuItems.length - visibleMenuItemsCount) === 0
            })}>
              <div className="flex items-center cursor-pointer">
                <MoreHorizontal className="h-4 w-4 hover:text-white/80" />
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="py-1 px-0 w-40 relative -left-4 top-1" onCloseAutoFocus={(e) => e.preventDefault()} onInteractOutside={(e) => {
              // Allow clicks to pass through to links
              const target = e.target as HTMLElement;
              if (target.closest('a')) {
                e.preventDefault();
              }
            }}>
              {filteredMenuItems
                .slice(
                  -(
                    filteredMenuItems.length - visibleMenuItemsCount
                  )
                )
                .map((item, index) => (
                  <DropdownMenuItem 
                    key={`${item.name}-${item.link}-${index}`} 
                    className="p-0"
                    onSelect={(e) => {
                      e.preventDefault();
                    }}
                  >
                    <a
                      href={getRepoLink(item.link || "", item.name === "Code")}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        window.location.href = getRepoLink(item.link || "", item.name === "Code");
                      }}
                      className={clsx(
                        "w-full flex h-9 items-center whitespace-nowrap border-transparent transition-all ease-in-out p-4 text-sm text-white hover:bg-purple-600",
                        {
                          "border-b-purple-600":
                            item.name === "Code"
                              ? pathname === `/${resolvedParams.entity}/${resolvedParams.repo}`
                              : pathname.includes(
                                  `/${resolvedParams.entity}/${resolvedParams.repo}/${item.link}`
                                ),
                        }
                      )}
                    >
                      {item.icon}
                      {item.name}
                    </a>
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
          repoName={`${ownerDisplayName}/${decodeURIComponent(resolvedParams.repo)}`}
          onClose={() => setShowRepoQR(false)}
        />
      )}
    </>
  );
}

