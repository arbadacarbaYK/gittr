import { nip19 } from "nostr-tools";

export type ListSearchKind = "issue" | "pr";

export interface ParsedListSearchQuery {
  status?: "open" | "closed";
  author?: string;
  assignee?: string;
  label?: string;
  sort?: "newest" | "oldest" | "updated";
  freeText: string[];
}

export interface ListSearchableItem {
  title: string;
  number: string;
  author: string;
  repo?: string;
  tags?: string[];
  assignees?: string[];
  createdAt?: number;
  updatedAt?: number;
}

type AuthorMeta = {
  name?: string;
  display_name?: string;
  nip05?: string;
};

/** Tokenize search box (supports quoted values). */
export function tokenizeListSearchQuery(raw: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw.trim()))) {
    const t = (m[1] ?? m[2] ?? "").trim();
    if (t) out.push(t);
  }
  return out;
}

export function defaultListSearchQuery(kind: ListSearchKind): string {
  return kind === "issue" ? "is:open is:issue" : "is:open is:pr";
}

export function parseListSearchQuery(raw: string): ParsedListSearchQuery {
  const result: ParsedListSearchQuery = { freeText: [] };
  for (const token of tokenizeListSearchQuery(raw)) {
    const lower = token.toLowerCase();
    if (lower === "is:open") {
      result.status = "open";
      continue;
    }
    if (lower === "is:closed") {
      result.status = "closed";
      continue;
    }
    if (lower === "is:issue" || lower === "is:pr") {
      continue;
    }
    if (lower.startsWith("author:")) {
      result.author = token.slice("author:".length).trim();
      continue;
    }
    if (lower.startsWith("assignee:")) {
      result.assignee = token.slice("assignee:".length).trim();
      continue;
    }
    if (lower.startsWith("label:")) {
      result.label = token.slice("label:".length).trim();
      continue;
    }
    if (lower.startsWith("sort:")) {
      const s = token.slice("sort:".length).trim().toLowerCase();
      if (s === "oldest" || s === "newest" || s === "updated") {
        result.sort = s;
      }
      continue;
    }
    result.freeText.push(token);
  }
  return result;
}

function personMatches(
  pubkeyOrLogin: string,
  needle: string,
  meta?: AuthorMeta
): boolean {
  const n = needle.toLowerCase().trim();
  if (!n) return true;
  const id = (pubkeyOrLogin || "").toLowerCase();
  if (!id) return false;
  if (id === n || id.includes(n)) return true;
  if (/^[0-9a-f]{64}$/i.test(pubkeyOrLogin)) {
    try {
      const npub = nip19.npubEncode(pubkeyOrLogin).toLowerCase();
      if (npub.includes(n) || npub === n) return true;
    } catch {
      /* ignore */
    }
  }
  if (meta) {
    for (const field of [meta.display_name, meta.name, meta.nip05]) {
      if (typeof field === "string" && field.toLowerCase().includes(n)) {
        return true;
      }
    }
    if (typeof meta.nip05 === "string" && meta.nip05.includes("@")) {
      const user = meta.nip05.split("@")[0]?.toLowerCase();
      if (user && (user === n || user.includes(n))) return true;
    }
  }
  return false;
}

export function filterListBySearchQuery<T extends ListSearchableItem>(
  items: T[],
  rawQuery: string,
  kind: ListSearchKind,
  authorMetadata: Record<string, AuthorMeta>
): T[] {
  const defaults = defaultListSearchQuery(kind);
  const q = rawQuery.trim();
  if (!q || q === defaults) {
    return sortListItems(items, "newest");
  }

  const parsed = parseListSearchQuery(q);
  let out = items.filter((item) => {
    if (parsed.author) {
      const meta =
        authorMetadata[item.author?.toLowerCase()] ||
        authorMetadata[item.author];
      if (!personMatches(item.author, parsed.author, meta)) return false;
    }
    if (parsed.assignee) {
      const assignees = item.assignees || [];
      if (
        !assignees.some((a) => {
          const meta = authorMetadata[a?.toLowerCase()] || authorMetadata[a];
          return personMatches(a, parsed.assignee!, meta);
        })
      ) {
        return false;
      }
    }
    if (parsed.label) {
      const tags = (item.tags || []).map((t) => t.toLowerCase());
      const want = parsed.label.toLowerCase();
      if (!tags.some((t) => t === want || t.includes(want))) return false;
    }
    if (parsed.freeText.length > 0) {
      const hay = `${item.title} ${item.number} ${
        item.repo || ""
      }`.toLowerCase();
      for (const ft of parsed.freeText) {
        if (!hay.includes(ft.toLowerCase())) return false;
      }
    }
    return true;
  });

  return sortListItems(out, parsed.sort || "newest");
}

function sortListItems<T extends ListSearchableItem>(
  items: T[],
  sort: "newest" | "oldest" | "updated"
): T[] {
  const copy = [...items];
  copy.sort((a, b) => {
    const au = a.updatedAt || a.createdAt || 0;
    const bu = b.updatedAt || b.createdAt || 0;
    const ac = a.createdAt || 0;
    const bc = b.createdAt || 0;
    if (sort === "oldest") return ac - bc;
    if (sort === "updated") return bu - au;
    return bu - au;
  });
  return copy;
}

/** Set or clear author:/assignee:/label: in the search box. */
export function upsertListSearchQualifier(
  search: string,
  qualifier: "author" | "assignee" | "label",
  value: string | null,
  kind: ListSearchKind
): string {
  const tokens = tokenizeListSearchQuery(search).filter(
    (t) => !t.toLowerCase().startsWith(`${qualifier}:`)
  );
  if (value?.trim()) {
    const v = value.trim();
    const escaped = v.includes(" ") ? `"${v}"` : v;
    tokens.push(`${qualifier}:${escaped}`);
  }
  if (tokens.length === 0) return defaultListSearchQuery(kind);
  const hasType = tokens.some((t) => /^is:(issue|pr)$/i.test(t));
  const hasStatus = tokens.some((t) => /^is:(open|closed)$/i.test(t));
  const out = [...tokens];
  if (!hasStatus) out.unshift("is:open");
  if (!hasType) out.splice(1, 0, kind === "issue" ? "is:issue" : "is:pr");
  return out.join(" ");
}

export function setListSearchOpenClosed(
  search: string,
  status: "open" | "closed",
  kind: ListSearchKind
): string {
  const tokens = tokenizeListSearchQuery(search).filter(
    (t) => !/^is:(open|closed)$/i.test(t)
  );
  tokens.unshift(status === "open" ? "is:open" : "is:closed");
  const hasType = tokens.some((t) => /^is:(issue|pr)$/i.test(t));
  if (!hasType) tokens.splice(1, 0, kind === "issue" ? "is:issue" : "is:pr");
  return tokens.join(" ");
}

export function upsertListSearchSort(
  search: string,
  sort: "newest" | "oldest" | "updated" | null,
  kind: ListSearchKind
): string {
  const tokens = tokenizeListSearchQuery(search).filter(
    (t) => !t.toLowerCase().startsWith("sort:")
  );
  if (sort) tokens.push(`sort:${sort}`);
  if (tokens.length === 0) return defaultListSearchQuery(kind);
  return tokens.join(" ");
}

export function authorLabelForFilter(
  pubkey: string,
  authorMetadata: Record<string, AuthorMeta>
): string {
  const meta = authorMetadata[pubkey?.toLowerCase()] || authorMetadata[pubkey];
  const name = meta?.display_name || meta?.name;
  if (name?.trim()) return name.trim();
  if (/^[0-9a-f]{64}$/i.test(pubkey)) {
    try {
      return `${nip19.npubEncode(pubkey).slice(0, 12)}…`;
    } catch {
      return `${pubkey.slice(0, 8)}…`;
    }
  }
  return pubkey || "unknown";
}
