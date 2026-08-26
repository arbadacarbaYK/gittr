import { isPublisherBlocklisted } from "@/lib/moderation/publisher-blocklist";
import {
  KIND_REPOSITORY_NIP34,
  KIND_REPOSITORY_STATE,
} from "@/lib/nostr/events";
import {
  type ProfileRepoAccumulator,
  type ProfileRepoRow,
  applyProfileRepoEvent,
  profileRepoRowsFromAccumulator,
} from "@/lib/nostr/profile-repos-merge";
import {
  PROFILE_REPOS_RELAYS,
  withRelayPoolSubscribe,
} from "@/lib/nostr/server-relay-subscribe";

import type { NextApiRequest, NextApiResponse } from "next";
import { nip19 } from "nostr-tools";

export type { ProfileRepoRow };

/** Relays that store full 30617 history can fill a small `limit` with one busy repo. */
const PROFILE_REPOS_ANNOUNCE_LIMIT = 2000;
const PROFILE_REPOS_STATE_LIMIT = 500;
const PROFILE_REPOS_SUBSCRIBE_MS = 12_000;

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
    const byKey: ProfileRepoAccumulator = new Map();

    let finishedByTimeout = false;
    let eventCount = 0;

    await withRelayPoolSubscribe(PROFILE_REPOS_RELAYS, async (subscribe) => {
      await new Promise<void>((resolve) => {
        let eoseCount = 0;
        const expectedEose = PROFILE_REPOS_RELAYS.length;
        let done = false;

        const finish = (fromTimeout = false) => {
          if (done) return;
          done = true;
          finishedByTimeout = fromTimeout;
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
          eventCount++;
          applyProfileRepoEvent(byKey, event);
        };

        const unsub = subscribe(
          [
            {
              kinds: [KIND_REPOSITORY_NIP34],
              authors: [ownerHex],
              limit: PROFILE_REPOS_ANNOUNCE_LIMIT,
            },
            {
              kinds: [KIND_REPOSITORY_STATE],
              authors: [ownerHex],
              limit: PROFILE_REPOS_STATE_LIMIT,
            },
          ],
          PROFILE_REPOS_RELAYS,
          (event) => upsert(event),
          undefined,
          () => {
            eoseCount++;
            if (eoseCount >= expectedEose) setTimeout(() => finish(false), 200);
          },
          {}
        );

        setTimeout(() => finish(true), PROFILE_REPOS_SUBSCRIBE_MS);
      });
    });

    const repos = profileRepoRowsFromAccumulator(byKey);

    if (finishedByTimeout) {
      console.warn("[profile-repos] relay scan timed out", {
        ownerHex: ownerHex.slice(0, 8),
        eventCount,
        unique: repos.length,
      });
    }

    // A truncated scan (history flood on one relay, discovery relays still
    // opening) must not be cached as "this person only has 4 repos".
    res.setHeader(
      "Cache-Control",
      finishedByTimeout
        ? "private, no-store"
        : "public, max-age=60, stale-while-revalidate=120"
    );
    return res.status(200).json({ repos });
  } catch (e) {
    console.error("[profile-repos]", e);
    return res
      .status(500)
      .json({ error: "Failed to load profile repositories" });
  }
}
