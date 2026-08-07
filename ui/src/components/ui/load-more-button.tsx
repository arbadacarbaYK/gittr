"use client";

import { Button } from "@/components/ui/button";
import { REPO_LIST_PAGE_SIZE } from "@/lib/ui/list-pagination";

type LoadMoreButtonProps = {
  visibleCount: number;
  totalCount: number;
  pageSize?: number;
  onLoadMore: () => void;
  className?: string;
};

/**
 * Shared "Load more" control for in-memory repo grids.
 * Renders nothing when everything is already visible.
 */
export function LoadMoreButton({
  visibleCount,
  totalCount,
  pageSize = REPO_LIST_PAGE_SIZE,
  onLoadMore,
  className,
}: LoadMoreButtonProps) {
  if (totalCount <= 0 || visibleCount >= totalCount) return null;

  const remaining = totalCount - visibleCount;
  const nextBatch = Math.min(pageSize, remaining);

  return (
    <div className={className ?? "col-span-full flex justify-center pt-4 pb-2"}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onLoadMore}
        aria-label={`Load ${nextBatch} more of ${remaining} remaining`}
      >
        Load more ({remaining} remaining)
      </Button>
    </div>
  );
}
