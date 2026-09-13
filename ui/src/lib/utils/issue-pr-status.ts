/**
 * Find an issue/PR row for `/issues/[id]` or `/pulls/[id]`.
 * Matches hex event id, GitHub `issue-N`/`pr-N`, or display/forge `number`.
 * Does not treat the URL as a 1-based storage index — lists are sorted by
 * recency, so index N is not issue/PR #N.
 */
export function findIssueRowIndexByRouteParam(
  issues: Array<{ id?: string; number?: string | number }>,
  routeIssueId: string
): number {
  const idParam = decodeURIComponent(String(routeIssueId || "")).trim();
  if (!idParam) return -1;
  const idLower = idParam.toLowerCase();

  for (let j = 0; j < issues.length; j++) {
    const row = issues[j];
    if (!row?.id) continue;
    if (String(row.id).toLowerCase() === idLower) return j;
  }

  if (/^\d+$/.test(idParam)) {
    for (let j = 0; j < issues.length; j++) {
      const row = issues[j];
      if (!row?.id) continue;
      const rid = String(row.id);
      if (isGithubStylePrId(rid) && rid.replace(/^pr-/i, "") === idParam) {
        return j;
      }
      if (
        isGithubStyleIssueId(rid) &&
        rid.replace(/^issue-/i, "") === idParam
      ) {
        return j;
      }
    }
    // Numeric URLs are origin forge numbers only. A Nostr row's localStorage
    // counter must never open as /issues/9 — that collision is GitHub #9.
  }

  return -1;
}

/** PR list rows use the same id routing rules as issues (hex id or `number`). */
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

function preserveLocalPrDiffFields(
  prev: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!prev) return {};
  const out: Record<string, unknown> = {};
  if (Array.isArray(prev.changedFiles) && prev.changedFiles.length > 0) {
    out.changedFiles = prev.changedFiles;
  }
  if (typeof prev.path === "string" && prev.path) out.path = prev.path;
  if (prev.before !== undefined) out.before = prev.before;
  if (prev.after !== undefined) out.after = prev.after;
  if (Array.isArray(prev.cloneUrls) && prev.cloneUrls.length > 0) {
    out.cloneUrls = prev.cloneUrls;
  }
  if (prev.currentCommitId) out.currentCommitId = prev.currentCommitId;
  if (prev.mergeBase) out.mergeBase = prev.mergeBase;
  if (prev.headSha) out.headSha = prev.headSha;
  if (prev.baseSha) out.baseSha = prev.baseSha;
  return out;
}

/** Nostr kind-1621 rows use 64-char hex event ids. */
export function isNostrHexIssueId(id: unknown): boolean {
  return /^[0-9a-f]{64}$/i.test(String(id ?? ""));
}

/**
 * Path segment for `/issues/[id]` and `/pulls/[id]` that other browsers can open.
 * Nostr rows use the 64-char event id. GitHub/Gitea imports keep the forge number.
 * Local sequential `number` (#2) is display-only — it is not on the Nostr event.
 */
export function shareableIssueOrPrPathId(row: {
  id?: string;
  number?: string | number;
}): string {
  const id = String(row.id ?? "").trim();
  const number = String(row.number ?? "").trim();
  if (isGithubStyleIssueId(id) || isGithubStylePrId(id)) {
    return number || id.replace(/^(issue|pr)-/i, "");
  }
  if (isNostrHexIssueId(id)) return id;
  return id || number;
}

/**
 * GitHub / Gitea / GitLab import rows (`issue-12`, `pr-12`).
 * These are a read-only mirror: comment on gittr if you want, close/merge at origin.
 */
export function isForgeImportedIssueOrPr(id: unknown): boolean {
  return isGithubStyleIssueId(id) || isGithubStylePrId(id);
}

/** Close / merge / reopen on gittr only for Nostr-native event ids. */
export function canCloseOrMergeOnGittr(row: { id?: string }): boolean {
  const id = String(row?.id ?? "").trim();
  return isNostrHexIssueId(id) && !isForgeImportedIssueOrPr(id);
}

export type IssuePrOriginHost = "github" | "gitlab" | "gitea" | "nostr";

/** Where this row came from — forge import vs a Nostr event. */
export function issuePrOriginHost(row: {
  id?: string;
  html_url?: string;
}): IssuePrOriginHost {
  if (canCloseOrMergeOnGittr(row)) return "nostr";
  const url = String(row.html_url ?? "").toLowerCase();
  if (url.includes("gitlab")) return "gitlab";
  if (
    url.includes("codeberg") ||
    url.includes("gitea") ||
    url.includes("forgejo")
  )
    return "gitea";
  if (url.includes("github") || isForgeImportedIssueOrPr(row.id))
    return "github";
  return isNostrHexIssueId(row.id) ? "nostr" : "github";
}

export function issuePrOriginLabel(row: {
  id?: string;
  html_url?: string;
}): string {
  switch (issuePrOriginHost(row)) {
    case "gitlab":
      return "GitLab";
    case "gitea":
      return "Codeberg / Gitea";
    case "nostr":
      return "Nostr";
    default:
      return "GitHub";
  }
}

/**
 * Shown when someone tries to close/merge/reopen a forge-imported row on gittr.
 * Do not write localStorage `closed` for those rows — GitHub refetch restores
 * origin status and the ticket pops back onto the Open list.
 */
export function forgeLifecycleBlockedMessage(
  kind: "issue" | "pr",
  row: { id?: string; html_url?: string }
): string {
  const origin = issuePrOriginLabel(row);
  const noun = kind === "pr" ? "pull request" : "issue";
  return `This ${noun} lives on ${origin}. gittr cannot close, merge, or reopen a forge copy — that would only hide it here until the next refetch, then it would come back. Close or merge it on ${origin}.`;
}

/**
 * Friendly list/header id. Forge rows keep `#12` (the origin number).
 * Nostr rows use the first 8 chars of the event id — never a localStorage
 * counter that collides with GitHub #9.
 */
export function issueOrPrDisplayNumber(row: {
  id?: string;
  number?: string | number;
}): string {
  const id = String(row.id ?? "").trim();
  if (isForgeImportedIssueOrPr(id)) {
    const number = String(row.number ?? "").trim();
    return number || id.replace(/^(issue|pr)-/i, "");
  }
  if (isNostrHexIssueId(id)) return id.slice(0, 8);
  const number = String(row.number ?? "").trim();
  return number || id;
}

/** `#12` for forge imports, bare `0734b216` for Nostr events. */
export function issueOrPrListRef(row: {
  id?: string;
  number?: string | number;
}): string {
  const display = issueOrPrDisplayNumber(row);
  if (isForgeImportedIssueOrPr(row.id)) return `#${display}`;
  return display;
}

/**
 * Resolve a PR's linked-issue pointer to a row.
 * Matches event id or `issue-N`. A bare number only matches a forge import
 * with that origin number — never a Nostr ticket that reused local #N.
 */
export function findLinkedIssueRow<
  T extends { id?: string; number?: string | number }
>(issues: T[], linkedId: unknown): T | undefined {
  const raw = String(linkedId ?? "").trim();
  if (!raw) return undefined;
  const lower = raw.toLowerCase();

  const byId = issues.find((i) => String(i?.id ?? "").toLowerCase() === lower);
  if (byId) return byId;

  if (!/^\d+$/.test(raw)) return undefined;

  return issues.find((i) => {
    const id = String(i?.id ?? "");
    if (!isForgeImportedIssueOrPr(id)) return false;
    if (isGithubStyleIssueId(id) && id.replace(/^issue-/i, "") === raw) {
      return true;
    }
    return String(i.number ?? "") === raw;
  });
}

/** Dedupe assignee pubkeys (lowercase 64-char hex only). */
export function normalizeAssigneePubkeys(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of list) {
    const pubkey = String(v || "")
      .trim()
      .toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(pubkey)) continue;
    if (seen.has(pubkey)) continue;
    seen.add(pubkey);
    out.push(pubkey);
  }
  return out;
}

function rowTimestamp(row: Record<string, unknown>): number {
  return Number(row.updatedAt ?? row.createdAt ?? 0) || 0;
}

function mergeIssueRowFields(
  rows: Record<string, unknown>[]
): Record<string, unknown> {
  if (rows.length === 0) return {};
  const sorted = [...rows].sort((a, b) => rowTimestamp(b) - rowTimestamp(a));
  const latest = sorted[0];
  if (!latest) return {};
  const nostrRow = rows.find((r) => isNostrHexIssueId(r.id)) ?? latest;
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
    assignees.push(...normalizeAssigneePubkeys(row.assignees));
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
 * Collapse duplicate *forge* rows that share an `issue-N` id (refetch noise).
 * Do **not** glue a GitHub issue to a Nostr issue just because this browser
 * assigned them the same local #N — they are different tickets with different
 * origins and must stay separately linkable.
 */
export function dedupeIssueRowsByNumber(rows: unknown[]): unknown[] {
  const list = Array.isArray(rows) ? rows : [];
  const byForgeId = new Map<string, Record<string, unknown>[]>();
  const standalone: Record<string, unknown>[] = [];

  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = String(r.id ?? "").trim();
    if (isGithubStyleIssueId(id)) {
      const key = id.toLowerCase();
      const bucket = byForgeId.get(key) || [];
      bucket.push(r);
      byForgeId.set(key, bucket);
      continue;
    }
    standalone.push(r);
  }

  const merged: Record<string, unknown>[] = [...standalone];
  for (const group of byForgeId.values()) {
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
        const neid = String(
          (c as { nostrEventId?: string })?.nostrEventId || ""
        );
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
        const neid = String(
          (c as { nostrEventId?: string })?.nostrEventId || ""
        );
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

/** Comment count for list rows (merged GitHub + Nostr localStorage buckets). */
export function countMergedIssueComments(
  entity: string,
  repo: string,
  issue: { id?: string; linkedIds?: string[] }
): number {
  return loadMergedIssueComments(entity, repo, issue).length;
}

/**
 * After refetch from GitHub, merge imported PR rows with existing localStorage:
 * - Keeps Nostr-only rows (id not `pr-<n>`, e.g. hex event ids) so relay PRs are not erased.
 * - If this repo was merged in gittr but GitHub still shows the PR open, keep `merged` and set
 *   `sourcePrStillOpen` so the UI can explain drift (until GitHub reflects the merge).
 * - Keeps hydrated `changedFiles` / git hints so the PR page does not go blank on refetch.
 */
function leftoverGithubStyleRows(
  existing: unknown[],
  fetched: unknown[],
  isGithubId: (id: unknown) => boolean
): unknown[] {
  const fetchedIds = new Set<string>();
  const fetchedNums = new Set<string>();
  for (const row of fetched) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = String(r.id ?? "").toLowerCase();
    if (id) fetchedIds.add(id);
    const num = String(r.number ?? "").trim();
    if (num) fetchedNums.add(num);
  }
  return existing.filter((row) => {
    if (!row || typeof row !== "object") return false;
    const r = row as Record<string, unknown>;
    if (!isGithubId(r.id)) return false;
    const id = String(r.id ?? "").toLowerCase();
    if (id && fetchedIds.has(id)) return false;
    const num = String(r.number ?? "").trim();
    if (num && fetchedNums.has(num)) return false;
    return true;
  });
}

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
      if (!isGithubStylePrId(p.id)) return false;
      return (
        (ghId && String(p.id ?? "") === ghId) ||
        (ghNum && String(p.number ?? "") === ghNum)
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
        ...preserveLocalPrDiffFields(prev),
      };
    }
    return { ...ghRow, ...preserveLocalPrDiffFields(prev) };
  });

  // Open-only / truncated GitHub pages must not delete closed `pr-N` rows.
  const leftoverGithub = leftoverGithubStyleRows(ex, gh, isGithubStylePrId);
  return [...merged, ...leftoverGithub, ...nostrOnly];
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
      if (!isGithubStyleIssueId(p.id)) return false;
      const prevId = String(p.id ?? "");
      const prevNum = String(p.number ?? "").trim();
      return (
        (ghRow.id && prevId === String(ghRow.id)) ||
        (ghNum &&
          (prevId.replace(/^issue-/i, "") === ghNum || prevNum === ghNum))
      );
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

  const leftoverGithub = leftoverGithubStyleRows(ex, gh, isGithubStyleIssueId);
  return dedupeIssueRowsByNumber([
    ...mergedGh,
    ...leftoverGithub,
    ...nostrOnly,
  ]);
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
