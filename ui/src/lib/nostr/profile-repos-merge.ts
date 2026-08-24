/**
 * Merge kind 30617 (announcement) + 30618 (state) for /api/nostr/profile-repos.
 *
 * Liveness is the **latest 30617** per `d` tag:
 * - If that announce is soft-deleted, the repo is not live.
 * - Kind 30618 may bump `lastActivity` on live repos but must never resurrect
 *   a deleted announce (or win over an older deleted 30617 because it is newer).
 * - An older live 30617 must not overwrite a newer deleted 30617.
 */
import type { Event } from "nostr-tools";
import { nip19 } from "nostr-tools";

import { extractForgeSourceFromEventTags } from "../repos/extract-forge-url-from-event-tags";
import { sanitizeForkedFromField } from "../repos/fork-attribution";
import { preferRepoDisplayName } from "../repos/merge-profile-repos";
import { nip34TagValuesFromRow } from "../utils/nip34-tag-values";

import { isRepoAnnouncementDeleted } from "./repo-deleted";
import { isPublicReadFromEvent } from "./repo-public-read";

const KIND_REPOSITORY_NIP34 = 30617;
const KIND_REPOSITORY_STATE = 30618;

function hexPubkeyToNpub(pubkey: string): string {
  const hex = (pubkey || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) return pubkey;
  try {
    return nip19.npubEncode(hex);
  } catch {
    return hex.slice(0, 8);
  }
}

export type ProfileRepoRow = {
  entity: string;
  repo: string;
  name: string;
  /** From kind 30617 description tag when present */
  description?: string;
  ownerPubkey: string;
  lastActivity: number;
  syncedFromNostr: boolean;
  lastNostrEventId?: string;
  lastNostrEventCreatedAt?: number;
  stateEventId?: string;
  /** Forge upstream from `source` / `forkedFrom` / clone tags */
  sourceUrl?: string;
  /** Real fork parent from `forkedFrom` tag (not this repo's own GitHub URL). */
  forkedFrom?: string;
  clone?: string[];
  /** false = private (gittr public-read:false on 30617). undefined/true = public. */
  publicRead?: boolean;
};

export type ProfileRepoEvent = {
  id?: string;
  kind: number;
  pubkey: string;
  created_at: number;
  tags?: string[][];
  content?: string;
};

type AccEntry = {
  /** Unix ms of the newest 30617 seen (0 = none yet). */
  latestAnnounceAt: number;
  announceDeleted: boolean;
  row?: ProfileRepoRow;
};

export type ProfileRepoAccumulator = Map<string, AccEntry>;

export function cloneUrlsFromTags(tags: string[][] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags || []) {
    if (!Array.isArray(tag) || tag[0] !== "clone") continue;
    for (const v of nip34TagValuesFromRow(tag)) {
      const u = v.trim();
      if (!u || u.includes("localhost") || u.includes("127.0.0.1")) continue;
      const key = u
        .replace(/\/+$/, "")
        .replace(/\.git$/i, "")
        .toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(u);
    }
  }
  return out;
}

export function forgeSourceFromTags(
  tags: string[][] | undefined
): string | undefined {
  const raw = extractForgeSourceFromEventTags(tags || []);
  if (!raw) return undefined;
  return raw
    .replace(/\.git$/i, "")
    .replace(/^git@([^:]+):(.+)$/, "https://$1/$2");
}

function tagValue(
  tags: string[][] | undefined,
  name: string
): string | undefined {
  const row = tags?.find((t) => Array.isArray(t) && t[0] === name);
  const v = row?.[1];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function repoNameFromEvent(event: ProfileRepoEvent): string | undefined {
  const dTag = event.tags?.find((t) => Array.isArray(t) && t[0] === "d");
  const repoName = dTag?.[1];
  if (typeof repoName !== "string" || !repoName) return undefined;
  return repoName;
}

function nameFromAnnounceContent(event: ProfileRepoEvent): string | undefined {
  if (event.kind !== KIND_REPOSITORY_NIP34 || !event.content) return undefined;
  try {
    const parsed = JSON.parse(event.content);
    if (parsed?.name) return String(parsed.name);
  } catch {
    /* tags only */
  }
  return undefined;
}

function accKey(event: ProfileRepoEvent, repoName: string): string {
  return `${event.pubkey.toLowerCase()}/${repoName}`;
}

function fillAnnounceGaps(row: ProfileRepoRow, event: ProfileRepoEvent): void {
  const descriptionFromTag = tagValue(event.tags, "description");
  const nameFromTag = tagValue(event.tags, "name");
  const nameFromContent = nameFromAnnounceContent(event);
  if (!row.description && descriptionFromTag) {
    row.description = descriptionFromTag;
  }
  row.name = preferRepoDisplayName(
    row.name,
    nameFromTag || nameFromContent,
    row.repo
  );
  if (row.publicRead === undefined) {
    row.publicRead = isPublicReadFromEvent(event as Event);
  }
  if (!row.sourceUrl) {
    row.sourceUrl = forgeSourceFromTags(event.tags);
  }
  if (!row.forkedFrom) {
    row.forkedFrom = sanitizeForkedFromField(
      tagValue(event.tags, "forkedFrom"),
      { sourceUrl: row.sourceUrl }
    );
  }
  if (!row.clone || row.clone.length === 0) {
    row.clone = cloneUrlsFromTags(event.tags);
  }
  if (!row.lastNostrEventId && event.id) {
    row.lastNostrEventId = event.id;
  }
}

function buildAnnounceRow(
  event: ProfileRepoEvent,
  repoName: string,
  existing?: ProfileRepoRow
): ProfileRepoRow {
  const ts = event.created_at * 1000;
  const nameFromTag = tagValue(event.tags, "name");
  const nameFromContent = nameFromAnnounceContent(event);
  const descriptionFromTag = tagValue(event.tags, "description");
  const sourceUrl = forgeSourceFromTags(event.tags) || existing?.sourceUrl;
  const forkedFrom = sanitizeForkedFromField(
    tagValue(event.tags, "forkedFrom") || existing?.forkedFrom,
    { sourceUrl }
  );
  const clone = cloneUrlsFromTags(event.tags);
  const publicRead = isPublicReadFromEvent(event as Event);

  return {
    entity: hexPubkeyToNpub(event.pubkey),
    repo: repoName,
    name: preferRepoDisplayName(
      nameFromTag,
      nameFromContent || existing?.name,
      repoName
    ),
    description: descriptionFromTag || existing?.description,
    ownerPubkey: event.pubkey.toLowerCase(),
    lastActivity: Math.max(ts, existing?.lastActivity ?? 0),
    syncedFromNostr: true,
    lastNostrEventId: event.id || existing?.lastNostrEventId,
    lastNostrEventCreatedAt: event.created_at,
    stateEventId: existing?.stateEventId,
    sourceUrl,
    forkedFrom,
    clone: clone.length > 0 ? clone : existing?.clone,
    publicRead,
  };
}

function stubRowFromState(
  event: ProfileRepoEvent,
  repoName: string
): ProfileRepoRow {
  const ts = event.created_at * 1000;
  return {
    entity: hexPubkeyToNpub(event.pubkey),
    repo: repoName,
    name: preferRepoDisplayName(undefined, undefined, repoName),
    ownerPubkey: event.pubkey.toLowerCase(),
    lastActivity: ts,
    syncedFromNostr: true,
    lastNostrEventCreatedAt: event.created_at,
    stateEventId: event.id,
    publicRead: true,
  };
}

export function applyProfileRepoEvent(
  byKey: ProfileRepoAccumulator,
  event: ProfileRepoEvent
): void {
  const repoName = repoNameFromEvent(event);
  if (!repoName) return;
  const key = accKey(event, repoName);
  const ts = event.created_at * 1000;
  const acc = byKey.get(key) || {
    latestAnnounceAt: 0,
    announceDeleted: false,
  };

  if (event.kind === KIND_REPOSITORY_NIP34) {
    if (isRepoAnnouncementDeleted(event)) {
      if (ts >= acc.latestAnnounceAt) {
        acc.latestAnnounceAt = ts;
        acc.announceDeleted = true;
        acc.row = undefined;
        byKey.set(key, acc);
      }
      return;
    }

    if (ts < acc.latestAnnounceAt) {
      if (!acc.announceDeleted && acc.row) {
        fillAnnounceGaps(acc.row, event);
      }
      return;
    }

    acc.latestAnnounceAt = ts;
    acc.announceDeleted = false;
    acc.row = buildAnnounceRow(event, repoName, acc.row);
    byKey.set(key, acc);
    return;
  }

  if (event.kind === KIND_REPOSITORY_STATE) {
    if (acc.announceDeleted) return;
    if (!acc.row) {
      acc.row = stubRowFromState(event, repoName);
    } else if (ts >= acc.row.lastActivity) {
      acc.row.lastActivity = ts;
      acc.row.stateEventId = event.id || acc.row.stateEventId;
    }
    byKey.set(key, acc);
  }
}

export function profileRepoRowsFromAccumulator(
  byKey: ProfileRepoAccumulator
): ProfileRepoRow[] {
  const rows: ProfileRepoRow[] = [];
  for (const acc of byKey.values()) {
    if (acc.announceDeleted || !acc.row) continue;
    rows.push(acc.row);
  }
  return rows.sort((a, b) => b.lastActivity - a.lastActivity);
}
