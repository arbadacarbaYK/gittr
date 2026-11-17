import { describe, expect, it } from "vitest";

import {
  KIND_ISSUE,
  KIND_KANBAN_BOARD,
  KIND_KANBAN_CARD,
  applyTicketStatuses,
  buildUnsignedKanbanBoardEvent,
  buildUnsignedKanbanCardEvent,
  columnAfterNip34Status,
  normalizeColumnId,
  parseKanbanBoardEvent,
  parseKanbanCardEvent,
  selectBoardCards,
  upsertRelayKanbanBoard,
} from "./kanban-nip";
import type { StoredProject } from "./storage";

const AUTHOR = "a".repeat(64);
const OWNER = "b".repeat(64);
const ISSUE = "c".repeat(64);

describe("kanban event shape", () => {
  const board = buildUnsignedKanbanBoardEvent({
    board: {
      id: "project-1",
      name: "Sprint",
      description: "This week",
      githubProjectId: "PVT_1",
    },
    repoName: "gittr",
    repoAddress: `30617:${OWNER}:gittr`,
    pubkeyHex: AUTHOR,
    now: 100,
  });

  it("publishes a repo-linked board with stable column ids", () => {
    expect(board.kind).toBe(KIND_KANBAN_BOARD);
    const tags = board.tags as string[][];
    expect(tags).toContainEqual(["a", `30617:${OWNER}:gittr`]);
    expect(tags).toContainEqual(["col", "todo", "To Do", "0"]);
    expect(tags).toContainEqual(["col", "in_progress", "In Progress", "1"]);
    expect(tags).toContainEqual(["col", "done", "Done", "2"]);
    expect(tags).toContainEqual(["mirror", "github", "PVT_1"]);
    expect(tags.find((tag) => tag[0] === "s")).toBeUndefined();
  });

  it("stores the column id on the card, not the column title", () => {
    const card = buildUnsignedKanbanCardEvent({
      card: {
        id: "item-1",
        title: "Ship it",
        content: "notes",
        type: "issue",
        status: "in_progress",
        issueId: ISSUE,
      },
      projectId: "project-1",
      boardAddress: `${KIND_KANBAN_BOARD}:${AUTHOR}:gittr--project-1`,
      pubkeyHex: AUTHOR,
      rank: 10,
      now: 101,
    });
    expect(card.kind).toBe(KIND_KANBAN_CARD);
    const tags = card.tags as string[][];
    expect(tags).toContainEqual(["s", "in_progress"]);
    expect(tags).not.toContainEqual(["s", "In Progress"]);
    expect(tags).toContainEqual(["k", String(KIND_ISSUE)]);
    expect(tags).toContainEqual(["e", ISSUE]);
    expect(tags).toContainEqual([
      "a",
      `${KIND_KANBAN_BOARD}:${AUTHOR}:gittr--project-1`,
    ]);
  });

  it("keeps a GitHub issue number as a plain card link", () => {
    const card = buildUnsignedKanbanCardEvent({
      card: {
        id: "gh-item-1",
        title: "Imported",
        type: "issue",
        status: "todo",
        issueId: "issue-12",
        githubItemId: "ITEM1",
      },
      projectId: "gh-project-1",
      boardAddress: `${KIND_KANBAN_BOARD}:${AUTHOR}:gittr--gh-project-1`,
      pubkeyHex: AUTHOR,
      rank: 0,
    });
    const tags = card.tags as string[][];
    expect(tags).toContainEqual(["issue", "issue-12"]);
    expect(tags.find((tag) => tag[0] === "k")).toBeUndefined();
    expect(tags).toContainEqual(["mirror", "github", "ITEM1"]);
  });

  it("reads a Kanbanstr column title into the matching column", () => {
    expect(normalizeColumnId("To Do")).toBe("todo");
    expect(normalizeColumnId("In Progress")).toBe("in_progress");
    expect(normalizeColumnId("Done")).toBe("done");
  });

  it("round-trips a board and its tracker card", () => {
    const parsedBoard = parseKanbanBoardEvent(board);
    expect(parsedBoard?.repoAddress).toBe(`30617:${OWNER}:gittr`);
    expect(parsedBoard?.gittrId).toBe("project-1");
    const card = buildUnsignedKanbanCardEvent({
      card: {
        id: "item-1",
        title: "Ship it",
        type: "pr",
        status: "done",
        prId: ISSUE,
      },
      projectId: "project-1",
      boardAddress: `${KIND_KANBAN_BOARD}:${AUTHOR}:${parsedBoard?.d}`,
      pubkeyHex: AUTHOR,
      rank: 2,
    });
    const parsedCard = parseKanbanCardEvent(card);
    expect(parsedCard?.type).toBe("pr");
    expect(parsedCard?.columnId).toBe("done");
    expect(parsedCard?.prId).toBe(ISSUE);
    const selected = selectBoardCards(parsedBoard!, [parsedCard!]);
    expect(selected).toHaveLength(1);
  });

  it("ignores a card from someone who is not a maintainer", () => {
    const parsedBoard = parseKanbanBoardEvent(board)!;
    const stranger = "d".repeat(64);
    const card = parseKanbanCardEvent(
      buildUnsignedKanbanCardEvent({
        card: { id: "x", title: "spam", status: "todo" },
        projectId: "project-1",
        boardAddress: `${KIND_KANBAN_BOARD}:${AUTHOR}:${parsedBoard.d}`,
        pubkeyHex: stranger,
        rank: 0,
      })
    )!;
    expect(selectBoardCards(parsedBoard, [card])).toHaveLength(0);
  });
});

describe("ticket status moves tracker columns", () => {
  it("closes and reopens without pulling an open ticket out of In Progress", () => {
    expect(columnAfterNip34Status("todo", 1632)).toBe("done");
    expect(columnAfterNip34Status("in_progress", 1631)).toBe("done");
    expect(columnAfterNip34Status("in_progress", 1630)).toBe("in_progress");
    expect(columnAfterNip34Status("done", 1630)).toBe("todo");
  });

  it("applies cached issue and PR status onto cards", () => {
    const tickets = new Map<string, string>([
      ["issue-4", "closed"],
      [ISSUE, "open"],
    ]);
    const { items, changed } = applyTicketStatuses(
      [
        {
          id: "a",
          title: "A",
          type: "issue",
          status: "todo",
          issueId: "issue-4",
        },
        {
          id: "b",
          title: "B",
          type: "issue",
          status: "in_progress",
          issueId: ISSUE,
        },
        { id: "c", title: "C", type: "note", status: "todo" },
      ],
      tickets
    );
    expect(changed).toBe(true);
    expect(items[0]?.status).toBe("done");
    expect(items[1]?.status).toBe("in_progress");
    expect(items[2]?.status).toBe("todo");
  });
});

describe("relay ingest", () => {
  it("does not overwrite a board with unpublished local edits", () => {
    const event = buildUnsignedKanbanBoardEvent({
      board: { id: "project-1", name: "From relay" },
      repoName: "gittr",
      repoAddress: `30617:${OWNER}:gittr`,
      pubkeyHex: AUTHOR,
      now: 50,
    });
    const parsed = parseKanbanBoardEvent({ ...event, pubkey: AUTHOR })!;
    const local: StoredProject[] = [
      {
        id: "project-1",
        name: "Local title",
        status: "active",
        items: [],
        createdAt: 1,
        view: "kanban",
        nostrD: parsed.d,
        nostrDirty: true,
        nostrUpdatedAt: 10,
      },
    ];
    const next = upsertRelayKanbanBoard(local, parsed, []);
    expect(next[0]?.name).toBe("Local title");
  });
});
