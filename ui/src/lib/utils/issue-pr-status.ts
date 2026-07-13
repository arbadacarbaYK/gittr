/**
 * Find an issue row index in the stored array for the current URL segment
 * (`/issues/[id]` may be hex id, display number, or 1-based index).
 */
export function findIssueRowIndexByRouteParam(
  issues: Array<{ id?: string; number?: string | number }>,
  routeIssueId: string
): number {
  const idParam = decodeURIComponent(routeIssueId);
  const idLower = idParam.toLowerCase();

  for (let j = 0; j < issues.length; j++) {
    const row = issues[j];
    if (!row) continue;
    const rid = row.id ? String(row.id).toLowerCase() : "";
    if (rid && idLower === rid) return j;
    if (row.id && idLower === String(row.id).toLowerCase()) return j;
  }

  const numberMatches: number[] = [];
  for (let j = 0; j < issues.length; j++) {
    const row = issues[j];
    if (!row) continue;
    if (row.number != null && String(row.number) === idParam) {
      numberMatches.push(j);
    }
    if (String(j + 1) === idParam) {
      numberMatches.push(j);
    }
  }

  if (numberMatches.length === 1) {
    return numberMatches[0] ?? -1;
  }
  if (numberMatches.length > 1) {
    const nostrIdx = numberMatches.find((j) =>
      isNostrHexIssueId(issues[j]?.id)
    );
    if (nostrIdx !== undefined) return nostrIdx;
    return numberMatches[0] ?? -1;
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

/** GitHub import / refetch uses synthetic ids like `pr-12`. */
export function isGithubStylePrId(id: unknown): boolean {
  return /^pr-\d+$/i.test(String(id ?? ""));
}

/** GitHub import / refetch uses synthetic ids like `issue-3`. */
export function isGithubStyleIssueId(id: unknown): boolean {
  return /^issue-\d+$/i.test(String(id ?? ""));
}

/** Nostr kind-1621 rows use 64-char hex event ids. */
export function isNostrHexIssueId(id: unknown): boolean {
  return /^[0-9a-f]{64}$/i.test(String(id ?? ""));
}

/** Dedupe assignee pubkeys (lowercase 64-char hex only). */
export function normalizeAssigneePubkeys(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of list) {
    const pubkey = String(v || "").trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(pubkey)) continue;
    if (seen.has(pubkey)) continue;
    seen.add(pubkey);
    out.push(pubkey);
  }
  return out;
}

function issueRowNumberKey(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const num = String((row as Record<string, unknown>).number ?? "").trim();
  if (!num || !/^\d+$/.test(num)) return null;
  return num;
}

function rowTimestamp(row: Record<string, unknown>): number {
  return Number(row.updatedAt ?? row.createdAt ?? 0) || 0;
}

function mergeIssueRowFields(
  rows: Record<string, unknown>[]
): Record<string, unknown> {
  if (rows.length === 0) return {};
  const sorted = [...rows].sort(
    (a, b) => rowTimestamp(b) - rowTimestamp(a)
  );
  const latest = sorted[0];
  if (!latest) return {};
  const nostrRow =
    rows.find((r) => isNostrHexIssueId(r.id)) ?? latest;
  const githubRow = rows.find((r) => isGithubStyleIssueId(r.id));

  const ids = rows
    .map((r) => String(r.id ?? "").trim())
    .filter((id) => id.length > 0);
  const canonicalId = isNostrHexIssueId(nostrRow.id)
    ? String(nostrRow.id).toLowerCase()
    : githubRow
      ? String(githubRow.id)
      : String(latest.id ?? "");

  const linkedIds = [...new Set(ids.filter((id) => id !== canonicalId))];

  const labels = new Set<string>();
  const assignees: string[] = [];
  let status: "open" | "closed" = "open";
  let createdAt = Number.POSITIVE_INFINITY;
  let updatedAt = 0;

  for (const row of rows) {
    for (const label of (row.labels as string[] | undefined) || []) {
      if (typeof label === "string" && label.trim()) labels.add(label);
    }
    assignees.push(
      ...normalizeAssigneePubkeys(row.assignees as unknown)
    );
    const st = normalizeIssueListStatus(String(row.status ?? "open"));
    if (st === "closed") status = "closed";
    const ca = Number(row.createdAt ?? 0) || 0;
    const ua = Number(row.updatedAt ?? row.createdAt ?? 0) || 0;
    if (ca > 0 && ca < createdAt) createdAt = ca;
    if (ua > updatedAt) updatedAt = ua;
  }

  const authorFromNostr =
    typeof nostrRow.author === "string" &&
    /^[0-9a-f]{64}$/i.test(nostrRow.author)
      ? String(nostrRow.author).toLowerCase()
      : null;

  return {
    ...latest,
    ...nostrRow,
    ...(githubRow || {}),
    id: canonicalId,
    number: String(latest.number ?? nostrRow.number ?? githubRow?.number ?? ""),
    title: String(latest.title ?? nostrRow.title ?? ""),
    description: String(
      latest.description ??
        latest.body ??
        nostrRow.description ??
        nostrRow.body ??
        ""
    ),
    body: String(
      latest.body ??
        latest.description ??
        nostrRow.body ??
        nostrRow.description ??
        ""
    ),
    author:
      authorFromNostr ||
      String(latest.author ?? nostrRow.author ?? githubRow?.author ?? ""),
    labels: [...labels],
    assignees: normalizeAssigneePubkeys(assignees),
    status,
    createdAt:
      createdAt !== Number.POSITIVE_INFINITY
        ? createdAt
        : Number(latest.createdAt ?? Date.now()),
    updatedAt: updatedAt || Number(latest.updatedAt ?? latest.createdAt ?? 0),
    html_url: githubRow?.html_url ?? latest.html_url,
    linkedIds: linkedIds.length > 0 ? linkedIds : undefined,
  };
}

/**
 * One row per issue number: merge GitHub (`issue-N`) + Nostr (hex id) duplicates.
 * Keeps the Nostr event id when present; merges assignees, labels, status, and timestamps.
 */
export function dedupeIssueRowsByNumber(rows: unknown[]): unknown[] {
  const list = Array.isArray(rows) ? rows : [];
  const byNumber = new Map<string, Record<string, unknown>[]>();
  const standalone: Record<string, unknown>[] = [];

  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const numKey = issueRowNumberKey(r);
    if (!numKey) {
      standalone.push(r);
      continue;
    }
    const bucket = byNumber.get(numKey) || [];
    bucket.push(r);
    byNumber.set(numKey, bucket);
  }

  const merged: Record<string, unknown>[] = [...standalone];
  for (const group of byNumber.values()) {
    if (group.length === 1) {
      const only = group[0];
      if (only) merged.push(only);
      continue;
    }
    merged.push(mergeIssueRowFields(group));
  }

  merged.sort((a, b) => rowTimestamp(b) - rowTimestamp(a));
  return merged;
}

/** Merge comment timelines stored under alternate issue ids into the canonical bucket. */
export function migrateIssueCommentBuckets(
  entity: string,
  repo: string,
  canonicalId: string,
  alternateIds: string[]
): void {
  if (typeof window === "undefined") return;
  if (!canonicalId || alternateIds.length === 0) return;

  const canonicalKey = `gittr_issue_comments_${entity}_${repo}_${canonicalId}`;
  let canonical: unknown[] = [];
  try {
    canonical = JSON.parse(localStorage.getItem(canonicalKey) || "[]");
    if (!Array.isArray(canonical)) canonical = [];
  } catch {
    canonical = [];
  }

  const seen = new Set(
    canonical.map((c) =>
      String((c as { id?: string; nostrEventId?: string })?.id || "")
    )
  );

  for (const altId of alternateIds) {
    const altKey = `gittr_issue_comments_${entity}_${repo}_${altId}`;
    try {
      const altRaw = localStorage.getItem(altKey);
      if (!altRaw) continue;
      const altComments = JSON.parse(altRaw) as unknown[];
      if (!Array.isArray(altComments)) continue;
      for (const c of altComments) {
        const cid = String((c as { id?: string })?.id || "");
        const neid = String((c as { nostrEventId?: string })?.nostrEventId || "");
        if ((cid && seen.has(cid)) || (neid && seen.has(neid))) continue;
        if (cid) seen.add(cid);
        if (neid) seen.add(neid);
        canonical.push(c);
      }
      localStorage.removeItem(altKey);
    } catch {
      /* ignore corrupt bucket */
    }
  }

  canonical.sort(
    (a, b) =>
      Number((a as { createdAt?: number })?.createdAt ?? 0) -
      Number((b as { createdAt?: number })?.createdAt ?? 0)
  );
  localStorage.setItem(canonicalKey, JSON.stringify(canonical));
}

/** Load comments for an issue row, including buckets from merged duplicate ids. */
export function loadMergedIssueComments(
  entity: string,
  repo: string,
  issue: { id?: string; linkedIds?: string[] }
): unknown[] {
  if (typeof window === "undefined") return [];
  const ids = [
    issue.id,
    ...(Array.isArray(issue.linkedIds) ? issue.linkedIds : []),
  ].filter((id): id is string => typeof id === "string" && id.length > 0);

  const seen = new Set<string>();
  const out: unknown[] = [];

  for (const issueId of ids) {
    try {
      const key = `gittr_issue_comments_${entity}_${repo}_${issueId}`;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const list = JSON.parse(raw) as unknown[];
      if (!Array.isArray(list)) continue;
      for (const c of list) {
        const cid = String((c as { id?: string })?.id || "");
        const neid = String((c as { nostrEventId?: string })?.nostrEventId || "");
        const dedupeKey = neid || cid;
        if (dedupeKey && seen.has(dedupeKey)) continue;
        if (dedupeKey) seen.add(dedupeKey);
        out.push(c);
      }
    } catch {
      /* ignore */
    }
  }

  out.sort(
    (a, b) =>
      Number((a as { createdAt?: number })?.createdAt ?? 0) -
      Number((b as { createdAt?: number })?.createdAt ?? 0)
  );
  return out;
}

/**
 * After refetch from GitHub, merge imported PR rows with existing localStorage:
 * - Keeps Nostr-only rows (id not `pr-<n>`, e.g. hex event ids) so relay PRs are not erased.
 * - If this repo was merged in gittr but GitHub still shows the PR open, keep `merged` and set
 *   `sourcePrStillOpen` so the UI can explain drift (until GitHub reflects the merge).
 */
export function mergeGithubPrsAfterRefetch(
  existing: unknown[],
  githubRows: unknown[]
): unknown[] {
  const ex = Array.isArray(existing) ? existing : [];
  const gh = Array.isArray(githubRows) ? githubRows : [];
  const nostrOnly = ex.filter(
    (p) =>
      p &&
      typeof p === "object" &&
      !isGithubStylePrId((p as { id?: unknown }).id)
  );

  const merged = gh.map((row) => {
    const ghRow = row as Record<string, unknown>;
    const ghNum = String(ghRow.number ?? "");
    const ghId = String(ghRow.id ?? "");
    const prev = ex.find((e) => {
      if (!e || typeof e !== "object") return false;
      const p = e as Record<string, unknown>;
      return (
        (ghNum && String(p.number ?? "") === ghNum) ||
        (ghId && String(p.id ?? "") === ghId)
      );
    }) as Record<string, unknown> | undefined;

    const prevStatus = String(prev?.status ?? "").toLowerCase();
    const ghOpen =
      String(ghRow.status ?? "").toLowerCase() === "open" && !ghRow.merged_at;

    if (prev && prevStatus === "merged" && ghOpen) {
      return {
        ...ghRow,
        status: "merged",
        mergedAt: prev.mergedAt ?? prev.merged_at,
        mergedBy: prev.mergedBy,
        mergeCommit: prev.mergeCommit,
        sourcePrStillOpen: true,
      };
    }
    return ghRow;
  });

  return [...merged, ...nostrOnly];
}

/**
 * After refetch from GitHub, keep Nostr-only issue rows (id not `issue-<n>`) alongside GitHub rows.
 */
export function mergeGithubIssuesAfterRefetch(
  existing: unknown[],
  githubRows: unknown[]
): unknown[] {
  const ex = Array.isArray(existing) ? existing : [];
  const gh = Array.isArray(githubRows) ? githubRows : [];
  const nostrOnly = ex.filter(
    (p) =>
      p &&
      typeof p === "object" &&
      !isGithubStyleIssueId((p as { id?: unknown }).id)
  );

  const mergedGh = gh.map((row) => {
    const ghRow = row as Record<string, unknown>;
    const ghNum = String(ghRow.number ?? "");
    const prev = ex.find((e) => {
      if (!e || typeof e !== "object") return false;
      const p = e as Record<string, unknown>;
      return ghNum && String(p.number ?? "") === ghNum;
    }) as Record<string, unknown> | undefined;

    if (!prev) return ghRow;

    return {
      ...ghRow,
      assignees: normalizeAssigneePubkeys([
        ...(Array.isArray(prev.assignees) ? prev.assignees : []),
        ...(Array.isArray(ghRow.assignees) ? ghRow.assignees : []),
      ]),
      labels: [
        ...new Set([
          ...((prev.labels as string[] | undefined) || []),
          ...((ghRow.labels as string[] | undefined) || []),
        ]),
      ],
    };
  });

  return dedupeIssueRowsByNumber([...mergedGh, ...nostrOnly]);
}

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
