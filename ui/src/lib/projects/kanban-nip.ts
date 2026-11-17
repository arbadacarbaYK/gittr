/**
 * Repo ToDo boards as general Nostr kanban events.
 *
 * Draft: https://github.com/nostr-protocol/nips/pull/1665
 * (same text as https://github.com/vivganes/kanbanstr/blob/main/NIP-100.md)
 *
 * gittr additions, proposed on that draft rather than a private kind:
 * - `s` is the column id (`todo`, `in_progress`, `done`), not the column title
 * - a board may carry one `a` tag `30617:<owner>:<repo>`
 * - issue/PR cards are tracker cards (`k` + `e`) when the ticket is a Nostr event
 * - closed / merged NIP-34 status moves a tracker to `done`; a newer open status
 *   moves it out of `done` only. In Progress is left alone while the ticket stays open.
 */
import type { StoredProject } from "./storage";

export const KIND_KANBAN_BOARD = 30301;
export const KIND_KANBAN_CARD = 30302;
export const KIND_ISSUE = 1621;
const KIND_PULL_REQUEST = 1618;
const KIND_STATUS_OPEN = 1630;
const KIND_STATUS_APPLIED = 1631;
const KIND_STATUS_CLOSED = 1632;
const KIND_STATUS_DRAFT = 1633;

export type KanbanStatus = "todo" | "in_progress" | "done";

export const KANBAN_COLUMNS: Array<{
  id: KanbanStatus;
  name: string;
  order: string;
}> = [
  { id: "todo", name: "To Do", order: "0" },
  { id: "in_progress", name: "In Progress", order: "1" },
  { id: "done", name: "Done", order: "2" },
];

export type KanbanCardDraft = {
  id: string;
  title: string;
  content?: string;
  type?: "issue" | "pr" | "note";
  status?: KanbanStatus | string;
  issueId?: string;
  prId?: string;
  githubItemId?: string;
  rank?: number;
};

export type KanbanBoardDraft = {
  id: string;
  name: string;
  description?: string;
  items?: KanbanCardDraft[];
  githubProjectId?: string;
  nostrD?: string;
  nostrAuthor?: string;
  view?: "kanban" | "roadmap";
  source?: "github" | "local";
  createdAt?: number;
  status?: "active" | "completed" | "archived";
};

type Tag = string[];

export type NostrLike = {
  id?: string;
  kind?: number;
  pubkey?: string;
  created_at?: number;
  content?: string;
  tags?: unknown;
  sig?: string;
};

export type ParsedKanbanBoard = {
  d: string;
  gittrId?: string;
  title: string;
  description: string;
  repoAddress?: string;
  author: string;
  createdAt: number;
  maintainers: string[];
  githubProjectId?: string;
  eventId?: string;
};

export type ParsedKanbanCard = {
  d: string;
  gittrId?: string;
  title: string;
  content: string;
  columnId: KanbanStatus;
  rank: number;
  boardAddress: string;
  author: string;
  createdAt: number;
  type: "issue" | "pr" | "note";
  issueId?: string;
  prId?: string;
  githubItemId?: string;
  eventId?: string;
};

const HEX_64 = /^[0-9a-f]{64}$/i;

export function kanbanIdentifier(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^\w.:~-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return (cleaned || "board").slice(0, 180);
}

export function kanbanBoardDTag(repoName: string, projectId: string): string {
  return kanbanIdentifier(`${repoName}--${projectId}`);
}

export function kanbanCardDTag(projectId: string, itemId: string): string {
  return kanbanIdentifier(`${projectId}--${itemId}`);
}

export function kanbanBoardAddress(authorHex: string, d: string): string {
  return `${KIND_KANBAN_BOARD}:${authorHex.toLowerCase()}:${d}`;
}

function tagged(tags: Tag[], name: string): string[] {
  const values: string[] = [];
  for (const tag of tags) {
    if (tag[0] === name && tag[1]) values.push(tag[1]);
  }
  return values;
}

function tagValue(tags: Tag[], name: string): string | undefined {
  return tagged(tags, name)[0];
}

function asTags(event: NostrLike): Tag[] {
  if (!Array.isArray(event.tags)) return [];
  return event.tags.filter(
    (tag): tag is Tag => Array.isArray(tag) && typeof tag[0] === "string"
  );
}

function directColumn(raw: string): KanbanStatus | null {
  switch (raw.trim().toLowerCase()) {
    case "todo":
    case "to do":
    case "to-do":
      return "todo";
    case "in_progress":
    case "in progress":
    case "doing":
      return "in_progress";
    case "done":
    case "closed":
    case "complete":
    case "completed":
      return "done";
    default:
      return null;
  }
}

/** Map a NIP-100 `s` value (column id or Kanbanstr column title) onto gittr's three columns. */
export function normalizeColumnId(raw: string | undefined): KanbanStatus {
  if (!raw) return "todo";
  return directColumn(raw) || "todo";
}

export function columnAfterNip34Status(
  current: KanbanStatus,
  statusKind: number
): KanbanStatus {
  if (statusKind === KIND_STATUS_CLOSED || statusKind === KIND_STATUS_APPLIED) {
    return "done";
  }
  if (statusKind === KIND_STATUS_OPEN || statusKind === KIND_STATUS_DRAFT) {
    return current === "done" ? "todo" : current;
  }
  return current;
}

export function columnAfterTicketStatus(
  current: KanbanStatus,
  ticketStatus: string | undefined
): KanbanStatus {
  const status = (ticketStatus || "").trim().toLowerCase();
  if (status === "closed" || status === "merged" || status === "resolved") {
    return "done";
  }
  if (status === "open" || status === "draft") {
    return current === "done" ? "todo" : current;
  }
  return current;
}

export function cardPublishHash(card: KanbanCardDraft, rank: number): string {
  return [
    card.title || "",
    card.content || "",
    normalizeColumnId(card.status),
    card.type || "note",
    card.issueId || "",
    card.prId || "",
    String(rank),
  ].join("\u001f");
}

export function boardPublishHash(board: {
  name?: string;
  description?: string;
  githubProjectId?: string;
}): string {
  return [
    board.name || "",
    board.description || "",
    board.githubProjectId || "",
  ].join("\u001f");
}

function trackerTags(card: KanbanCardDraft): Tag[] {
  const tags: Tag[] = [];
  const issueHex =
    card.issueId && HEX_64.test(card.issueId) ? card.issueId.toLowerCase() : "";
  const prHex =
    card.prId && HEX_64.test(card.prId) ? card.prId.toLowerCase() : "";
  if (card.type === "issue" && issueHex) {
    tags.push(["k", String(KIND_ISSUE)], ["e", issueHex]);
  } else if (card.type === "pr" && prHex) {
    tags.push(["k", String(KIND_PULL_REQUEST)], ["e", prHex]);
  }
  if (card.issueId && !issueHex) tags.push(["issue", card.issueId]);
  if (card.prId && !prHex) tags.push(["pr", card.prId]);
  if (card.githubItemId) tags.push(["mirror", "github", card.githubItemId]);
  return tags;
}

export function buildUnsignedKanbanBoardEvent(input: {
  board: {
    id: string;
    name: string;
    description?: string;
    githubProjectId?: string;
    nostrD?: string;
  };
  repoName: string;
  repoAddress: string;
  pubkeyHex: string;
  now?: number;
}): NostrLike {
  const pubkey = input.pubkeyHex.toLowerCase();
  const d =
    input.board.nostrD || kanbanBoardDTag(input.repoName, input.board.id);
  const tags: Tag[] = [
    ["d", d],
    ["title", input.board.name || "Board"],
    ["alt", `Kanban board ${input.board.name || "Board"}`],
    ["gittr-id", input.board.id],
    ["a", input.repoAddress],
    ["p", pubkey],
  ];
  if (input.board.description) {
    tags.push(["description", input.board.description]);
  }
  for (const column of KANBAN_COLUMNS) {
    tags.push(["col", column.id, column.name, column.order]);
  }
  if (input.board.githubProjectId) {
    tags.push(["mirror", "github", input.board.githubProjectId]);
  }
  return {
    kind: KIND_KANBAN_BOARD,
    created_at: input.now ?? Math.floor(Date.now() / 1000),
    tags,
    content: input.board.description || "",
    pubkey,
    id: "",
    sig: "",
  };
}

export function buildUnsignedKanbanCardEvent(input: {
  card: KanbanCardDraft;
  projectId: string;
  boardAddress: string;
  pubkeyHex: string;
  rank: number;
  now?: number;
}): NostrLike {
  const pubkey = input.pubkeyHex.toLowerCase();
  const title = input.card.title || "Card";
  const body = input.card.content || "";
  const tags: Tag[] = [
    ["d", kanbanCardDTag(input.projectId, input.card.id)],
    ["title", title],
    ["alt", title],
    ["gittr-id", input.card.id],
    ["s", normalizeColumnId(input.card.status)],
    ["rank", String(input.rank)],
    ["a", input.boardAddress],
    ...trackerTags(input.card),
  ];
  if (body) tags.push(["description", body.slice(0, 2000)]);
  return {
    kind: KIND_KANBAN_CARD,
    created_at: input.now ?? Math.floor(Date.now() / 1000),
    tags,
    content: body,
    pubkey,
    id: "",
    sig: "",
  };
}

export function buildUnsignedKanbanDeletionEvent(input: {
  pubkeyHex: string;
  repoAddress: string;
  address: string;
  kind: number;
  now?: number;
}): NostrLike {
  const pubkey = input.pubkeyHex.toLowerCase();
  return {
    kind: 5,
    created_at: input.now ?? Math.floor(Date.now() / 1000),
    tags: [
      ["a", input.address],
      ["a", input.repoAddress],
      ["k", String(input.kind)],
    ],
    content: "Deleted kanban event",
    pubkey,
    id: "",
    sig: "",
  };
}

export function parseKanbanBoardEvent(
  event: NostrLike
): ParsedKanbanBoard | null {
  if (event.kind !== KIND_KANBAN_BOARD) return null;
  const tags = asTags(event);
  const d = tagValue(tags, "d");
  const author = (event.pubkey || "").toLowerCase();
  if (!d || !HEX_64.test(author)) return null;
  const repo = tagged(tags, "a").find((value) => value.startsWith("30617:"));
  const mirror = tags.find(
    (tag) => tag[0] === "mirror" && tag[1] === "github" && tag[2]
  );
  return {
    d,
    gittrId: tagValue(tags, "gittr-id"),
    title: tagValue(tags, "title") || "Board",
    description: tagValue(tags, "description") || event.content || "",
    repoAddress: repo,
    author,
    createdAt: Number(event.created_at) || 0,
    maintainers: tagged(tags, "p")
      .filter((value) => HEX_64.test(value))
      .map((value) => value.toLowerCase()),
    githubProjectId: mirror?.[2],
    eventId: event.id,
  };
}

export function parseKanbanCardEvent(
  event: NostrLike
): ParsedKanbanCard | null {
  if (event.kind !== KIND_KANBAN_CARD) return null;
  const tags = asTags(event);
  const d = tagValue(tags, "d");
  const author = (event.pubkey || "").toLowerCase();
  const boardAddress = tagged(tags, "a").find((value) =>
    value.startsWith(`${KIND_KANBAN_BOARD}:`)
  );
  if (!d || !boardAddress || !HEX_64.test(author)) return null;
  const trackedKind = tagValue(tags, "k");
  const trackedEvent = tags.find(
    (tag) => tag[0] === "e" && tag[1] && HEX_64.test(tag[1])
  );
  const issueTag = tagValue(tags, "issue");
  const prTag = tagValue(tags, "pr");
  const mirror = tags.find(
    (tag) => tag[0] === "mirror" && tag[1] === "github" && tag[2]
  );
  let type: "issue" | "pr" | "note" = "note";
  let issueId = issueTag;
  let prId = prTag;
  if (trackedKind === String(KIND_ISSUE) && trackedEvent?.[1]) {
    type = "issue";
    issueId = trackedEvent[1].toLowerCase();
  } else if (trackedKind === String(KIND_PULL_REQUEST) && trackedEvent?.[1]) {
    type = "pr";
    prId = trackedEvent[1].toLowerCase();
  } else if (issueId) {
    type = "issue";
  } else if (prId) {
    type = "pr";
  }
  const rank = Number(tagValue(tags, "rank"));
  return {
    d,
    gittrId: tagValue(tags, "gittr-id"),
    title: tagValue(tags, "title") || "Card",
    content: event.content || tagValue(tags, "description") || "",
    columnId: normalizeColumnId(tagValue(tags, "s")),
    rank: Number.isFinite(rank) ? rank : 0,
    boardAddress,
    author,
    createdAt: Number(event.created_at) || 0,
    type,
    issueId,
    prId,
    githubItemId: mirror?.[2],
    eventId: event.id,
  };
}

export function parseKanbanDeletion(event: NostrLike): {
  addresses: string[];
} | null {
  if (event.kind !== 5) return null;
  const addresses = tagged(asTags(event), "a").filter(
    (value) =>
      value.startsWith(`${KIND_KANBAN_BOARD}:`) ||
      value.startsWith(`${KIND_KANBAN_CARD}:`)
  );
  if (addresses.length === 0) return null;
  return { addresses };
}

/** Latest card per `d` from the board author or a listed maintainer. */
export function selectBoardCards(
  board: ParsedKanbanBoard,
  cards: ParsedKanbanCard[]
): ParsedKanbanCard[] {
  const address = kanbanBoardAddress(board.author, board.d);
  const allowed = new Set([board.author, ...board.maintainers]);
  const latest = new Map<string, ParsedKanbanCard>();
  for (const card of cards) {
    if (card.boardAddress !== address) continue;
    if (!allowed.has(card.author)) continue;
    const prev = latest.get(card.d);
    if (!prev || card.createdAt >= prev.createdAt) latest.set(card.d, card);
  }
  return [...latest.values()].sort(
    (a, b) => a.rank - b.rank || a.createdAt - b.createdAt
  );
}

export function relayBoardToStored(
  board: ParsedKanbanBoard,
  cards: ParsedKanbanCard[],
  previous?: StoredProject
): StoredProject {
  const items = selectBoardCards(board, cards).map((card) => ({
    id: card.gittrId || card.d,
    title: card.title,
    content: card.content || undefined,
    type: card.type,
    status: card.columnId,
    issueId: card.issueId,
    prId: card.prId,
    githubItemId: card.githubItemId,
    source: board.githubProjectId ? "github" : "local",
    publishedHash: cardPublishHash(
      {
        id: card.gittrId || card.d,
        title: card.title,
        content: card.content,
        type: card.type,
        status: card.columnId,
        issueId: card.issueId,
        prId: card.prId,
      },
      card.rank
    ),
  }));
  return {
    id: previous?.id || board.gittrId || board.d,
    name: board.title,
    description: board.description || undefined,
    status: previous?.status || "active",
    items,
    createdAt: previous?.createdAt || board.createdAt * 1000 || Date.now(),
    view: previous?.view || "kanban",
    source: board.githubProjectId ? "github" : previous?.source || "local",
    githubProjectId: board.githubProjectId || previous?.githubProjectId,
    nostrD: board.d,
    nostrAuthor: board.author,
    nostrUpdatedAt: board.createdAt,
    nostrDirty: false,
    nostrBoardHash: boardPublishHash({
      name: board.title,
      description: board.description,
      githubProjectId: board.githubProjectId,
    }),
  };
}

export function upsertRelayKanbanBoard(
  local: StoredProject[],
  board: ParsedKanbanBoard,
  cards: ParsedKanbanCard[]
): StoredProject[] {
  const matchIndex = local.findIndex(
    (row) =>
      row.nostrD === board.d || row.id === board.gittrId || row.id === board.d
  );
  if (matchIndex >= 0) {
    const current = local[matchIndex];
    if (!current || current.hidden || current.nostrDirty) return local;
    if ((current.nostrUpdatedAt || 0) > board.createdAt) return local;
    const incoming = relayBoardToStored(board, cards, current);
    const next = local.slice();
    next[matchIndex] =
      incoming.items.length === 0 && (current.items?.length || 0) > 0
        ? { ...incoming, items: current.items }
        : incoming;
    return next;
  }
  return [...local, relayBoardToStored(board, cards)];
}

export function hideStoredProject(
  local: StoredProject[],
  projectId: string
): StoredProject[] {
  return local.map((row) =>
    row.id === projectId ? { ...row, hidden: true, nostrDirty: false } : row
  );
}

export function applyTicketStatuses<T extends KanbanCardDraft>(
  items: T[],
  tickets: Map<string, string>
): { items: T[]; changed: boolean } {
  let changed = false;
  const next = items.map((item) => {
    const key = item.issueId || item.prId;
    if (!key) return item;
    const ticketStatus = tickets.get(key) || tickets.get(key.toLowerCase());
    if (!ticketStatus) return item;
    const status = columnAfterTicketStatus(
      normalizeColumnId(item.status),
      ticketStatus
    );
    if (status === item.status) return item;
    changed = true;
    return { ...item, status };
  });
  return { items: next, changed };
}
