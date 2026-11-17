import { getEventHash } from "nostr-tools";

import {
  KIND_KANBAN_BOARD,
  KIND_KANBAN_CARD,
  type KanbanCardDraft,
  boardPublishHash,
  buildUnsignedKanbanBoardEvent,
  buildUnsignedKanbanCardEvent,
  buildUnsignedKanbanDeletionEvent,
  cardPublishHash,
  kanbanBoardAddress,
  kanbanBoardDTag,
  kanbanCardDTag,
  normalizeColumnId,
} from "./kanban-nip";
import type { StoredProject } from "./storage";

type Signer = {
  getPublicKey: () => Promise<string> | string;
  signEvent: (event: {
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
    pubkey: string;
    id: string;
    sig: string;
  }) => Promise<{ id?: string; pubkey?: string }>;
};

function asCard(
  item: unknown,
  index: number
): KanbanCardDraft & { publishedHash?: string } {
  const row = (item || {}) as KanbanCardDraft & { publishedHash?: string };
  return {
    id: String(row.id || `item-${index}`),
    title: String(row.title || "Card"),
    content: row.content,
    type: row.type || "note",
    status: normalizeColumnId(row.status),
    issueId: row.issueId,
    prId: row.prId,
    githubItemId: row.githubItemId,
    publishedHash: row.publishedHash,
    rank: index,
  };
}

async function signOne(
  signer: Signer,
  pubkey: string,
  unsigned: ReturnType<typeof buildUnsignedKanbanBoardEvent>
) {
  const kind = unsigned.kind;
  if (kind == null || unsigned.created_at == null) {
    throw new Error("Kanban event is missing kind or time");
  }
  const event = {
    kind,
    pubkey,
    tags: (unsigned.tags || []) as string[][],
    content: unsigned.content || "",
    created_at: unsigned.created_at,
    id: "",
    sig: "",
  };
  event.id = getEventHash(event);
  return signer.signEvent(event);
}

/**
 * Sign the board and any cards whose title, column, or body changed.
 * Already-published cards are skipped so a drag is one signature.
 */
export async function publishKanbanBoard(args: {
  project: StoredProject;
  repoName: string;
  repoAddress: string;
  signer: Signer;
  publish: (event: unknown, relays: string[]) => void | Promise<void>;
  relays: string[];
  removedItems?: KanbanCardDraft[];
  /** When set, only these cards are signed. Omit to publish every changed card. */
  cardIds?: string[];
}): Promise<{ project: StoredProject; signed: number }> {
  const pubkey = (await args.signer.getPublicKey()).toLowerCase();
  const author = (args.project.nostrAuthor || pubkey).toLowerCase();
  const weOwnBoard = !args.project.nostrAuthor || author === pubkey;
  const d =
    args.project.nostrD || kanbanBoardDTag(args.repoName, args.project.id);
  const boardAddress = kanbanBoardAddress(author, d);
  const now = Math.floor(Date.now() / 1000);
  let signed = 0;

  const boardHash = boardPublishHash(args.project);
  if (weOwnBoard && args.project.nostrBoardHash !== boardHash) {
    const signedBoard = await signOne(
      args.signer,
      pubkey,
      buildUnsignedKanbanBoardEvent({
        board: {
          id: args.project.id,
          name: args.project.name,
          description: args.project.description,
          githubProjectId: args.project.githubProjectId,
          nostrD: d,
        },
        repoName: args.repoName,
        repoAddress: args.repoAddress,
        pubkeyHex: pubkey,
        now,
      })
    );
    await args.publish(signedBoard, args.relays);
    signed += 1;
  }

  const nextItems = (args.project.items || []).map((item, index) => {
    const card = asCard(item, index);
    return { item, card, index };
  });

  const publishedItems = [];
  for (const entry of nextItems) {
    const hash = cardPublishHash(entry.card, entry.index);
    if (args.cardIds && !args.cardIds.includes(entry.card.id)) {
      publishedItems.push(entry.item);
      continue;
    }
    if (entry.card.publishedHash === hash && args.project.nostrD) {
      publishedItems.push(entry.item);
      continue;
    }
    const signedCard = await signOne(
      args.signer,
      pubkey,
      buildUnsignedKanbanCardEvent({
        card: entry.card,
        projectId: args.project.id,
        boardAddress,
        pubkeyHex: pubkey,
        rank: entry.index,
        now,
      })
    );
    await args.publish(signedCard, args.relays);
    signed += 1;
    const row =
      entry.item && typeof entry.item === "object"
        ? { ...(entry.item as object), publishedHash: hash }
        : entry.item;
    publishedItems.push(row);
  }

  for (const removed of args.removedItems || []) {
    if (!args.project.nostrD) continue;
    const deletion = await signOne(
      args.signer,
      pubkey,
      buildUnsignedKanbanDeletionEvent({
        pubkeyHex: pubkey,
        repoAddress: args.repoAddress,
        address: `${KIND_KANBAN_CARD}:${pubkey}:${kanbanCardDTag(
          args.project.id,
          removed.id
        )}`,
        kind: KIND_KANBAN_CARD,
        now,
      })
    );
    await args.publish(deletion, args.relays);
    signed += 1;
  }

  return {
    project: {
      ...args.project,
      items: publishedItems,
      nostrD: d,
      nostrAuthor: author,
      nostrUpdatedAt: now,
      nostrDirty: false,
      nostrBoardHash: boardHash,
    },
    signed,
  };
}

export async function publishKanbanBoardDeletion(args: {
  project: StoredProject;
  repoAddress: string;
  signer: Signer;
  publish: (event: unknown, relays: string[]) => void | Promise<void>;
  relays: string[];
}): Promise<void> {
  if (!args.project.nostrD || !args.project.nostrAuthor) return;
  const pubkey = (await args.signer.getPublicKey()).toLowerCase();
  if (pubkey !== args.project.nostrAuthor.toLowerCase()) return;
  const deletion = await signOne(
    args.signer,
    pubkey,
    buildUnsignedKanbanDeletionEvent({
      pubkeyHex: pubkey,
      repoAddress: args.repoAddress,
      address: kanbanBoardAddress(
        args.project.nostrAuthor,
        args.project.nostrD
      ),
      kind: KIND_KANBAN_BOARD,
    })
  );
  await args.publish(deletion, args.relays);
}
