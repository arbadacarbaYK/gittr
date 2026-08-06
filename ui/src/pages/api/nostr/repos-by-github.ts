/**
 * Exact reverse lookup: forge URL(s) → Nostr kind 30617 announces (+ npub for DMs).
 * GET /api/nostr/repos-by-github?source=https://gitlab.com/…&github=owner/repo
 * Also accepts POST JSON: { source|sources|github|…: string | string[], limit?: number }
 *
 * GitHub was the first case — same endpoint covers GitLab, Codeberg, Gitea, etc.
 * Exact host/path only; no fuzzy slug match.
 */
import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import { KIND_REPOSITORY_NIP34 } from "@/lib/nostr/events";
import { isPublicReadFromEvent } from "@/lib/nostr/repo-public-read";
import {
  PLATFORM_STATS_RELAYS,
  withRelayPoolSubscribe,
} from "@/lib/nostr/server-relay-subscribe";
import {
  forgeKeysFrom30617Tags,
  matchedViaTags,
  normalizeForgeSourceKey,
} from "@/lib/repos/github-source-match";
import { nip34TagValuesFromRow } from "@/lib/utils/nip34-tag-values";

import type { NextApiRequest, NextApiResponse } from "next";
import { nip19 } from "nostr-tools";

type NostrEventLike = {
  id: string;
  kind: number;
  pubkey: string;
  created_at: number;
  tags?: string[][];
  content?: string;
};

type MatchRow = {
  npub: string;
  pubkey: string;
  repoId: string;
  name: string;
  /** Upstream forge URL from the announce */
  sourceUrl: string | null;
  source: string | null;
  forkedFrom: string | null;
  cloneUrls: string[];
  /** gittr page for this repo */
  gittrRepoUrl: string;
  /** Owner profile on gittr (other repos / DM) */
  gittrProfileUrl: string;
  /** @deprecated alias of gittrRepoUrl */
  gittrUrl: string;
  eventId: string;
  created_at: number;
  matchedKey: string;
  matchedVia: string[];
};

type QueryResult = {
  input: string;
  key: string | null;
  ok: boolean;
  found?: boolean;
  error?: string;
  matches: MatchRow[];
};

function tagSingle(tags: string[][] | undefined, name: string): string | null {
  const row = tags?.find((t) => Array.isArray(t) && t[0] === name);
  const v = row?.[1];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function collectForgeInputs(req: NextApiRequest): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v.trim()) out.push(v.trim());
    else if (Array.isArray(v)) {
      for (const x of v)
        if (typeof x === "string" && x.trim()) out.push(x.trim());
    }
  };

  push(req.query.source);
  push(req.query.sources);
  push(req.query.github);
  push(req.query.githubs);
  push(req.query.url);
  push(req.query.urls);

  if (req.method === "POST" && req.body && typeof req.body === "object") {
    const body = req.body as Record<string, unknown>;
    push(body.source);
    push(body.sources);
    push(body.github);
    push(body.githubs);
    push(body.url);
    push(body.urls);
  }

  return [...new Set(out)];
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  setCorsHeaders(res, req);
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res, req);
    return;
  }
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const rawInputs = collectForgeInputs(req);
  if (rawInputs.length === 0) {
    return res.status(400).json({
      error:
        "Provide source/sources (or github/url): forge URL or owner/repo. Exact match only.",
    });
  }

  const limitRaw =
    (typeof req.query.limit === "string" && req.query.limit) ||
    (req.body &&
      typeof req.body === "object" &&
      typeof (req.body as { limit?: unknown }).limit === "number" &&
      String((req.body as { limit: number }).limit)) ||
    "2500";
  const limit = Math.min(Math.max(parseInt(limitRaw, 10) || 2500, 50), 5000);

  const wants = rawInputs.map((input) => {
    const key = normalizeForgeSourceKey(input);
    if (!key) {
      return {
        input,
        key: null as string | null,
        error:
          "not a forge repo URL (need host/owner/repo; GRASP/gittr clones skipped)",
      };
    }
    return { input, key, error: undefined as string | undefined };
  });
  const wantKeys = new Set(
    wants.map((w) => w.key).filter((k): k is string => Boolean(k))
  );

  const latestByCoord = new Map<string, NostrEventLike>();
  let scannedEvents = 0;

  try {
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

        const timer = setTimeout(finish, 12_000);

        const unsub = subscribe(
          [{ kinds: [KIND_REPOSITORY_NIP34], limit }],
          PLATFORM_STATS_RELAYS,
          (event) => {
            scannedEvents += 1;
            const e = event as NostrEventLike;
            if (!e || e.kind !== KIND_REPOSITORY_NIP34) return;
            const d = tagSingle(e.tags, "d");
            if (!d) return;
            const coord = `${e.pubkey}:${d}`;
            const prev = latestByCoord.get(coord);
            if (!prev || (e.created_at || 0) > (prev.created_at || 0)) {
              latestByCoord.set(coord, e);
            }
          },
          undefined,
          () => {
            eoseCount += 1;
            if (eoseCount >= expectedEose) {
              clearTimeout(timer);
              finish();
            }
          }
        );
      });
    });
  } catch (err) {
    console.error("[repos-by-github]", err);
    return res.status(502).json({ error: "Failed to query relays" });
  }

  const matchesByKey = new Map<string, MatchRow[]>();
  for (const key of wantKeys) matchesByKey.set(key, []);

  for (const event of latestByCoord.values()) {
    if (
      !isPublicReadFromEvent(
        event as Parameters<typeof isPublicReadFromEvent>[0]
      )
    ) {
      continue;
    }
    const keys = forgeKeysFrom30617Tags(event.tags || []);
    const hitKeys = [...keys].filter((k) => wantKeys.has(k));
    if (hitKeys.length === 0) continue;

    const repoId = tagSingle(event.tags, "d") || "";
    const name = tagSingle(event.tags, "name") || repoId;
    let npub = event.pubkey;
    try {
      npub = nip19.npubEncode(event.pubkey);
    } catch {
      /* keep hex */
    }

    const cloneUrls = nip34TagValuesFromRow(
      event.tags?.find((t) => t[0] === "clone")
    );

    const sourceUrl =
      tagSingle(event.tags, "source") ||
      tagSingle(event.tags, "forkedFrom");
    const gittrRepoUrl = `https://gittr.space/${npub}/${repoId}`;
    const gittrProfileUrl = `https://gittr.space/${npub}`;

    const base = {
      npub,
      pubkey: event.pubkey,
      repoId,
      name,
      sourceUrl,
      source: sourceUrl,
      forkedFrom: tagSingle(event.tags, "forkedFrom"),
      cloneUrls,
      gittrRepoUrl,
      gittrProfileUrl,
      gittrUrl: gittrRepoUrl,
      eventId: event.id,
      created_at: event.created_at,
    };

    for (const key of hitKeys) {
      matchesByKey.get(key)!.push({
        ...base,
        matchedKey: key,
        matchedVia: matchedViaTags(event.tags || [], key),
      });
    }
  }

  const results: QueryResult[] = wants.map((w) => {
    if (!w.key) {
      return {
        input: w.input,
        key: null,
        ok: false,
        error: w.error,
        matches: [],
      };
    }
    const matches = matchesByKey.get(w.key) || [];
    return {
      input: w.input,
      key: w.key,
      ok: true,
      found: matches.length > 0,
      matches,
    };
  });

  return res.status(200).json({
    matchMode: "exact-forge-source-url",
    note:
      "Matches kind 30617 source/forkedFrom (and non-GRASP forge URLs on clone/web/link). " +
      "GitHub, GitLab, Codeberg, Gitea, … — exact host/path. Returns npub for Nostr DMs when the forge is unreachable. " +
      "Does not fuzzy-match repo names/slugs.",
    relays: PLATFORM_STATS_RELAYS,
    scannedEvents,
    uniqueAnnouncements: latestByCoord.size,
    results,
  });
}
