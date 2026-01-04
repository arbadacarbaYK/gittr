"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import useSession from "@/lib/nostr/useSession";
import { cn } from "@/lib/utils";

import { Bell, Brush, Cog, Server, User, Coins, Key, Shield } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

// check if signed in, if not, redirect to sign in page

const links = [
  {
    name: "Profile",
    href: "/settings/profile",
    Icon: User,
  },
  {
    name: "Account",
    href: "/settings/account",
    Icon: Cog,
  },
  {
    name: "SSH Keys",
    href: "/settings/ssh-keys",
    Icon: Key,
  },
  {
    name: "Relays",
    href: "/settings/relays",
    Icon: Server,
  },
  {
    name: "Appearance",
    href: "/settings/appearance",
    Icon: Brush,
  },
  {
    name: "Notifications",
    href: "/settings/notifications",
    Icon: Bell,
  },
  {
    name: "Bounties",
    href: "/settings/bounties",
    Icon: Coins,
  },
  {
    name: "Security",
    href: "/settings/security",
    Icon: Shield,
  },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { picture, initials, name } = useSession();
  const { pubkey } = useNostrContext();
  const router = useRouter();
  // Use centralized metadata cache instead of separate useMetadata hook
  const metadataMap = useContributorMetadata(pubkey && /^[0-9a-f]{64}$/i.test(pubkey) ? [pubkey] : []);
  const metadata = pubkey && /^[0-9a-f]{64}$/i.test(pubkey) ? (metadataMap[pubkey] || {}) : {};
  const pathname = usePathname();
  
  // CRITICAL: Prevent hydration mismatch by only rendering client-side dependent content after mount
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);
  
  // Use actual username and picture from metadata if session doesn't have it
  const actualPicture = picture || metadata.picture || "";
  const actualName = name && name !== "Anonymous Nostrich" ? name : (metadata.name || metadata.display_name || "");
  const actualDisplayName = metadata.display_name || actualName || "";
  
  // Generate initials from actual name, not from pubkey
  // Only use session initials if we don't have a name from metadata
  // CRITICAL: Compute initials only on client after mount to prevent hydration mismatch
  const [avatarInitials, setAvatarInitials] = useState("U");
  
  useEffect(() => {
    // Only compute initials on client to prevent hydration mismatch
    if (typeof window === 'undefined' || !mounted) return;
    
    // Compute the initials value
    let computed = "U";
    if (actualName && actualName !== "Anonymous Nostrich") {
      computed = actualName.substring(0, 2).toUpperCase();
    } else if (actualDisplayName && actualDisplayName !== "Anonymous Nostrich") {
      computed = actualDisplayName.substring(0, 2).toUpperCase();
    } else if (initials && !/^\d+$/.test(initials)) {
      computed = initials;
    }
    
    setAvatarInitials(computed);
  }, [mounted, actualName, actualDisplayName, initials]);

  return (
    <>
      <section className="px-5 my-8">
        <div className="flex justify-between">
          <div className="space-x-4 items-center flex">
            <Avatar className="w-12 h-12 overflow-hidden shrink-0">
              {mounted && actualPicture && actualPicture.startsWith("http") ? (
                <AvatarImage 
                  src={actualPicture} 
                  className="w-12 h-12 object-cover max-w-12 max-h-12" 
                  decoding="async" 
                  loading="lazy"
                  style={{ maxWidth: '3rem', maxHeight: '3rem' }}
                  onError={(e) => {
                    // Hide image on error, fallback will show
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : null}
              {/* Only show fallback if no picture or picture failed to load */}
              <AvatarFallback className="bg-purple-600 text-white" suppressHydrationWarning>
                {avatarInitials}
              </AvatarFallback>
            </Avatar>
            <header suppressHydrationWarning>
              {mounted && actualDisplayName && <h2>{actualDisplayName}</h2>}
              {mounted && actualName && <h3 className="text-zinc-500 text-xs">@{actualName}</h3>}
              {mounted && metadata.nip05 && <h3 className="text-zinc-500 text-xs">{metadata.nip05}</h3>}
            </header>
          </div>
        </div>

        <div className="md:flex space-x-6">
          {/* Mobile: Horizontal scrollable navigation */}
          <nav className="my-6 w-full md:max-w-xs overflow-x-auto md:overflow-x-visible">
            <ul className="flex md:flex-col gap-2 md:gap-0">
              {links.map((link) => (
                <li
                  key={link.name}
                  className={cn(
                    pathname == link.href
                      ? "border-purple-500"
                      : "border-transparent",
                    "flex mb-1 px-2 border-l-2 md:border-l-2 border-b md:border-b-0 transition-all min-w-fit md:min-w-0"
                  )}
                >
                  <a
                    href={link.href}
                    onClick={(e) => {
                      e.preventDefault();
                      router.push(link.href);
                    }}
                    className={cn(
                      pathname == link.href && "!bg-zinc-800/50",
                      "flex w-full rounded hover:bg-zinc-900/50 text-sm items-center transition-all px-2 py-1 cursor-pointer whitespace-nowrap"
                    )}
                  >
                    <link.Icon className="w-4 mr-2 text-zinc-400 flex-shrink-0" />
                    {link.name}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <main className="w-full">{children}</main>
        </div>
      </section>
    </>
  );
}
