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

/** PR list rows use the same id routing rules as issues (hex id, `number`, or 1-based index). */
export const findPullRequestRowIndexByRouteParam =
  findIssueRowIndexByRouteParam;

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

/**
 * Kind 1618 (PR) events do not carry lifecycle status; we default them to open.
 * When relay EOSE/replay re-delivers the PR after a local merge (or status events),
 * spreading that object must not overwrite merged/closed rows in localStorage.
 */
export function prStatusForNostrKind1618Merge(
  existingStatus: string | undefined,
  kindDefault: "open" = "open"
): "open" | "merged" | "closed" {
  const v = String(existingStatus || "")
    .toLowerCase()
    .trim();
  if (v === "merged") return "merged";
  if (v === "closed") return "closed";
  return kindDefault;
}

/** Snapshot of file-level PR data we keep in localStorage (not present on NIP-34 markdown PR events). */
export type PrFileSnapshot = {
  changedFiles?: unknown[];
  path?: string;
  before?: string;
  after?: string;
};

/**
 * Kind 1618 from relays is often markdown-only (no JSON `changedFiles`). Spreading that row
 * must not wipe locally stored diffs — otherwise the PR page shows no files and merge cannot
 * apply README to overrides.
 */
export function mergeNostrKind1618FileSnapshot(
  prior: PrFileSnapshot | undefined,
  parsedFromEvent: PrFileSnapshot
): PrFileSnapshot {
  const inc = parsedFromEvent;
  const cf = inc.changedFiles;
  const hasArrayFiles = Array.isArray(cf) && cf.length > 0;
  const hasSingleFile =
    typeof inc.path === "string" && String(inc.path).trim().length > 0;

  if (hasArrayFiles || hasSingleFile) {
    return {
      changedFiles: hasArrayFiles ? cf : inc.changedFiles,
      path: inc.path,
      before: inc.before,
      after: inc.after,
    };
  }

  return {
    changedFiles: prior?.changedFiles,
    path: prior?.path,
    before: prior?.before,
    after: prior?.after,
  };
}
