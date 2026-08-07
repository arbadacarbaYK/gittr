/** Default page size for in-memory repo card lists (Explore / My Repos / Profile). */
export const REPO_LIST_PAGE_SIZE = 48;

/**
 * Cap visible count when the filtered list shrinks (search/filter change).
 * Keeps scroll-stable "load more" without resetting to page 1 on every render.
 */
export function clampVisibleCount(
  visibleCount: number,
  totalCount: number,
  pageSize: number = REPO_LIST_PAGE_SIZE
): number {
  if (totalCount <= 0) return pageSize;
  if (visibleCount <= 0) return Math.min(pageSize, totalCount);
  return Math.min(visibleCount, totalCount);
}
