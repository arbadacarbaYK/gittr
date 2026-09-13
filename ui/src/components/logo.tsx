"use client";

import { cn } from "@/lib/utils";
import { appNavigate } from "@/lib/utils/app-navigate";

import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";

export default function Logo({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <a
      href="/"
      aria-label="Home"
      onClick={(e) => {
        e.stopPropagation(); // Prevent event from bubbling up to parent handlers
        appNavigate("/", router, pathname, e);
      }}
      className={cn(
        "flex min-h-11 min-w-11 cursor-pointer items-center justify-center space-x-2 md:min-h-0 md:min-w-0",
        className
      )}
    >
      <Image
        src="/logo.svg"
        alt="NostrGit"
        width={40}
        height={40}
        className="h-10 w-10 hover:opacity-80 md:h-8 md:w-8"
        suppressHydrationWarning
      />
    </a>
  );
}
