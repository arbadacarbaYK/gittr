/**
 * Warm gittr_issues / gittr_prs from Nostr while on any repo tab (Code included).
 * Issues/PRs pages still own the full list UI; this only fills localStorage so
 * layout tab badges update without requiring a tab click.
 */
import {
  KIND_ISSUE,
  KIND_PULL_REQUEST,
  KIND_STATUS_APPLIED,
  KIND_STATUS_CLOSED,
  KIND_STATUS_DRAFT,
  KIND_STATUS_OPEN,
} from "@/lib/nostr/events";
import {
  getRepoStorageKey,
  readRepoIssuesFromLocalStorage,
  readRepoPullsFromLocalStorage,
} from "@/lib/utils/entity-normalizer";
import {
  normalizeIssueListStatus,
  prStatusForNostrKind1618Merge,
} from "@/lib/utils/issue-pr-status";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";
import { resolveEntityToPubkey } from "@/lib/utils/entity-resolver";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SubscribeFn = (...args: any[]) => () => void;

function resolveOwnerHex(entity: string, repo: string): string | null {
  const resolved = resolveEntityToPubkey(entity);
  if (resolved && /^[0-9a-f]{64}$/i.test(resolved)) return resolved.toLowerCase();
  try {
    const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
    const row = findRepoByEntityAndName(repos, entity, repo);
    if (row?.ownerPubkey && /^[0-9a-f]{64}$/i.test(row.ownerPubkey)) {
      return row.ownerPubkey.toLowerCase();
    }
  } catch {
    /* ignore */
  }
  return null;
}

function eventBelongsToRepo(
  event: { tags: string[][] },
  entity: string,
  repo: string,
  ownerHex: string | null
): boolean {
  const aTag = event.tags.find((t) => t[0] === "a");
  if (aTag?.[1]) {
    const parts = aTag[1].split(":");
    if (parts.length >= 3 && parts[0] === "30617") {
      return parts[2] === repo;
    }
  }
  const repoTag = event.tags.find((t) => t[0] === "repo");
  if (!repoTag) return false;
  const ownerOk =
    repoTag[1] === entity ||
    (ownerHex != null && repoTag[1] === ownerHex);
  return ownerOk && repoTag[2] === repo;
}

function upsertIssue(entity: string, repo: string, event: any): void {
  const key = getRepoStorageKey("gittr_issues", entity, repo);
  const existing = [
    ...(readRepoIssuesFromLocalStorage(entity, repo) as any[]),
  ];
  const idx = existing.findIndex((i) => i.id === event.id);
  const subjectTag = event.tags.find((t: string[]) => t[0] === "subject");
  let title = subjectTag ? subjectTag[1] : "";
  let description = event.content || "";
  if (!title && event.content) {
    try {
      const old = JSON.parse(event.content);
      title = old.title || "";
      description = old.description || description;
    } catch {
      /* markdown */
    }
  }
  const prior = idx >= 0 ? existing[idx] : undefined;
  const status =
    prior?.status && normalizeIssueListStatus(prior.status) === "closed"
      ? prior.status
      : "open";
  const row = {
    ...(prior || {}),
    id: event.id,
    entity,
    repo,
    title: title || prior?.title || "Untitled Issue",
    description,
    status,
    author: event.pubkey,
    createdAt: event.created_at * 1000,
    number: prior?.number || String(existing.length + 1),
    nostrEventId: prior?.nostrEventId || event.id,
  };
  if (idx >= 0) existing[idx] = row;
  else existing.push(row);
  localStorage.setItem(key, JSON.stringify(existing));
  window.dispatchEvent(new Event("gittr:issue-updated"));
}

function upsertPr(entity: string, repo: string, event: any): void {
  const key = getRepoStorageKey("gittr_prs", entity, repo);
  const existing = [...(readRepoPullsFromLocalStorage(entity, repo) as any[])];
  const idx = existing.findIndex((pr) => pr.id === event.id);
  const subjectTag = event.tags.find((t: string[]) => t[0] === "subject");
  let title = subjectTag ? subjectTag[1] : "";
  let body = event.content || "";
  if (!title && event.content) {
    try {
      const old = JSON.parse(event.content);
      title = old.title || "";
      body = old.description || body;
    } catch {
      /* markdown */
    }
  }
  const prior = idx >= 0 ? existing[idx] : undefined;
  const status = prStatusForNostrKind1618Merge(prior?.status, "open");
  const row = {
    ...(prior || {}),
    id: event.id,
    entity,
    repo,
    title: title || prior?.title || "Untitled PR",
    body,
    status,
    author: event.pubkey,
    createdAt: event.created_at * 1000,
    number: prior?.number || String(existing.length + 1),
    nostrEventId: prior?.nostrEventId || event.id,
  };
  if (idx >= 0) existing[idx] = row;
  else existing.push(row);
  localStorage.setItem(key, JSON.stringify(existing));
  window.dispatchEvent(new Event("gittr:pr-updated"));
}

function applyStatus(
  entity: string,
  repo: string,
  kind: "issues" | "prs",
  event: any
): void {
  const rootTag = event.tags.find(
    (t: string[]) => t[0] === "e" && t[3] === "root"
  );
  if (!rootTag?.[1]) return;
  const eventId = rootTag[1];
  const key =
    kind === "issues"
      ? getRepoStorageKey("gittr_issues", entity, repo)
      : getRepoStorageKey("gittr_prs", entity, repo);
  const rows =
    kind === "issues"
      ? ([...(readRepoIssuesFromLocalStorage(entity, repo) as any[])] as any[])
      : ([...(readRepoPullsFromLocalStorage(entity, repo) as any[])] as any[]);
  const idx = rows.findIndex(
    (r) => (r.nostrEventId || r.id) === eventId
  );
  if (idx < 0) return;

  let status = "open";
  if (event.kind === KIND_STATUS_CLOSED) status = "closed";
  else if (event.kind === KIND_STATUS_APPLIED) status = "merged";
  else if (event.kind === KIND_STATUS_DRAFT) status = "draft";
  else if (event.kind === KIND_STATUS_OPEN) status = "open";

  const prior = rows[idx];
  const priorTime = prior?.lastStatusEventTime || 0;
  const eventTime = (event.created_at || 0) * 1000;
  if (eventTime && priorTime && eventTime < priorTime) return;

  rows[idx] = {
    ...prior,
    status,
    lastStatusEventTime: eventTime || priorTime,
    lastStatusEventId: event.id,
    ...(status === "merged"
      ? {
          sourcePrStillOpen: false,
          mergedBy:
            typeof event.pubkey === "string" && event.pubkey
              ? event.pubkey
              : prior.mergedBy,
          mergedAt: prior.mergedAt || eventTime || Date.now(),
        }
      : {}),
  };
  localStorage.setItem(key, JSON.stringify(rows));
  window.dispatchEvent(
    new Event(kind === "issues" ? "gittr:issue-updated" : "gittr:pr-updated")
  );
}

/**
 * Warm gittr_issues / gittr_prs for ALL of a user's manageable repos in one
 * combined subscription — the header's global open-issue/PR totals read only
 * localStorage, so unvisited repos otherwise count as zero until clicked.
 * Returns cleanup.
 */
export function startWarmAllReposIssuePrFromNostr(opts: {
  repos: Array<{ entity: string; repo: string }>;
  subscribe: SubscribeFn;
  relays: string[];
}): () => void {
  const { repos, subscribe, relays } = opts;
  if (!repos.length || !subscribe || !relays.length) {
    return () => {};
  }

  const byAddr = new Map<string, { entity: string; repo: string }>();
  const byName = new Map<
    string,
    Array<{ entity: string; repo: string; ownerHex: string | null }>
  >();
  const repoTagOwnerVals = new Set<string>();
  for (const r of repos) {
    const ownerHex = resolveOwnerHex(r.entity, r.repo);
    if (ownerHex) byAddr.set(`30617:${ownerHex}:${r.repo}`, r);
    const list = byName.get(r.repo) || [];
    list.push({ ...r, ownerHex });
    byName.set(r.repo, list);
    repoTagOwnerVals.add(r.entity);
    if (ownerHex) repoTagOwnerVals.add(ownerHex);
  }

  const resolveTarget = (event: {
    tags: string[][];
  }): { entity: string; repo: string } | null => {
    const aTag = event.tags?.find((t) => t[0] === "a");
    if (aTag?.[1]) {
      const hit = byAddr.get(aTag[1]);
      if (hit) return hit;
    }
    const repoTag = event.tags?.find((t) => t[0] === "repo");
    if (repoTag?.[1] && repoTag[2]) {
      const candidates = byName.get(repoTag[2]) || [];
      const hit = candidates.find(
        (c) => c.entity === repoTag[1] || c.ownerHex === repoTag[1]
      );
      if (hit) return { entity: hit.entity, repo: hit.repo };
    }
    return null;
  };

  const unsubs: Array<() => void> = [];
  let cancelled = false;

  // Chunk filters — relays commonly cap tag-filter list sizes.
  const filters: any[] = [];
  const addrs = [...byAddr.keys()];
  for (let i = 0; i < addrs.length; i += 40) {
    filters.push({
      kinds: [KIND_ISSUE, KIND_PULL_REQUEST],
      "#a": addrs.slice(i, i + 40),
    });
  }
  // Legacy events carry `repo` tags instead of `a`; match loosely by
  // owner/entity — resolveTarget verifies the exact repo before upserting.
  const ownerVals = [...repoTagOwnerVals];
  for (let i = 0; i < ownerVals.length; i += 40) {
    filters.push({
      kinds: [KIND_ISSUE, KIND_PULL_REQUEST],
      "#repo": ownerVals.slice(i, i + 40),
    });
  }

  unsubs.push(
    subscribe(filters, relays, (event: any) => {
      if (cancelled) return;
      if (event.kind !== KIND_ISSUE && event.kind !== KIND_PULL_REQUEST) return;
      const target = resolveTarget(event);
      if (!target) return;
      try {
        if (event.kind === KIND_ISSUE) {
          upsertIssue(target.entity, target.repo, event);
        } else {
          upsertPr(target.entity, target.repo, event);
        }
      } catch {
        /* ignore */
      }
    })
  );

  // Status pass after root events land (global warm gets more data → 4s).
  const statusTimer = window.setTimeout(() => {
    if (cancelled) return;
    const issueIdToRepo = new Map<string, { entity: string; repo: string }>();
    const prIdToRepo = new Map<string, { entity: string; repo: string }>();
    for (const r of repos) {
      for (const row of readRepoIssuesFromLocalStorage(
        r.entity,
        r.repo
      ) as any[]) {
        const id = row.nostrEventId || row.id;
        if (id) issueIdToRepo.set(id, r);
      }
      for (const row of readRepoPullsFromLocalStorage(
        r.entity,
        r.repo
      ) as any[]) {
        const id = row.nostrEventId || row.id;
        if (id) prIdToRepo.set(id, r);
      }
    }

    const subscribeStatuses = (
      kinds: number[],
      idToRepo: Map<string, { entity: string; repo: string }>,
      kind: "issues" | "prs"
    ) => {
      const ids = [...idToRepo.keys()];
      for (let i = 0; i < ids.length; i += 200) {
        unsubs.push(
          subscribe(
            [{ kinds, "#e": ids.slice(i, i + 200) }],
            relays,
            (event: any) => {
              if (cancelled) return;
              const rootTag = event.tags?.find(
                (t: string[]) => t[0] === "e" && t[3] === "root"
              );
              const target = rootTag?.[1] ? idToRepo.get(rootTag[1]) : null;
              if (!target) return;
              try {
                applyStatus(target.entity, target.repo, kind, event);
              } catch {
                /* ignore */
              }
            }
          )
        );
      }
    };

    subscribeStatuses(
      [KIND_STATUS_OPEN, KIND_STATUS_CLOSED],
      issueIdToRepo,
      "issues"
    );
    subscribeStatuses(
      [KIND_STATUS_OPEN, KIND_STATUS_APPLIED, KIND_STATUS_CLOSED, KIND_STATUS_DRAFT],
      prIdToRepo,
      "prs"
    );
  }, 4000);

  return () => {
    cancelled = true;
    window.clearTimeout(statusTimer);
    for (const u of unsubs) {
      try {
        u();
      } catch {
        /* ignore */
      }
    }
  };
}

/**
 * Subscribe to NIP-34 issues + PRs (+ status) for badge warming.
 * Returns cleanup. Safe alongside Issues/PRs page subscriptions.
 */
export function startWarmRepoIssuePrFromNostr(opts: {
  entity: string;
  repo: string;
  subscribe: SubscribeFn;
  relays: string[];
}): () => void {
  const { entity, repo, subscribe, relays } = opts;
  if (!entity || !repo || !subscribe || !relays.length) {
    return () => {};
  }

  const ownerHex = resolveOwnerHex(entity, repo);
  const unsubs: Array<() => void> = [];
  let cancelled = false;

  const issueFilters: any[] = [
    { kinds: [KIND_ISSUE], "#repo": [entity, repo] },
  ];
  const prFilters: any[] = [
    { kinds: [KIND_PULL_REQUEST], "#repo": [entity, repo] },
  ];
  if (ownerHex) {
    issueFilters.push({
      kinds: [KIND_ISSUE],
      "#a": [`30617:${ownerHex}:${repo}`],
    });
    prFilters.push({
      kinds: [KIND_PULL_REQUEST],
      "#a": [`30617:${ownerHex}:${repo}`],
    });
  }

  unsubs.push(
    subscribe(issueFilters, relays, (event: any) => {
      if (cancelled || event.kind !== KIND_ISSUE) return;
      if (!eventBelongsToRepo(event, entity, repo, ownerHex)) return;
      try {
        upsertIssue(entity, repo, event);
      } catch {
        /* ignore */
      }
    })
  );

  unsubs.push(
    subscribe(prFilters, relays, (event: any) => {
      if (cancelled || event.kind !== KIND_PULL_REQUEST) return;
      if (!eventBelongsToRepo(event, entity, repo, ownerHex)) return;
      try {
        upsertPr(entity, repo, event);
      } catch {
        /* ignore */
      }
    })
  );

  // Status pass after a short delay so root events land first.
  const statusTimer = window.setTimeout(() => {
    if (cancelled) return;
    const issueIds = (readRepoIssuesFromLocalStorage(entity, repo) as any[])
      .map((i) => i.nostrEventId || i.id)
      .filter(Boolean);
    const prIds = (readRepoPullsFromLocalStorage(entity, repo) as any[])
      .map((p) => p.nostrEventId || p.id)
      .filter(Boolean);

    if (issueIds.length) {
      unsubs.push(
        subscribe(
          [
            {
              kinds: [KIND_STATUS_OPEN, KIND_STATUS_CLOSED],
              "#e": issueIds.slice(0, 200),
              // No `#k` — NIP-34 status events historically omit it; `#e` is enough.
            },
          ],
          relays,
          (event: any) => {
            if (cancelled) return;
            try {
              applyStatus(entity, repo, "issues", event);
            } catch {
              /* ignore */
            }
          }
        )
      );
    }
    if (prIds.length) {
      unsubs.push(
        subscribe(
          [
            {
              kinds: [
                KIND_STATUS_OPEN,
                KIND_STATUS_APPLIED,
                KIND_STATUS_CLOSED,
                KIND_STATUS_DRAFT,
              ],
              "#e": prIds.slice(0, 200),
              // No `#k` — older merge status events have no k tag (NIP-34).
            },
          ],
          relays,
          (event: any) => {
            if (cancelled) return;
            try {
              applyStatus(entity, repo, "prs", event);
            } catch {
              /* ignore */
            }
          }
        )
      );
    }
  }, 2500);

  return () => {
    cancelled = true;
    window.clearTimeout(statusTimer);
    for (const u of unsubs) {
      try {
        u();
      } catch {
        /* ignore */
      }
    }
  };
}
