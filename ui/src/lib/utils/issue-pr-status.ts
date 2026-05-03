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
