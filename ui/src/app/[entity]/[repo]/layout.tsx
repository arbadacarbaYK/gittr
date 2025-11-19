"use client";

import { useEffect, useState, useCallback } from "react";

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
import useSession from "@/lib/nostr/useSession";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { getZapTotal } from "@/lib/payments/zap-tracker";
import { RepoQRShare } from "@/components/ui/repo-qr-share";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
    name: "Projects",
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

export default function RepoLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { entity: string; repo: string; subpage?: string };
}) {
  const pathname = usePathname() || "";
  const searchParams = useSearchParams();
  const [windowWidth, setWindowWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1920);
  const { name: userName } = useSession();
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
  
  // Resolve owner using utility hook (needs repo to be loaded)
  const { ownerPubkey, ownerDisplayName, ownerPicture, ownerMetadata } = useEntityOwner({
    entity: params.entity,
    repo: repo,
    repoName: params.repo,
  });
  
  // Helper function to generate href for repo links (avoids duplication)
  const getRepoLink = useCallback((subpath: string = "", includeSearchParams: boolean = false) => {
    const basePath = ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey) 
      ? `/${nip19.npubEncode(ownerPubkey)}/${params.repo}${subpath ? `/${subpath}` : ""}`
      : `/${params.entity}/${params.repo}${subpath ? `/${subpath}` : ""}`;
    return includeSearchParams && searchParams?.toString() 
      ? `${basePath}?${searchParams.toString()}`
      : basePath;
  }, [ownerPubkey, params.entity, params.repo, searchParams]);
  
  // Load repo data first (used by useEntityOwner hook)
  useEffect(() => {
    try {
      const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as any[];
      const foundRepo = findRepoByEntityAndName(repos, params.entity, params.repo);
      setRepo(foundRepo || null);
      
      // Load repo logo if available
      if (foundRepo) {
        // Priority 1: Stored logoUrl
        if (foundRepo.logoUrl) {
          let logoUrl = foundRepo.logoUrl.trim();
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
        const logoFile = foundRepo.files?.find((f: any) => /(^|\/)logo\.(png|jpg|jpeg|gif|webp|svg|ico)$/i.test(f.path));
        if (logoFile && foundRepo.sourceUrl) {
          try {
            const url = new URL(foundRepo.sourceUrl);
            const [owner, repoName] = url.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
            const branch = foundRepo.defaultBranch || "main";
            setRepoLogo(`https://raw.githubusercontent.com/${owner}/${repoName}/${branch}/${logoFile.path}`);
            return;
          } catch {}
        }
      }
      
      // No repo logo found
      setRepoLogo(null);
    } catch {}
  }, [params.entity, params.repo]);
  
  // Load watch/star state from localStorage and star count from repo data
  useEffect(() => {
    if (!pubkey) return;
    try {
      const repoId = `${params.entity}/${params.repo}`;
      const watched = JSON.parse(localStorage.getItem("gittr_watched_repos") || "[]") as string[];
      const starred = JSON.parse(localStorage.getItem("gittr_starred_repos") || "[]") as string[];
      setIsWatching(watched.includes(repoId));
      setIsStarred(starred.includes(repoId));
      
      // Get star count from repo data
      setStarCount(repo?.stars || 0);
    } catch {}
  }, [params.entity, params.repo, pubkey, repo]);
  
  // Update zap total badge (local tracker for now)
  useEffect(() => {
    try {
      const contextId = `${params.entity}/${params.repo}`;
      const total = pubkey ? getZapTotal(pubkey, contextId) : 0;
      setZapTotal(total);
    } catch {
      setZapTotal(0);
    }
  }, [params.entity, params.repo, pubkey, isStarred, isWatching]);

  // Dynamic counts for issues/PRs (only open items)
  useEffect(() => {
    const updateCounts = () => {
    try {
      const prKey = getRepoStorageKey("gittr_prs", params.entity, params.repo);
      const issueKey = getRepoStorageKey("gittr_issues", params.entity, params.repo);
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
      if (e.key?.includes(getRepoStorageKey("gittr_prs", params.entity, params.repo)) || 
          e.key?.includes(getRepoStorageKey("gittr_issues", params.entity, params.repo))) {
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
  }, [params.entity, params.repo]);

  const handleWatch = useCallback(() => {
    if (!pubkey) return;
    try {
      const repoId = `${params.entity}/${params.repo}`;
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
  }, [params.entity, params.repo, isWatching, pubkey]);
  
  const handleStar = useCallback(() => {
    if (!pubkey) return;
    try {
      const repoId = `${params.entity}/${params.repo}`;
      const starred = JSON.parse(localStorage.getItem("gittr_starred_repos") || "[]") as string[];
      
      // Update repos list to increment/decrement star count
      const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as any[];
      const repoIndex = repos.findIndex(r => {
        const found = findRepoByEntityAndName([r], params.entity, params.repo);
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
            entity: params.entity,
            repo: params.repo,
            name: params.repo,
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
  }, [params.entity, params.repo, isStarred, pubkey]);
  
  const handleFork = useCallback(() => {
    // Fork functionality - navigate to fork page or show modal
    // For now, just navigate to new repo page with fork info
    if (typeof window !== "undefined") {
      window.location.href = `/new?fork=${params.entity}/${params.repo}`;
    }
  }, [params.entity, params.repo]);
  

  useEffect(() => {
    const handleWindowResize = () => {
      setWindowWidth(window.innerWidth);
    };

    window.addEventListener("resize", handleWindowResize);

    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, []); // Add empty dependency array to prevent re-running on every render

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
                {/* Priority 1: Repo icon */}
                {repoLogo && (
                  <img 
                    src={repoLogo} 
                    alt="repo logo" 
                    className="h-5 w-5 rounded-full object-cover absolute inset-0"
                    style={{ maxWidth: "20px", maxHeight: "20px" }}
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                      setRepoLogo(null);
                    }}
                    referrerPolicy="no-referrer"
                  />
                )}
                {/* Priority 2: Owner profile picture */}
                {!repoLogo && ownerPicture && (
                  <img 
                    src={ownerPicture} 
                    alt={ownerDisplayName}
                    className="h-5 w-5 rounded-full object-cover absolute inset-0"
                    style={{ maxWidth: "20px", maxHeight: "20px" }}
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                )}
                {/* Priority 3: logo.svg fallback */}
                {!repoLogo && !ownerPicture && (
                  <img 
                    src="/logo.svg" 
                    alt="repo" 
                    className="h-5 w-5 rounded-full object-contain absolute inset-0"
                    style={{ maxWidth: "20px", maxHeight: "20px" }}
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                )}
                {/* Final fallback */}
                {!repoLogo && !ownerPicture && (
                  <span className="inline-block h-5 w-5 rounded-full bg-[#22262C]" style={{ maxWidth: "20px", maxHeight: "20px" }} />
                )}
              </div>
            </div>
            <a
              className="text-purple-500 hover:underline cursor-pointer"
              href={ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey) ? `/${nip19.npubEncode(ownerPubkey)}` : `/${params.entity}`}
              onClick={(e) => {
                e.preventDefault();
                window.location.href = ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey) ? `/${nip19.npubEncode(ownerPubkey)}` : `/${params.entity}`;
              }}
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
              {decodeURIComponent(params.repo)}
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
              >
                Actions <ChevronDown className="ml-2 h-4 w-4 text-white" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="ml-8 mt-2">
              <DropdownMenuItem onClick={handleWatch}>
                <Eye className="mr-2 h-4 w-4" /> {isWatching ? "Unwatch" : "Watch"}
                <Badge className="ml-2">{isWatching ? 1 : 0}</Badge>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={getRepoLink("", false) + "?zap=true"} onClick={(e) => { e.preventDefault(); window.location.href = getRepoLink("", false) + "?zap=true"; }} className="flex items-center">
                <Zap className="mr-2 h-4 w-4" /> Zaps
                  <Badge className="ml-2">{zapTotal}</Badge>
                </a>
              </DropdownMenuItem>
              {/* Relays status not yet implemented */}
              <DropdownMenuItem onClick={handleFork}>
                <GitFork className="mr-2 h-4 w-4" /> Fork
                <Badge className="ml-2">0</Badge>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleStar}>
                <Star className={`mr-2 h-4 w-4 ${isStarred ? "text-yellow-500 fill-yellow-500" : ""}`} /> {isStarred ? "Starred" : "Star"}
                <Badge className="ml-2">{starCount}</Badge>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowRepoQR(true)}>
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
                disabled={!pubkey}
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
                disabled={!pubkey}
              >
                <GitFork className="mr-2 h-4 w-4" /> Fork
                <Badge className="ml-2">0</Badge>
              </Button>
              <Button
                className={`h-8 !border-[#383B42] bg-[#22262C] text-xs ${isStarred ? "hover:bg-[#22262C]" : ""}`}
                variant="outline"
                onClick={handleStar}
                disabled={!pubkey}
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
          <div className="flex-1 overflow-x-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent">
            <ul className="my-4 flex items-center gap-x-4 min-w-max">
              {menuItems
                .slice(0, Math.floor(windowWidth / MENU_ITEM_WIDTH))
                .map((item) => (
                  <li key={item.name} className="flex-shrink-0">
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
                              ? pathname === `/${params.entity}/${params.repo}`
                              : pathname.includes(
                                  `/${params.entity}/${params.repo}/${item.link}`
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
                (menuItems.length - Math.floor(windowWidth / MENU_ITEM_WIDTH)) === 0
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
              {menuItems
                .slice(
                  -(
                    menuItems.length - Math.floor(windowWidth / MENU_ITEM_WIDTH)
                  )
                )
                .map((item) => (
                  <DropdownMenuItem 
                    key={item.name} 
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
                              ? pathname === `/${params.entity}/${params.repo}`
                              : pathname.includes(
                                  `/${params.entity}/${params.repo}/${item.link}`
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
          repoUrl={`/${params.entity}/${params.repo}${
            searchParams?.toString() ? `?${searchParams.toString()}` : ""
          }`}
          repoName={`${ownerDisplayName}/${decodeURIComponent(params.repo)}`}
          onClose={() => setShowRepoQR(false)}
        />
      )}
    </>
  );
}
