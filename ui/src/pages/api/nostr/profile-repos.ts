import { isPublisherBlocklisted } from "@/lib/moderation/publisher-blocklist";
import {
  KIND_REPOSITORY_NIP34,
  KIND_REPOSITORY_STATE,
} from "@/lib/nostr/events";
import { isRepoAnnouncementDeleted } from "@/lib/nostr/repo-deleted";
import { isPublicReadFromEvent } from "@/lib/nostr/repo-public-read";
import {
  PLATFORM_STATS_RELAYS,
  withRelayPoolSubscribe,
} from "@/lib/nostr/server-relay-subscribe";
import { hexPubkeyToNpub } from "@/lib/stats";

import type { NextApiRequest, NextApiResponse } from "next";
import type { Event } from "nostr-tools";
import { nip19 } from "nostr-tools";

export type ProfileRepoRow = {
  entity: string;
  repo: string;
  name: string;
  ownerPubkey: string;
  lastActivity: number;
  syncedFromNostr: boolean;
  lastNostrEventId?: string;
  lastNostrEventCreatedAt?: number;
  /** false = private (gittr public-read:false on 30617). undefined/true = public. */
  publicRead?: boolean;
};

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

    await withRelayPoolSubscribe(PLATFORM_STATS_RELAYS, async (subscribe) => {
      await new Promise<void>((resolve) => {
        let eoseCount = 0;
        const expectedEose = PLATFORM_STATS_RELAYS.length;
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

          let name = repoName;
          if (event.kind === KIND_REPOSITORY_NIP34 && event.content) {
            try {
              const parsed = JSON.parse(event.content);
              if (parsed?.name) name = String(parsed.name);
            } catch {
              /* tags only */
            }
          }
          // Prefer announcement (30617) privacy over state (30618) when merging.
          const publicRead =
            event.kind === KIND_REPOSITORY_NIP34
              ? isPublicReadFromEvent(event as Event)
              : existing?.publicRead;

          if (!existing || ts >= existing.lastActivity) {
            byKey.set(key, {
              entity: hexPubkeyToNpub(event.pubkey),
              repo: repoName,
              name,
              ownerPubkey: event.pubkey.toLowerCase(),
              lastActivity: ts,
              syncedFromNostr: true,
              lastNostrEventId: event.id || undefined,
              lastNostrEventCreatedAt: event.created_at,
              publicRead:
                event.kind === KIND_REPOSITORY_NIP34
                  ? publicRead
                  : existing?.publicRead !== undefined
                    ? existing.publicRead
                    : true,
            });
          } else if (
            event.kind === KIND_REPOSITORY_NIP34 &&
            existing &&
            existing.publicRead === undefined
          ) {
            existing.publicRead = publicRead;
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
          PLATFORM_STATS_RELAYS,
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
