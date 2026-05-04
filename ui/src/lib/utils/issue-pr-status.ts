/**
 * Find an issue row index in the stored array for the current URL segment
 * (`/issues/[id]` may be hex id, display number, or 1-based index).
 */
export function findIssueRowIndexByRouteParam(
  issues: Array<{ id?: string; number?: string | number }>,
  routeIssueId: string
): number {
  const idParam = decodeURIComponent(routeIssueId);
  for (let j = 0; j < issues.length; j++) {
    const row = issues[j];
    if (!row) continue;
    const rid = row.id ? String(row.id).toLowerCase() : "";
    if (rid && idParam.toLowerCase() === rid) return j;
    if (row.number != null && String(row.number) === idParam) return j;
    if (String(j + 1) === idParam) return j;
  }
  return -1;
}

/** Normalize stored issue status for list filters and counts (open vs closed). */
export function normalizeIssueListStatus(
  s: string | undefined
): "open" | "closed" {
  const v = String(s || "open")
    .toLowerCase()
    .trim();
  if (v === "closed" || v === "done" || v === "resolved") return "closed";
  return "open";
}

/** Normalize PR status: merged and closed bucket as "closed" for tabs. */
export function normalizePrListStatus(
  s: string | undefined
): "open" | "closed" {
  const v = String(s || "open")
    .toLowerCase()
    .trim();
  if (v === "closed" || v === "merged") return "closed";
  return "open";
}
