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
import { useNostrContext } from "@/lib/nostr/NostrContext";
import useSession from "@/lib/nostr/useSession";
import { loadStoredRepos } from "@/lib/repos/storage";
import { repoAllowsUserToManagePRsAndIssues } from "@/lib/stats";
import {
  readRepoIssuesFromLocalStorage,
  readRepoPullsFromLocalStorage,
} from "@/lib/utils/entity-normalizer";
import {
  normalizeIssueListStatus,
  normalizePrListStatus,
} from "@/lib/utils/issue-pr-status";

import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { nip19 } from "nostr-tools";

import { MainNav } from "../main-nav";

import { Button, buttonVariants } from "./button";
import { cn } from "@/lib/utils";

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
    title: "Your organizations",
    href: "/organizations",
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
  const { signOut, pubkey } = useNostrContext();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
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
    const bump = () => refreshGlobalIssuePrCounts();
    window.addEventListener("gittr:issue-updated", bump);
    window.addEventListener("gittr:pr-updated", bump);
    window.addEventListener("gittr:repos-updated", bump);
    return () => {
      window.removeEventListener("gittr:issue-updated", bump);
      window.removeEventListener("gittr:pr-updated", bump);
      window.removeEventListener("gittr:repos-updated", bump);
    };
  }, [mounted, isLoggedIn, refreshGlobalIssuePrCounts]);

  const navItems = useMemo(
    () =>
      HeaderConfig.mainNav.map((item) => {
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

  const handleSignOut = useCallback(() => {
    if (signOut) {
      signOut();
      router.push("/");
    }
  }, [router, signOut]);

  // Get profile URL - use npub format if available, otherwise use 8-char prefix
  const profileUrl =
    pubkey && /^[0-9a-f]{64}$/i.test(pubkey)
      ? `/${nip19.npubEncode(pubkey)}`
      : pubkey
      ? `/${pubkey}`
      : "/profile";

  return (
    <header className="flex h-14 w-full items-center justify-between bg-[#171B21] px-8">
      <div className="flex items-center gap-4">
        <MainNav items={navItems} />
        {mounted && isLoggedIn && (
          <a
            href="/new"
            className={cn(buttonVariants({ variant: "outline" }), "max-h-8 min-w-max")}
            onClick={(e) => {
              e.preventDefault();
              router.push("/new");
            }}
          >
            New
          </a>
        )}
      </div>
      <div className="hidden items-center md:inline">
        {mounted && isLoggedIn ? (
          <DropdownMenu>
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
                  onClick={(e) => {
                    e.preventDefault();
                    router.push(profileUrl);
                  }}
                >
                  <DropdownMenuLabel className="cursor-pointer">
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
                      <a
                        href={href}
                        onClick={(e) => {
                          e.preventDefault();
                          router.push(href);
                        }}
                      >
                        {item.title}
                      </a>
                    </DropdownMenuItem>
                  );
                })}
                <DropdownMenuSeparator />

                {restGitInfo?.map((item) => (
                  <DropdownMenuItem key={item.title} asChild>
                    <a
                      href={item.href}
                      onClick={(e) => {
                        e.preventDefault();
                        router.push(item.href);
                      }}
                    >
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
                e.preventDefault();
                router.push("/login");
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
                e.preventDefault();
                router.push("/signup");
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
