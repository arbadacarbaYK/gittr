import { isPublisherBlocklisted } from "@/lib/moderation/publisher-blocklist";
import {
  KIND_REPOSITORY_NIP34,
  KIND_REPOSITORY_STATE,
} from "@/lib/nostr/events";
import { isRepoAnnouncementDeleted } from "@/lib/nostr/repo-deleted";
import { isPublicReadFromEvent } from "@/lib/nostr/repo-public-read";
import {
  PROFILE_REPOS_RELAYS,
  withRelayPoolSubscribe,
} from "@/lib/nostr/server-relay-subscribe";
import { extractForgeSourceFromEventTags } from "@/lib/repos/extract-forge-url-from-event-tags";
import { sanitizeForkedFromField } from "@/lib/repos/fork-attribution";
import { preferRepoDisplayName } from "@/lib/repos/merge-profile-repos";
import { hexPubkeyToNpub } from "@/lib/stats";
import { nip34TagValuesFromRow } from "@/lib/utils/nip34-tag-values";

import type { NextApiRequest, NextApiResponse } from "next";
import type { Event } from "nostr-tools";
import { nip19 } from "nostr-tools";

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

function cloneUrlsFromTags(tags: string[][] | undefined): string[] {
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

function forgeSourceFromTags(tags: string[][] | undefined): string | undefined {
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

async function resolveOwnerHex(
  input: string
): Promise<{ hex: string } | { error: string }> {
  const raw = (input || "").trim();
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    return { hex: raw.toLowerCase() };
  }
  if (raw.startsWith("npub")) {
    try {
      const decoded = nip19.decode(raw);
      if (decoded.type === "npub" && typeof decoded.data === "string") {
        return { hex: decoded.data.toLowerCase() };
      }
    } catch {
      return { error: "Invalid npub" };
    }
  }
  return { error: "ownerPubkey must be hex or npub" };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ repos: ProfileRepoRow[] } | { error: string }>
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const ownerInput =
    (typeof req.query.ownerPubkey === "string" && req.query.ownerPubkey) ||
    (typeof req.query.pubkey === "string" && req.query.pubkey) ||
    "";
  const resolved = await resolveOwnerHex(ownerInput);
  if ("error" in resolved) {
    return res.status(400).json({ error: resolved.error });
  }
  const ownerHex = resolved.hex;

  try {
    const byKey = new Map<string, ProfileRepoRow>();

    await withRelayPoolSubscribe(PROFILE_REPOS_RELAYS, async (subscribe) => {
      await new Promise<void>((resolve) => {
        let eoseCount = 0;
        const expectedEose = PROFILE_REPOS_RELAYS.length;
        let done = false;

        const finish = () => {
          if (done) return;
          done = true;
          try {
            unsub();
          } catch {
            /* ignore */
          }
          resolve();
        };

        const upsert = (event: {
          id?: string;
          kind: number;
          pubkey: string;
          created_at: number;
          tags?: string[][];
          content?: string;
        }) => {
          if (isPublisherBlocklisted(event.pubkey)) return;
          const dTag = event.tags?.find(
            (t) => Array.isArray(t) && t[0] === "d"
          );
          const repoName = dTag?.[1];
          if (typeof repoName !== "string" || !repoName) return;
          const key = `${event.pubkey.toLowerCase()}/${repoName}`;
          const ts = event.created_at * 1000;
          const existing = byKey.get(key);

          // Soft-delete tombstone replaces the announcement — drop from profile list
          if (
            event.kind === KIND_REPOSITORY_NIP34 &&
            isRepoAnnouncementDeleted(event)
          ) {
            if (!existing || ts >= existing.lastActivity) {
              byKey.delete(key);
            }
            return;
          }

          let nameFromContent: string | undefined;
          if (event.kind === KIND_REPOSITORY_NIP34 && event.content) {
            try {
              const parsed = JSON.parse(event.content);
              if (parsed?.name) nameFromContent = String(parsed.name);
            } catch {
              /* tags only */
            }
          }
          const nameFromTag =
            event.kind === KIND_REPOSITORY_NIP34
              ? tagValue(event.tags as string[][], "name")
              : undefined;
          const descriptionFromTag =
            event.kind === KIND_REPOSITORY_NIP34
              ? tagValue(event.tags as string[][], "description")
              : undefined;

          // Prefer announcement (30617) privacy over state (30618) when merging.
          const publicRead =
            event.kind === KIND_REPOSITORY_NIP34
              ? isPublicReadFromEvent(event as Event)
              : existing?.publicRead;

          if (!existing || ts >= existing.lastActivity) {
            const name =
              event.kind === KIND_REPOSITORY_NIP34
                ? preferRepoDisplayName(
                    nameFromTag,
                    nameFromContent || existing?.name,
                    repoName
                  )
                : preferRepoDisplayName(existing?.name, undefined, repoName);

            const announceId =
              event.kind === KIND_REPOSITORY_NIP34
                ? event.id || existing?.lastNostrEventId
                : existing?.lastNostrEventId;
            const stateId =
              event.kind === KIND_REPOSITORY_STATE
                ? event.id || existing?.stateEventId
                : existing?.stateEventId;
            const sourceUrl =
              event.kind === KIND_REPOSITORY_NIP34
                ? forgeSourceFromTags(event.tags as string[][]) ||
                  existing?.sourceUrl
                : existing?.sourceUrl;
            const forkedFromRaw =
              event.kind === KIND_REPOSITORY_NIP34
                ? tagValue(event.tags as string[][], "forkedFrom") ||
                  existing?.forkedFrom
                : existing?.forkedFrom;
            const forkedFrom = sanitizeForkedFromField(forkedFromRaw, {
              sourceUrl,
            });
            const clone =
              event.kind === KIND_REPOSITORY_NIP34
                ? cloneUrlsFromTags(event.tags as string[][])
                : existing?.clone;

            byKey.set(key, {
              entity: hexPubkeyToNpub(event.pubkey),
              repo: repoName,
              name,
              description:
                event.kind === KIND_REPOSITORY_NIP34
                  ? descriptionFromTag || existing?.description
                  : existing?.description,
              ownerPubkey: event.pubkey.toLowerCase(),
              lastActivity: ts,
              syncedFromNostr: true,
              lastNostrEventId: announceId,
              lastNostrEventCreatedAt:
                event.kind === KIND_REPOSITORY_NIP34
                  ? event.created_at
                  : existing?.lastNostrEventCreatedAt ?? event.created_at,
              stateEventId: stateId,
              sourceUrl,
              forkedFrom,
              clone: clone && clone.length > 0 ? clone : existing?.clone,
              publicRead:
                event.kind === KIND_REPOSITORY_NIP34
                  ? publicRead
                  : existing?.publicRead !== undefined
                  ? existing.publicRead
                  : true,
            });
          } else if (event.kind === KIND_REPOSITORY_NIP34 && existing) {
            // Older announcement still fills gaps (name/description/privacy)
            if (!existing.description && descriptionFromTag) {
              existing.description = descriptionFromTag;
            }
            existing.name = preferRepoDisplayName(
              existing.name,
              nameFromTag || nameFromContent,
              repoName
            );
            if (existing.publicRead === undefined) {
              existing.publicRead = publicRead;
            }
            if (!existing.sourceUrl) {
              existing.sourceUrl = forgeSourceFromTags(
                event.tags as string[][]
              );
            }
            if (!existing.forkedFrom) {
              existing.forkedFrom = sanitizeForkedFromField(
                tagValue(event.tags as string[][], "forkedFrom"),
                { sourceUrl: existing.sourceUrl }
              );
            }
            if (!existing.clone || existing.clone.length === 0) {
              existing.clone = cloneUrlsFromTags(event.tags as string[][]);
            }
            if (!existing.lastNostrEventId && event.id) {
              existing.lastNostrEventId = event.id;
            }
          }
        };

        const unsub = subscribe(
          [
            {
              kinds: [KIND_REPOSITORY_NIP34, KIND_REPOSITORY_STATE],
              authors: [ownerHex],
              limit: 500,
            },
          ],
          PROFILE_REPOS_RELAYS,
          (event) => upsert(event),
          undefined,
          () => {
            eoseCount++;
            if (eoseCount >= expectedEose) setTimeout(finish, 200);
          },
          {}
        );

        setTimeout(finish, 8000);
      });
    });

    const repos = Array.from(byKey.values()).sort(
      (a, b) => b.lastActivity - a.lastActivity
    );

    res.setHeader(
      "Cache-Control",
      "public, max-age=60, stale-while-revalidate=120"
    );
    return res.status(200).json({ repos });
  } catch (e) {
    console.error("[profile-repos]", e);
    return res
      .status(500)
      .json({ error: "Failed to load profile repositories" });
  }
}
