"use client";

import { cn } from "@/lib/utils";

import Image from "next/image";

export default function Logo({ className }: { className?: string }) {
  return (
    <a
      href="/"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation(); // Prevent event from bubbling up to parent handlers
        // Use window.location.href directly for reliable navigation (same pattern as all repo page links)
        // This ensures navigation works consistently across all pages, especially on repo pages
        window.location.href = "/";
      }}
      className={cn("items-center space-x-2 flex cursor-pointer", className)}
    >
      <Image
        src="/logo.svg"
        alt="NostrGit"
        width={32}
        height={32}
        className="hover:opacity-80 h-8"
      />
    </a>
  );
}
