"use client";

import { useMemo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import useSession from "@/lib/nostr/useSession";
import { cn } from "@/lib/utils";

import { Bell, Brush, Cog, Server, User, Coins, Key, Shield } from "lucide-react";
import { usePathname } from "next/navigation";

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
  // Use centralized metadata cache instead of separate useMetadata hook
  const metadataMap = useContributorMetadata(pubkey && /^[0-9a-f]{64}$/i.test(pubkey) ? [pubkey] : []);
  const metadata = pubkey && /^[0-9a-f]{64}$/i.test(pubkey) ? (metadataMap[pubkey] || {}) : {};
  const pathname = usePathname();
  
  // Use actual username and picture from metadata if session doesn't have it
  const actualPicture = picture || metadata.picture || "";
  const actualName = name && name !== "Anonymous Nostrich" ? name : (metadata.name || metadata.display_name || "");
  const actualDisplayName = metadata.display_name || actualName || "";
  
  // Generate initials from actual name, not from pubkey
  // Only use session initials if we don't have a name from metadata
  const avatarInitials = useMemo(() => {
    if (actualName && actualName !== "Anonymous Nostrich") {
      // Use first 2 characters of the actual name
      return actualName.substring(0, 2).toUpperCase();
    }
    if (actualDisplayName && actualDisplayName !== "Anonymous Nostrich") {
      return actualDisplayName.substring(0, 2).toUpperCase();
    }
    // Fallback to session initials only if they're not numbers (pubkey prefix)
    if (initials && !/^\d+$/.test(initials)) {
      return initials;
    }
    return "U"; // Default fallback
  }, [actualName, actualDisplayName, initials]);

  return (
    <>
      <section className="px-5 my-8">
        <div className="flex justify-between">
          <div className="space-x-4 items-center flex">
            <Avatar className="w-12 h-12 overflow-hidden shrink-0">
              {actualPicture && actualPicture.startsWith("http") ? (
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
              <AvatarFallback className="bg-purple-600 text-white">
                {avatarInitials}
              </AvatarFallback>
            </Avatar>
            <header>
              {actualDisplayName && <h2>{actualDisplayName}</h2>}
              {actualName && <h3 className="text-zinc-500 text-xs">@{actualName}</h3>}
              {metadata.nip05 && <h3 className="text-zinc-500 text-xs">{metadata.nip05}</h3>}
            </header>
          </div>
        </div>

        <div className="md:flex space-x-6">
          <nav className="my-6 w-full max-w-xs">
            <ul>
              {links.map((link) => (
                <li
                  key={link.name}
                  className={cn(
                    pathname == link.href
                      ? "border-purple-500"
                      : "border-transparent",
                    "flex mb-1 px-2 border-l-2 transition-all"
                  )}
                >
                  <a
                    href={link.href}
                    onClick={(e) => {
                      e.preventDefault();
                      window.location.href = link.href;
                    }}
                    className={cn(
                      pathname == link.href && "!bg-zinc-800/50",
                      "flex w-full rounded hover:bg-zinc-900/50 text-sm items-center transition-all px-2 py-1 cursor-pointer"
                    )}
                  >
                    <link.Icon className="w-4 mr-2 text-zinc-400" />
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
