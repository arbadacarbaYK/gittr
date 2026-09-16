import { nip19 } from "nostr-tools";

export interface DiscussionComment {
  id: string;
  author: string;
  content: string;
  createdAt: number;
  parentId?: string;
  edited?: boolean;
  editedAt?: number;
}

export interface Discussion {
  id: string;
  title: string;
  description: string;
  author: string;
  authorName?: string;
  category?: string;
  createdAt: number;
  commentCount: number;
  comments: DiscussionComment[];
  preview?: string;
  entity?: string;
  repo?: string;
  /** NIP-23 `d` tag — used to collapse replaceable retries. */
  dTag?: string;
  source?: "github" | "nostr" | "local";
  htmlUrl?: string;
  githubNumber?: number;
}

export type PersistDiscussionResult = {
  ok: boolean;
  quota: boolean;
};

export const LOCAL_STORAGE_QUOTA_MESSAGE =
  "This browser ran out of space for gittr’s local cache. The discussion lives on Nostr — it should still open from the list. Free space by closing unused cached repos, or clear site data for gittr.space.";

const DISCUSSION_STORAGE_PREFIX = "gittr_discussions";
const HIDDEN_STORAGE_PREFIX = "gittr_discussions_hidden";

function normalizeEntityForDiscussionKey(entity: string): string {
  if (!entity) return "";
  if (entity.startsWith("npub")) return entity;
  if (/^[0-9a-f]{64}$/i.test(entity)) {
    try {
      return nip19.npubEncode(entity.toLowerCase());
    } catch {
      return entity.toLowerCase();
    }
  }
  return entity;
}

function discussionRepoKey(
  prefix: string,
  entity: string,
  repo: string
): string {
  return `${prefix}__${normalizeEntityForDiscussionKey(entity)}__${repo}`;
}

export function isLocalStorageQuotaError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: number; message?: string };
  return (
    e.name === "QuotaExceededError" ||
    e.code === 22 ||
    /quota/i.test(String(e.message || ""))
  );
}

export function normalizeDiscussionPubkey(value: string | undefined): string {
  const raw = (value || "").trim();
  if (!raw) return "";
  if (/^[0-9a-f]{64}$/i.test(raw)) return raw.toLowerCase();
  if (raw.startsWith("npub")) {
    try {
      const decoded = nip19.decode(raw);
      if (decoded.type === "npub" && typeof decoded.data === "string") {
        return decoded.data.toLowerCase();
      }
    } catch {
      /* ignore */
    }
  }
  return raw.toLowerCase();
}

export function discussionAuthorMatches(
  author: string | undefined,
  viewer: string | undefined
): boolean {
  const a = normalizeDiscussionPubkey(author);
  const b = normalizeDiscussionPubkey(viewer);
  return Boolean(a && b && a === b);
}

export function collectDiscussionStorageKeys(
  entity: string,
  repo: string
): string[] {
  const seen = new Set<string>();
  const add = (k: string) => {
    if (k) seen.add(k);
  };
  add(discussionRepoKey(DISCUSSION_STORAGE_PREFIX, entity, repo));
  add(`${DISCUSSION_STORAGE_PREFIX}_${entity}_${repo}`);
  add(`${DISCUSSION_STORAGE_PREFIX}__${entity}__${repo}`);
  if (/^[0-9a-f]{64}$/i.test(entity)) {
    const hex = entity.toLowerCase();
    add(`${DISCUSSION_STORAGE_PREFIX}_${hex}_${repo}`);
    add(`${DISCUSSION_STORAGE_PREFIX}__${hex}__${repo}`);
    try {
      const npub = nip19.npubEncode(hex);
      add(`${DISCUSSION_STORAGE_PREFIX}_${npub}_${repo}`);
      add(`${DISCUSSION_STORAGE_PREFIX}__${npub}__${repo}`);
    } catch {
      /* ignore */
    }
  }
  if (entity.startsWith("npub")) {
    try {
      const decoded = nip19.decode(entity);
      if (decoded.type === "npub" && typeof decoded.data === "string") {
        const hex = decoded.data.toLowerCase();
        add(`${DISCUSSION_STORAGE_PREFIX}_${hex}_${repo}`);
        add(`${DISCUSSION_STORAGE_PREFIX}__${hex}__${repo}`);
      }
    } catch {
      /* ignore */
    }
  }
  return [...seen];
}

function collectHiddenStorageKeys(entity: string, repo: string): string[] {
  return collectDiscussionStorageKeys(entity, repo).map((key) =>
    key.replace(DISCUSSION_STORAGE_PREFIX, HIDDEN_STORAGE_PREFIX)
  );
}

const sanitizeComment = (raw: unknown): DiscussionComment | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const base = raw as Record<string, unknown>;
  const id = typeof base.id === "string" ? base.id : null;
  const author = typeof base.author === "string" ? base.author : null;
  if (!id || !author) {
    return null;
  }
  const content = typeof base.content === "string" ? base.content : "";
  const createdAt =
    typeof base.createdAt === "number" ? base.createdAt : Date.now();
  const comment: DiscussionComment = {
    id,
    author,
    content,
    createdAt,
  };
  if (typeof base.parentId === "string") {
    comment.parentId = base.parentId;
  }
  if (typeof base.edited === "boolean") {
    comment.edited = base.edited;
  }
  if (typeof base.editedAt === "number") {
    comment.editedAt = base.editedAt;
  }
  return comment;
};

const sanitizeComments = (raw: unknown): DiscussionComment[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => sanitizeComment(item))
    .filter((comment): comment is DiscussionComment => comment !== null);
};

const sanitizeDiscussion = (raw: unknown): Discussion | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const base = raw as Record<string, unknown>;
  const id = typeof base.id === "string" ? base.id : null;
  const title = typeof base.title === "string" ? base.title : null;
  const description =
    typeof base.description === "string" ? base.description : "";
  const author = typeof base.author === "string" ? base.author : null;
  if (!id || !title || !author) {
    return null;
  }
  const comments = sanitizeComments(base.comments);
  const createdAt =
    typeof base.createdAt === "number" ? base.createdAt : Date.now();
  const commentCount =
    typeof base.commentCount === "number" ? base.commentCount : comments.length;

  return {
    id,
    title,
    description,
    author,
    authorName:
      typeof base.authorName === "string" ? base.authorName : undefined,
    category: typeof base.category === "string" ? base.category : undefined,
    createdAt,
    commentCount,
    comments,
    preview: typeof base.preview === "string" ? base.preview : undefined,
    entity: typeof base.entity === "string" ? base.entity : undefined,
    repo: typeof base.repo === "string" ? base.repo : undefined,
    dTag: typeof base.dTag === "string" ? base.dTag : undefined,
    source:
      base.source === "github" ||
      base.source === "nostr" ||
      base.source === "local"
        ? base.source
        : id.startsWith("gh-discussion-")
        ? "github"
        : undefined,
    htmlUrl: typeof base.htmlUrl === "string" ? base.htmlUrl : undefined,
    githubNumber:
      typeof base.githubNumber === "number" ? base.githubNumber : undefined,
  };
};

function parseDiscussionArray(raw: string | null): Discussion[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => sanitizeDiscussion(item))
      .filter((discussion): discussion is Discussion => discussion !== null);
  } catch {
    return [];
  }
}

function mergeById(rows: Discussion[]): Discussion[] {
  const byId = new Map<string, Discussion>();
  for (const row of rows) {
    const prev = byId.get(row.id);
    if (!prev) {
      byId.set(row.id, row);
      continue;
    }
    const richer =
      (row.comments?.length || 0) >= (prev.comments?.length || 0) ? row : prev;
    byId.set(row.id, {
      ...prev,
      ...richer,
      dTag: richer.dTag || prev.dTag,
      comments: richer.comments,
      commentCount: Math.max(
        richer.commentCount || 0,
        prev.commentCount || 0,
        richer.comments.length,
        prev.comments.length
      ),
    });
  }
  return [...byId.values()];
}

export const loadDiscussions = (entity: string, repo: string): Discussion[] => {
  if (typeof window === "undefined") return [];
  try {
    const merged: Discussion[] = [];
    for (const key of collectDiscussionStorageKeys(entity, repo)) {
      merged.push(...parseDiscussionArray(localStorage.getItem(key)));
    }
    return mergeById(merged);
  } catch {
    return [];
  }
};

export const loadDiscussionById = (
  entity: string,
  repo: string,
  id: string
): Discussion | null => {
  const discussions = loadDiscussions(entity, repo);
  return discussions.find((discussion) => discussion.id === id) ?? null;
};

function reclaimLocalStorageQuota(protectKeys: string[] = []): number {
  if (typeof window === "undefined") return 0;
  const skip = new Set(protectKeys.filter(Boolean));
  const entries: { key: string; len: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith("gittr_files__") || skip.has(key)) continue;
    const raw = localStorage.getItem(key);
    entries.push({ key, len: raw ? raw.length : 0 });
  }
  entries.sort((a, b) => b.len - a.len);
  let removed = 0;
  for (const { key } of entries.slice(0, 16)) {
    try {
      localStorage.removeItem(key);
      removed++;
    } catch {
      /* ignore */
    }
  }
  try {
    const meta = localStorage.getItem("gittr_metadata_cache");
    if (meta && meta.length > 80_000) {
      localStorage.removeItem("gittr_metadata_cache");
      localStorage.removeItem("gittr_metadata_cache_saved_at");
      removed++;
    }
  } catch {
    /* ignore */
  }
  return removed;
}

function writeJsonWithReclaim(
  key: string,
  json: string
): PersistDiscussionResult {
  if (typeof window === "undefined") {
    return { ok: false, quota: false };
  }
  try {
    localStorage.setItem(key, json);
    return { ok: true, quota: false };
  } catch (err) {
    if (!isLocalStorageQuotaError(err)) {
      throw err;
    }
    try {
      reclaimLocalStorageQuota([key]);
    } catch {
      /* ignore */
    }
    try {
      localStorage.setItem(key, json);
      return { ok: true, quota: false };
    } catch (retryErr) {
      if (isLocalStorageQuotaError(retryErr)) {
        return { ok: false, quota: true };
      }
      throw retryErr;
    }
  }
}

function persistDiscussionList(
  entity: string,
  repo: string,
  list: Discussion[]
): PersistDiscussionResult {
  const canonical = discussionRepoKey(DISCUSSION_STORAGE_PREFIX, entity, repo);
  const result = writeJsonWithReclaim(canonical, JSON.stringify(list));
  if (!result.ok) return result;
  for (const key of collectDiscussionStorageKeys(entity, repo)) {
    if (key === canonical) continue;
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  return result;
}

export const persistDiscussion = (
  entity: string,
  repo: string,
  updatedDiscussion: Discussion
): PersistDiscussionResult => {
  const discussions = loadDiscussions(entity, repo);
  const exists = discussions.some(
    (discussion) => discussion.id === updatedDiscussion.id
  );
  const updatedList = exists
    ? discussions.map((discussion) =>
        discussion.id === updatedDiscussion.id ? updatedDiscussion : discussion
      )
    : [...discussions, updatedDiscussion];
  return persistDiscussionList(entity, repo, updatedList);
};

export const appendDiscussion = (
  entity: string,
  repo: string,
  newDiscussion: Discussion
): PersistDiscussionResult => persistDiscussion(entity, repo, newDiscussion);

export const removeDiscussion = (
  entity: string,
  repo: string,
  id: string
): PersistDiscussionResult => {
  const next = loadDiscussions(entity, repo).filter(
    (discussion) => discussion.id !== id
  );
  return persistDiscussionList(entity, repo, next);
};

function parseHiddenIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && !!id);
  } catch {
    return [];
  }
}

export function loadHiddenDiscussionIds(
  entity: string,
  repo: string
): Set<string> {
  const ids = new Set<string>();
  if (typeof window === "undefined") return ids;
  for (const key of collectHiddenStorageKeys(entity, repo)) {
    for (const id of parseHiddenIds(localStorage.getItem(key))) {
      ids.add(id);
    }
  }
  return ids;
}

export function hideDiscussion(
  entity: string,
  repo: string,
  id: string
): PersistDiscussionResult {
  const ids = loadHiddenDiscussionIds(entity, repo);
  ids.add(id);
  const canonical = discussionRepoKey(HIDDEN_STORAGE_PREFIX, entity, repo);
  const result = writeJsonWithReclaim(canonical, JSON.stringify([...ids]));
  if (result.ok) {
    removeDiscussion(entity, repo, id);
  }
  return result;
}

export function discussionFromLongFormEvent(
  ev: {
    id: string;
    pubkey: string;
    created_at: number;
    content: string;
    tags?: string[][];
  },
  entity: string,
  repo: string
): Discussion {
  const tags = Array.isArray(ev.tags) ? ev.tags : [];
  const tag = (name: string) => tags.find((t) => t[0] === name)?.[1];
  const title = tag("title") || tag("subject") || "";
  const category = tag("category") || tag("t") || undefined;
  const dTag = tag("d") || undefined;
  return {
    id: ev.id,
    entity,
    repo,
    title,
    description: ev.content || "",
    preview: (ev.content || "").slice(0, 200),
    author: ev.pubkey,
    category,
    createdAt: (ev.created_at || 0) * 1000,
    commentCount: 0,
    comments: [],
    dTag,
    source: "nostr",
  };
}

export function isGithubDiscussion(d: {
  source?: string;
  id?: string;
}): boolean {
  return d.source === "github" || Boolean(d.id?.startsWith("gh-discussion-"));
}

export function discussionBodiesDiffer(
  a: Discussion | null | undefined,
  b: Discussion | null | undefined
): boolean {
  if (!a || !b) return Boolean(a || b);
  return (
    a.title !== b.title ||
    a.description !== b.description ||
    (a.comments?.length || 0) !== (b.comments?.length || 0)
  );
}

/** Persist the full list (used after Nostr list hydrate so restart still has rows). */
export function persistDiscussionListPublic(
  entity: string,
  repo: string,
  list: Discussion[]
): PersistDiscussionResult {
  return persistDiscussionList(entity, repo, mergeById(list));
}

export function discussionsForTab(
  list: Discussion[],
  mode: "forge-readonly" | "nostr-local"
): Discussion[] {
  if (mode === "forge-readonly") {
    return list.filter((d) => isGithubDiscussion(d));
  }
  return list.filter((d) => !isGithubDiscussion(d));
}

export function pickDiscussionVersion(
  fromNostr: Discussion | null,
  fromLocal: Discussion | null,
  view: "nostr" | "local"
): Discussion | null {
  if (view === "local") return fromLocal || fromNostr;
  return fromNostr || fromLocal;
}

export function mergeDiscussionLists(
  fromNostr: Discussion[],
  fromLocal: Discussion[],
  hiddenIds: Iterable<string> = []
): Discussion[] {
  const hidden = new Set(hiddenIds);
  const byKey = new Map<string, Discussion>();
  const put = (row: Discussion) => {
    if (!row?.id || hidden.has(row.id)) return;
    const author = normalizeDiscussionPubkey(row.author);
    const key = row.dTag && author ? `d:${author}:${row.dTag}` : `id:${row.id}`;
    const prev = byKey.get(key);
    if (!prev || row.createdAt >= prev.createdAt) {
      byKey.set(
        key,
        prev
          ? {
              ...prev,
              ...row,
              comments: row.comments?.length ? row.comments : prev.comments,
            }
          : row
      );
    }
  };
  fromNostr.forEach(put);
  fromLocal.forEach(put);
  return [...byKey.values()].sort((a, b) => b.createdAt - a.createdAt);
}

function discussionMergeKey(row: Discussion): string {
  const author = normalizeDiscussionPubkey(row.author);
  return row.dTag && author ? `d:${author}:${row.dTag}` : `id:${row.id}`;
}

/** Pick Nostr or this-browser copy per row (same d-tag / id). */
export function mergeDiscussionListsForView(
  fromNostr: Discussion[],
  fromLocal: Discussion[],
  hiddenIds: Iterable<string> = [],
  view: "nostr" | "local" = "nostr"
): Discussion[] {
  const hidden = new Set(hiddenIds);
  const nostrByKey = new Map<string, Discussion>();
  const localByKey = new Map<string, Discussion>();
  for (const row of fromNostr) {
    if (!row?.id || hidden.has(row.id) || isGithubDiscussion(row)) continue;
    nostrByKey.set(discussionMergeKey(row), row);
  }
  for (const row of fromLocal) {
    if (!row?.id || hidden.has(row.id) || isGithubDiscussion(row)) continue;
    localByKey.set(discussionMergeKey(row), row);
  }
  const keys = new Set([...nostrByKey.keys(), ...localByKey.keys()]);
  const out: Discussion[] = [];
  for (const key of keys) {
    const n = nostrByKey.get(key);
    const l = localByKey.get(key);
    const picked = view === "local" ? l || n : n || l;
    if (picked) {
      out.push(
        picked === n && l
          ? {
              ...n,
              comments: n.comments?.length ? n.comments : l.comments,
              commentCount: Math.max(
                n.commentCount || 0,
                l.commentCount || 0,
                n.comments?.length || 0,
                l.comments?.length || 0
              ),
            }
          : picked
      );
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}
