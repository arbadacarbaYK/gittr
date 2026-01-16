"use client";

import * as React from "react";

import { MobileNav } from "@/components/mobile-nav";
import { cn } from "@/lib/utils";

import { Menu, X } from "lucide-react";
import { useRouter } from "next/navigation";

import Logo from "./logo";
import SearchBar from "./search-bar";

export type NavItem = {
  title: string;
  href: string;
  disabled?: boolean;
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

  const handleToggleMobileMenu = () => {
    setShowMobileMenu(!showMobileMenu);
  };

  const handleNavClick = (
    e: React.MouseEvent<HTMLAnchorElement>,
    href: string,
    disabled?: boolean
  ) => {
    if (disabled || href === "#") {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    // Use Next.js router for client-side navigation - won't be interrupted by re-renders
    router.push(href);
  };

  return (
    <div className="w-full md:w-auto flex items-center justify-center gap-6 md:gap-10">
      <Logo className="hidden md:flex" />

      <div className="hidden max-h-12 md:inline">
        <SearchBar className="w-[162px] lg:w-[272px] focus:w-[600px]" />
      </div>

      {items?.length ? (
        <nav className="hidden gap-6 md:flex">
          {items?.map((item, index) => (
            <a
              key={index}
              href={item.disabled ? "#" : item.href}
              onClick={(e) => handleNavClick(e, item.href, item.disabled)}
              className={cn(
                "flex items-center text-lg font-semibold text-white hover:text-white/80 sm:text-sm",

                item.disabled && "cursor-not-allowed opacity-80"
              )}
            >
              {item.title}
            </a>
          ))}
        </nav>
      ) : null}

      <div className="flex w-full md:w-auto items-center justify-between gap-3">
        <Logo className="flex md:hidden" />
        <button
          aria-label="Toggle navigation menu"
          className="flex items-center justify-center rounded-md p-1 text-white md:hidden"
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
    </div>
  );
}
