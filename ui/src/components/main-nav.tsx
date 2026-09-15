"use client";

import * as React from "react";

import { MobileNav } from "@/components/mobile-nav";
import { cn } from "@/lib/utils";
import {
  appNavigate,
  dispatchPauseHeavyCatalog,
} from "@/lib/utils/app-navigate";

import { Menu, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import Logo from "./logo";
import { navItemShortTitle } from "./main-nav-labels";
import SearchBar from "./search-bar";

export type NavItem = {
  title: string;
  /** Phone/tablet one-line header; falls back to `title`. */
  shortTitle?: string;
  href: string;
  disabled?: boolean;
  /** Open in a new tab (e.g. gittr Pages directory while keeping the current tab). */
  openInNewTab?: boolean;
  /** Optional open-count badge (e.g. global Issues / PRs for the logged-in user). */
  badgeCount?: number;
};

export type MainNavItem = NavItem;

export type HeaderConfig = {
  mainNav: MainNavItem[];
};

interface MainNavProps {
  items?: MainNavItem[];
  children?: React.ReactNode;
}

export function MainNav({ items, children }: MainNavProps) {
  const [showMobileMenu, setShowMobileMenu] = React.useState<boolean>(false);
  const router = useRouter();
  const pathname = usePathname();

  const handleToggleMobileMenu = () => {
    setShowMobileMenu(!showMobileMenu);
  };

  React.useEffect(() => {
    const hrefs = new Set<string>(["/"]);
    for (const item of items || []) {
      if (
        item.disabled ||
        item.openInNewTab ||
        !item.href ||
        item.href === "#"
      ) {
        continue;
      }
      hrefs.add(item.href);
    }
    for (const href of hrefs) {
      try {
        router.prefetch(href);
      } catch {
        /* ignore */
      }
    }
  }, [items, router]);

  const handleNavClick = (
    e: React.MouseEvent<HTMLAnchorElement>,
    href: string,
    disabled?: boolean
  ) => {
    if (disabled || href === "#") {
      e.preventDefault();
      return;
    }
    appNavigate(href, router, pathname, e);
  };

  return (
    <div className="flex w-full min-w-0 items-center justify-start gap-2 md:gap-3">
      <Logo className="shrink-0" />

      <div className="min-w-0 max-w-[7.5rem] shrink sm:max-w-[10rem] md:max-w-[12.5rem] lg:max-w-[17rem]">
        <SearchBar className="h-8 w-full max-h-8 text-xs md:text-sm" />
      </div>

      {items?.length ? (
        <nav className="flex min-w-0 flex-1 items-center gap-3 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden sm:gap-4">
          {items?.map((item, index) => (
            <a
              key={index}
              href={item.disabled ? "#" : item.href}
              rel={item.openInNewTab ? "noopener noreferrer" : undefined}
              target={item.openInNewTab ? "_blank" : undefined}
              onPointerDown={(e) => {
                if (
                  item.disabled ||
                  item.openInNewTab ||
                  item.href === "#" ||
                  e.button !== 0 ||
                  e.metaKey ||
                  e.ctrlKey ||
                  e.shiftKey ||
                  e.altKey
                ) {
                  return;
                }
                dispatchPauseHeavyCatalog(pathname);
              }}
              onClick={(e) => {
                if (item.disabled || item.href === "#") {
                  e.preventDefault();
                  return;
                }
                if (item.openInNewTab) {
                  return;
                }
                handleNavClick(e, item.href, item.disabled);
              }}
              className={cn(
                "inline-flex h-11 shrink-0 items-center gap-1 text-xs font-semibold text-white hover:text-white/80 sm:h-auto sm:text-sm",
                item.disabled && "cursor-not-allowed opacity-80"
              )}
            >
              <span className="lg:hidden">{navItemShortTitle(item)}</span>
              <span className="hidden lg:inline">{item.title}</span>
              {typeof item.badgeCount === "number" && item.badgeCount > 0 ? (
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-gray-300">
                  {item.badgeCount}
                </span>
              ) : null}
            </a>
          ))}
        </nav>
      ) : null}

      <button
        type="button"
        aria-label="Toggle navigation menu"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-white md:hidden"
        onClick={handleToggleMobileMenu}
      >
        {showMobileMenu ? <X /> : <Menu />}
      </button>

      {showMobileMenu && items && (
        <MobileNav onClick={handleToggleMobileMenu} items={items}>
          {children}
        </MobileNav>
      )}
    </div>
  );
}
