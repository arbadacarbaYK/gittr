"use client";

import { cn } from "@/lib/utils";
import Image from "next/image";
import { useRouter } from "next/navigation";

export default function Logo({ className }: { className?: string }) {
  const router = useRouter();
  
  return (
    <a 
      href="/" 
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation(); // Prevent event from bubbling up to parent handlers
        // Use window.location.href for reliable navigation (same pattern as repo page links)
        // This ensures navigation works even if router.push is blocked
        try {
          router.push("/");
        } catch (error) {
          // Fallback to window.location if router.push fails
          window.location.href = "/";
        }
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
