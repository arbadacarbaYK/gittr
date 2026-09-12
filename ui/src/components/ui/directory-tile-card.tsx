import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Shared Apps / Pages directory card chrome — profile sections must use this too. */
export const DIRECTORY_TILE_ARTICLE_CLASS = cn(
  "group relative flex h-full min-h-[10rem] gap-4 overflow-hidden rounded-xl border border-[#383B42] bg-[#0E1116]/95 p-5 shadow-md transition",
  "hover:-translate-y-0.5 hover:border-[var(--color-accent-primary)]/50 hover:shadow-lg hover:shadow-[var(--color-accent-primary)]/5"
);

export function DirectoryTileFallbackIcon({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-[#383B42]/80 bg-[#171B21]">
      {children}
    </div>
  );
}
