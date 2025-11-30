"use client";

import { useCallback, useState, useEffect } from "react";

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
import { nip19 } from "nostr-tools";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { MainNav } from "../main-nav";

import { Button } from "./button";

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
      title: "Explore",
      href: "/explore",
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
    mobile: false,
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
    title: "Upgrade",
    href: "/upgrade",
    mobile: false,
  },
  {
    title: "Help",
    href: "/help",
    mobile: false,
  },
];

const PrimaryGitInfo = DropdownItems.slice(0, 8);
const restGitInfo = DropdownItems.slice(8);

export function Header() {
  const { picture, name, initials, isLoggedIn } = useSession();
  const { signOut, pubkey } = useNostrContext();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  
  // Only render client-side content after hydration
  useEffect(() => {
    setMounted(true);
  }, []);
  
  const handleSignOut = useCallback(() => {
    if (signOut) {
      signOut();
      router.push("/");
    }
  }, [router, signOut]);

  // Get profile URL - use npub format if available, otherwise use 8-char prefix
  const profileUrl = pubkey && /^[0-9a-f]{64}$/i.test(pubkey) ? `/${nip19.npubEncode(pubkey)}` : (pubkey ? `/${pubkey}` : "/profile");

  return (
    <header className="flex h-14 w-full items-center justify-between bg-[#171B21] px-8">
      <div className="flex items-center gap-4">
      <MainNav items={HeaderConfig.mainNav} />
        {mounted && isLoggedIn && (
          <Button variant="outline" className="max-h-8 min-w-max">
            <a href="/new" onClick={(e) => { e.preventDefault(); window.location.href = "/new"; }}>New</a>
          </Button>
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
                      style={{ maxWidth: '2rem', maxHeight: '2rem' }}
                    />
                  ) : null}
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
                <ChevronDown className="mt-1 h-4 w-4 hover:text-white/80" />
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              <DropdownMenuItem asChild>
                <a href={profileUrl} onClick={(e) => { e.preventDefault(); window.location.href = profileUrl; }}>
                <DropdownMenuLabel className="cursor-pointer">
                  {name}
                </DropdownMenuLabel>
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                {PrimaryGitInfo?.map((item) => {
                  // Replace profile href with actual pubkey URL
                  const href = item.href === "/profile" ? profileUrl : item.href;
                  return (
                    <DropdownMenuItem key={item.title} asChild>
                      <a href={href} onClick={(e) => { e.preventDefault(); window.location.href = href; }}>
                        {item.title}
                      </a>
                      </DropdownMenuItem>
                  );
                })}
                <DropdownMenuSeparator />

                {restGitInfo?.map((item) => (
                  <DropdownMenuItem key={item.title} asChild>
                    <a href={item.href} onClick={(e) => { e.preventDefault(); window.location.href = item.href; }}>
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
        ) : mounted ? (
          <div className="flex gap-1 items-center">
            <Button variant="ghost" className="mr-2 max-h-8 min-w-max">
              <a href="/login" onClick={(e) => { e.preventDefault(); window.location.href = "/login"; }}>Sign in</a>
            </Button>
            <Button variant="outline" className="max-h-8 min-w-max">
              <a href="/signup" onClick={(e) => { e.preventDefault(); window.location.href = "/signup"; }}>Sign up</a>
            </Button>
          </div>
        ) : (
          // Server-side: render placeholder to match structure
          <div className="flex gap-1 items-center">
            <Button variant="ghost" className="mr-2 max-h-8 min-w-max">
              <a href="/login">Sign in</a>
            </Button>
            <Button variant="outline" className="max-h-8 min-w-max">
              <a href="/signup">Sign up</a>
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
