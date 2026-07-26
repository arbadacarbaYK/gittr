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
        router.push("/");
      }}
      className={cn("items-center space-x-2 flex cursor-pointer", className)}
    >
      <Image
        src="/logo.svg"
        alt="NostrGit"
        width={32}
        height={32}
        className="h-8 w-8 hover:opacity-80"
        suppressHydrationWarning
      />
    </a>
  );
}
