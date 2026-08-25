"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { gittrLabNavEnabled } from "@/lib/lab/gittr-lab-config";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { getAllRelays } from "@/lib/nostr/getAllRelays";
import useSession from "@/lib/nostr/useSession";
import { loadStoredRepos } from "@/lib/repos/storage";
import { resolveGithubUpstreamForTabs } from "@/lib/repos/upstream-precedence";
import { startWarmAllReposIssuePrFromNostr } from "@/lib/repos/warm-repo-issue-pr-counts";
import { repoAllowsUserToManagePRsAndIssues } from "@/lib/stats";
import { cn } from "@/lib/utils";
import { appNavigate } from "@/lib/utils/app-navigate";
import {
  readRepoIssuesFromLocalStorage,
  readRepoPullsFromLocalStorage,
} from "@/lib/utils/entity-normalizer";
import {
  normalizeIssueListStatus,
  normalizePrListStatus,
} from "@/lib/utils/issue-pr-status";

import { ChevronDown } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { nip19 } from "nostr-tools";

import { MainNav } from "../main-nav";

import { Button, buttonVariants } from "./button";

const HeaderConfig = {
  mainNav: [
    {
      title: "Pull Requests",
      href: "/pulls",
    },
    {
      title: "Issues",
      href: "/issues",
    },
    {
      title: "Repos",
      href: "/explore",
    },
    {
      title: "Pages",
      href: "/pages",
      openInNewTab: true,
    },
    {
      title: "Apps",
      href: "/apps",
    },
    {
      title: "Lab",
      href: "/lab",
    },
    {
      title: "Bounty Hunt",
      href: "/bounty-hunt",
    },
  ],
};

// Note: Profile href will be dynamic based on user's pubkey
export const DropdownItems = [
  {
    title: "Your Profile",
    href: "/profile", // Will be replaced dynamically
  },
  {
    title: "Settings",
    href: "/settings",
  },
  {
    title: "Your Repositories",
    href: "/repositories",
  },
  {
    title: "Your projects",
    href: "/projects",
  },
  {
    title: "Your stars",
    href: "/stars",
  },
  {
    title: "Your zaps",
    href: "/zaps",
  },
  {
    title: "Sponsors & Bounties",
    href: "/sponsors",
    mobile: false,
  },
  {
    title: "Help",
    href: "/help",
  },
];

const PrimaryGitInfo = DropdownItems.slice(0, 8);
const restGitInfo = DropdownItems.slice(8);

export function Header() {
  const { picture, name, initials, isLoggedIn } = useSession();
  const { signOut, pubkey, subscribe, defaultRelays } = useNostrContext();
  const router = useRouter();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [openIssueTotal, setOpenIssueTotal] = useState(0);
  const [openPrTotal, setOpenPrTotal] = useState(0);

  // Only render client-side content after hydration
  useEffect(() => {
    setMounted(true);
  }, []);

  const refreshGlobalIssuePrCounts = useCallback(() => {
    if (!pubkey) {
      setOpenIssueTotal(0);
      setOpenPrTotal(0);
      return;
    }
    try {
      const repos = loadStoredRepos().filter((repo) =>
        repoAllowsUserToManagePRsAndIssues(repo, pubkey)
      );
      let issues = 0;
      let prs = 0;
      for (const repo of repos) {
        const entity =
          repo.entity ||
          repo.slug?.split("/")[0] ||
          repo.ownerPubkey?.slice(0, 8) ||
          "";
        const name =
          repo.repo || repo.slug?.split("/")[1] || repo.name || repo.slug || "";
        if (!entity || !name) continue;
        issues += readRepoIssuesFromLocalStorage(entity, name).filter(
          (row) =>
            normalizeIssueListStatus(
              String((row as { status?: string }).status ?? "open")
            ) === "open"
        ).length;
        prs += readRepoPullsFromLocalStorage(entity, name).filter(
          (row) =>
            normalizePrListStatus(
              String((row as { status?: string }).status ?? "open")
            ) === "open"
        ).length;
      }
      setOpenIssueTotal(issues);
      setOpenPrTotal(prs);
    } catch {
      setOpenIssueTotal(0);
      setOpenPrTotal(0);
    }
  }, [pubkey]);

  useEffect(() => {
    if (!mounted || !isLoggedIn) return;
    refreshGlobalIssuePrCounts();
    // Debounced: the global warm below can deliver hundreds of events in a
    // burst; recount once per burst instead of per event.
    let timer: number | undefined;
    const bump = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refreshGlobalIssuePrCounts, 300);
    };
    window.addEventListener("gittr:issue-updated", bump);
    window.addEventListener("gittr:pr-updated", bump);
    window.addEventListener("gittr:repos-updated", bump);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("gittr:issue-updated", bump);
      window.removeEventListener("gittr:pr-updated", bump);
      window.removeEventListener("gittr:repos-updated", bump);
    };
  }, [mounted, isLoggedIn, refreshGlobalIssuePrCounts]);

  // The counts above read only localStorage — /issues and /pulls fill that
  // cache (Nostr + GitHub) when opened; without a matching warm here, the
  // header stayed at "visited repos only". Warm all manageable repos on
  // login (throttled per pubkey; mark only after a warm actually starts).
  useEffect(() => {
    if (!mounted || !isLoggedIn || !pubkey) return;
    if (!subscribe || !defaultRelays?.length) return;
    const warmKey = `gittr_global_issue_pr_warm:${pubkey.slice(0, 16)}`;
    try {
      const last = Number(sessionStorage.getItem(warmKey) || 0);
      // 15 min — avoids re-storming /api/github/proxy on every navigation/refresh
      if (Date.now() - last < 15 * 60_000) return;
    } catch {
      /* warm anyway */
    }
    const manageable = loadStoredRepos()
      .filter((repo) => repoAllowsUserToManagePRsAndIssues(repo, pubkey))
      .map((repo) => {
        const entity =
          repo.entity ||
          repo.slug?.split("/")[0] ||
          repo.ownerPubkey?.slice(0, 8) ||
          "";
        const name =
          repo.repo || repo.slug?.split("/")[1] || repo.name || repo.slug || "";
        return {
          entity,
          repo: name,
          githubSourceUrl:
            entity && name
              ? resolveGithubUpstreamForTabs(entity, name, repo)
              : null,
        };
      })
      .filter((r) => r.entity && r.repo);
    if (!manageable.length) return;
    const cleanup = startWarmAllReposIssuePrFromNostr({
      repos: manageable,
      subscribe,
      relays: getAllRelays(defaultRelays),
    });
    try {
      sessionStorage.setItem(warmKey, String(Date.now()));
    } catch {
      /* ignore */
    }
    return cleanup;
  }, [mounted, isLoggedIn, pubkey, subscribe, defaultRelays]);

  const navItems = useMemo(
    () =>
      HeaderConfig.mainNav
        .filter((item) => item.href !== "/lab" || gittrLabNavEnabled())
        .map((item) => {
          if (item.href === "/issues" && isLoggedIn && openIssueTotal > 0) {
            return { ...item, badgeCount: openIssueTotal };
          }
          if (item.href === "/pulls" && isLoggedIn && openPrTotal > 0) {
            return { ...item, badgeCount: openPrTotal };
          }
          return item;
        }),
    [isLoggedIn, openIssueTotal, openPrTotal]
  );

  const go = useCallback(
    (href: string, e?: { preventDefault: () => void } | null) => {
      // Header stays mounted on soft nav; Radix does not close if we
      // preventDefault the item <a> click. Same as MobileNav: dismiss first.
      setUserMenuOpen(false);
      appNavigate(href, router, pathname, e);
    },
    [router, pathname]
  );

  useEffect(() => {
    setUserMenuOpen(false);
  }, [pathname]);

  const handleSignOut = useCallback(() => {
    if (signOut) {
      signOut();
      go("/");
    }
  }, [go, signOut]);

  // Get profile URL - use npub format if available, otherwise use 8-char prefix
  const profileUrl =
    pubkey && /^[0-9a-f]{64}$/i.test(pubkey)
      ? `/${nip19.npubEncode(pubkey)}`
      : pubkey
      ? `/${pubkey}`
      : "/profile";

  return (
    <header
      data-repo-chrome
      className="flex h-14 w-full items-center justify-between bg-[#171B21] px-8"
    >
      <div className="flex items-center gap-4">
        <MainNav items={navItems} />
        {mounted && isLoggedIn && (
          <a
            href="/new"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "max-h-8 min-w-max"
            )}
            onClick={(e) => {
              go("/new", e);
            }}
          >
            New
          </a>
        )}
      </div>
      <div className="hidden items-center md:inline">
        {mounted && isLoggedIn ? (
          <DropdownMenu open={userMenuOpen} onOpenChange={setUserMenuOpen}>
            <DropdownMenuTrigger asChild>
              <div className="flex items-center cursor-pointer">
                <Avatar className="w-8 h-8 overflow-hidden shrink-0">
                  {picture && picture.startsWith("http") ? (
                    <AvatarImage
                      src={picture}
                      className="w-8 h-8 object-cover max-w-8 max-h-8"
                      decoding="async"
                      loading="lazy"
                      style={{ maxWidth: "2rem", maxHeight: "2rem" }}
                    />
                  ) : null}
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
                <ChevronDown className="mt-1 h-4 w-4 hover:text-white/80" />
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              <DropdownMenuItem asChild>
                <a
                  href={profileUrl}
                  className="cursor-pointer"
                  onClick={(e) => go(profileUrl, e)}
                >
                  <DropdownMenuLabel className="cursor-pointer p-0 font-normal">
                    {name}
                  </DropdownMenuLabel>
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                {PrimaryGitInfo?.map((item) => {
                  // Replace profile href with actual pubkey URL
                  const href =
                    item.href === "/profile" ? profileUrl : item.href;
                  return (
                    <DropdownMenuItem key={item.title} asChild>
                      <a href={href} onClick={(e) => go(href, e)}>
                        {item.title}
                      </a>
                    </DropdownMenuItem>
                  );
                })}
                <DropdownMenuSeparator />

                {restGitInfo?.map((item) => (
                  <DropdownMenuItem key={item.title} asChild>
                    <a href={item.href} onClick={(e) => go(item.href, e)}>
                      {item.title}
                    </a>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <Button
                  variant={"outline"}
                  type="submit"
                  onClick={handleSignOut}
                >
                  Sign Out
                </Button>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          // Same DOM on server and client until auth mounts — never nest <a> in <button>
          <div className="flex gap-1 items-center">
            <a
              href="/login"
              className={cn(
                buttonVariants({ variant: "ghost" }),
                "mr-2 max-h-8 min-w-max"
              )}
              onClick={(e) => {
                go("/login", e);
              }}
            >
              Sign in
            </a>
            <a
              href="/signup"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "max-h-8 min-w-max"
              )}
              onClick={(e) => {
                go("/signup", e);
              }}
            >
              Sign up
            </a>
          </div>
        )}
      </div>
    </header>
  );
}
