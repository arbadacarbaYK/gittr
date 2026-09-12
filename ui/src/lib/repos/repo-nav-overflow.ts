/**
 * How many repo tabs fit on the bar. Overflow (⋯) only when the labels
 * themselves do not fit — never because a tab was hard-forced into the menu.
 */

export function countVisibleRepoNavItems(opts: {
  availableWidth: number;
  itemWidths: number[];
  overflowButtonWidth: number;
  gap: number;
}): number {
  const { availableWidth, itemWidths, overflowButtonWidth, gap } = opts;
  const n = itemWidths.length;
  if (n === 0) return 0;

  const allWidth =
    itemWidths.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, n - 1);
  if (allWidth <= availableWidth + 0.5) return n;

  const budget = availableWidth - overflowButtonWidth - gap;
  let used = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const width = itemWidths[i];
    if (width == null) break;
    const next = used + (count > 0 ? gap : 0) + width;
    if (next > budget + 0.5) break;
    used = next;
    count += 1;
  }
  return Math.max(1, count);
}
