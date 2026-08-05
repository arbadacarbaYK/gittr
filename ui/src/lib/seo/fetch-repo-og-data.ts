/**
 * Server-side data for composed repo Open Graph cards.
 *
 * X/Twitterbot often abandons og:image fetches after ~3–5s. Prefer a fast
 * partial card over waiting full relay windows (old path was a fixed ~6s).
 */
import {
  KIND_REACTION,
  KIND_REPOSITORY,
  KIND_REPOSITORY_NIP34,
} from "@/lib/nostr/events";
import { aggregateRepoStarReactions } from "@/lib/nostr/repo-stars";
import {
  fetchRepoLogoUrlFromNostr,
  readRepoLogoFromBridge,
} from "@/lib/og-repo-image";
import { nip34TagValuesFromRow } from "@/lib/utils/nip34-tag-values";

import { nip19 } from "nostr-tools";
import sharp from "sharp";

const OG_RELAYS = [
  "wss://relay.gittr.space",
  "wss://relay.ngit.dev",
  "wss://gitnostr.com",
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.noderunners.network",
  "wss://relay.nostr.band",
];

export type RepoOgData = {
  repoName: string;
  ownerLabel: string;
  description: string | null;
  logoDataUrl: string | null;
  sourceStars: number | null;
  sourceForks: number | null;
  nostrStars: number | null;
};

function resolvePubkey(entity: string): string | null {
  if (/^[0-9a-f]{64}$/i.test(entity)) return entity.toLowerCase();
  if (entity.startsWith("npub")) {
    try {
      const decoded = nip19.decode(entity);
      if (decoded.type === "npub") return (decoded.data as string).toLowerCase();
    } catch {
      /* ignore */
    }
  }
  return null;
}

function cleanRepoName(repoName: string): string {
  let name = repoName;
  try {
    if (name.includes("%")) name = decodeURIComponent(name);
  } catch {
    /* keep */
  }
  if (name.includes("/")) {
    name = name.split("/").pop() || name;
  }
  return name.replace(/\.git$/, "");
}

function shortNpub(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, 12)}…`;
  } catch {
    return `${pubkey.slice(0, 8)}…`;
  }
}

export function formatOgCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return String(Math.floor(n));
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}

function parseGithubOwnerRepo(
  url: string
): { owner: string; repo: string } | null {
  const trimmed = url.trim();
  let normalized = trimmed;
  if (trimmed.startsWith("git@github.com:")) {
    normalized = `https://github.com/${trimmed.slice("git@github.com:".length)}`;
  }
  try {
    const u = new URL(normalized);
    if (!/(^|\.)github\.com$/i.test(u.hostname)) return null;
    const parts = u.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/");
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1];
    if (!owner || !repo) return null;
    if (!/^[a-zA-Z0-9._-]+$/.test(owner) || !/^[a-zA-Z0-9._-]+$/.test(repo)) {
      return null;
    }
    return { owner, repo };
  } catch {
    return null;
  }
}

/** Scan multi-value NIP-34 tags for a github.com owner/repo. */
function githubFromTags(tags: string[][]): { owner: string; repo: string } | null {
  const prefer = ["source", "forkedFrom", "clone", "web", "link"] as const;
  for (const kind of prefer) {
    for (const tag of tags) {
      if (tag[0] !== kind) continue;
      for (const v of nip34TagValuesFromRow(tag)) {
        const parsed = parseGithubOwnerRepo(v);
        if (parsed) return parsed;
      }
    }
  }
  return null;
}

type AnnouncementBits = {
  description: string | null;
  eventId: string | null;
  github: { owner: string; repo: string } | null;
  imageUrl: string | null;
  createdAt: number;
};

function bitsFromEvent(event: {
  id?: string;
  content?: string;
  tags?: string[][];
  created_at?: number;
}): AnnouncementBits {
  let description: string | null = null;
  try {
    const content = JSON.parse(event.content || "{}") as {
      description?: unknown;
    };
    if (typeof content.description === "string") {
      description = content.description;
    }
  } catch {
    /* ignore */
  }
  const tags = event.tags || [];
  const descTag = tags.find((t) => t[0] === "description");
  if (!description && typeof descTag?.[1] === "string" && descTag[1].trim()) {
    description = descTag[1];
  }
  // NIP-34 also allows human-readable `name` but we already show repoName;
  // keep description only for About.

  let imageUrl: string | null = null;
  for (const tag of tags) {
    if (tag[0] === "image" && typeof tag[1] === "string") {
      const u = tag[1].trim();
      if (u.startsWith("https://") && !/\.svg(\?|$)/i.test(u)) {
        imageUrl = u;
        break;
      }
    }
  }
  if (!imageUrl) {
    for (const tag of tags) {
      if (tag[0] !== "web") continue;
      for (const v of nip34TagValuesFromRow(tag)) {
        if (
          v.startsWith("https://") &&
          /\.(png|jpe?g|webp|gif)(\?|$)/i.test(v)
        ) {
          imageUrl = v;
          break;
        }
      }
      if (imageUrl) break;
    }
  }

  return {
    description: description?.trim() || null,
    eventId: typeof event.id === "string" ? event.id : null,
    github: githubFromTags(tags),
    imageUrl,
    createdAt: typeof event.created_at === "number" ? event.created_at : 0,
  };
}

async function fetchAnnouncementBits(
  ownerPubkey: string,
  repoName: string,
  timeoutMs: number
): Promise<AnnouncementBits> {
  const empty: AnnouncementBits = {
    description: null,
    eventId: null,
    github: null,
    imageUrl: null,
    createdAt: 0,
  };
  try {
    const { RelayPool } = await import("nostr-relaypool");
    const pool = new RelayPool(OG_RELAYS);
    return await new Promise<AnnouncementBits>((resolve) => {
      let settled = false;
      let best: AnnouncementBits | null = null;
      let settleTimer: ReturnType<typeof setTimeout> | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (value: AnnouncementBits) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (settleTimer) clearTimeout(settleTimer);
        try {
          pool.close();
        } catch {
          /* ignore */
        }
        resolve(value);
      };
      timer = setTimeout(() => finish(best || empty), timeoutMs);
      try {
        pool.subscribe(
          [
            {
              kinds: [KIND_REPOSITORY, KIND_REPOSITORY_NIP34],
              authors: [ownerPubkey],
              "#d": [repoName],
              limit: 5,
            },
          ],
          OG_RELAYS,
          (event: {
            id?: string;
            content?: string;
            tags?: string[][];
            created_at?: number;
          }) => {
            const bits = bitsFromEvent(event);
            if (!best || bits.createdAt >= best.createdAt) {
              best = bits;
            }
            // First useful hit: short grace for a newer replaceable event, then go.
            if (best?.eventId && !settleTimer) {
              settleTimer = setTimeout(() => finish(best || empty), 280);
            }
          }
        );
      } catch {
        finish(best || empty);
      }
    });
  } catch {
    return empty;
  }
}

async function fetchNostrStarCount(
  eventId: string,
  timeoutMs: number
): Promise<number | null> {
  if (!/^[0-9a-f]{64}$/i.test(eventId)) return null;
  try {
    const { RelayPool } = await import("nostr-relaypool");
    const pool = new RelayPool(OG_RELAYS);
    const events: any[] = [];
    return await new Promise<number | null>((resolve) => {
      let settled = false;
      let earlyTimer: ReturnType<typeof setTimeout> | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (earlyTimer) clearTimeout(earlyTimer);
        try {
          pool.close();
        } catch {
          /* ignore */
        }
        const { count } = aggregateRepoStarReactions(events as any);
        resolve(count);
      };
      timer = setTimeout(finish, timeoutMs);
      try {
        pool.subscribe(
          [
            {
              kinds: [KIND_REACTION],
              "#e": [eventId],
              limit: 500,
            },
          ],
          OG_RELAYS,
          (event: any) => {
            events.push(event);
            // Stars are decorative on the card — don't wait out the full window.
            if (events.length >= 3 && !earlyTimer) {
              earlyTimer = setTimeout(finish, 120);
            }
          }
        );
      } catch {
        finish();
      }
    });
  } catch {
    return null;
  }
}

type GithubMeta = {
  stars: number | null;
  forks: number | null;
  description: string | null;
};

async function fetchGithubMeta(
  owner: string,
  repo: string,
  timeoutMs: number
): Promise<GithubMeta> {
  const empty: GithubMeta = { stars: null, forks: null, description: null };
  const token = process.env.GITHUB_PLATFORM_TOKEN || "";
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "gittr-space-og",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      { headers, signal: ctrl.signal }
    );
    if (!res.ok) return empty;
    const data = (await res.json()) as {
      stargazers_count?: unknown;
      forks_count?: unknown;
      description?: unknown;
    };
    return {
      stars:
        typeof data.stargazers_count === "number" ? data.stargazers_count : null,
      forks: typeof data.forks_count === "number" ? data.forks_count : null,
      description:
        typeof data.description === "string" && data.description.trim()
          ? data.description.trim()
          : null,
    };
  } catch {
    return empty;
  } finally {
    clearTimeout(timer);
  }
}

async function httpsImageToDataUrl(
  url: string,
  timeoutMs = 1200
): Promise<string | null> {
  if (!url.startsWith("https://") || /\.svg(\?|$)/i.test(url)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "gittr-space-og" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ctype = res.headers.get("content-type") || "";
    if (ctype.includes("svg")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 80 || buf.length > 2_500_000) return null;
    const meta = await sharp(buf).metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;
    if (w > 0 && h > 0 && (w < 32 || h < 32)) return null;
    const png = await sharp(buf)
      .resize(220, 220, {
        fit: "cover",
        position: "centre",
        background: { r: 20, g: 24, b: 34, alpha: 1 },
      })
      .png()
      .toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function logoToDataUrl(
  ownerPubkey: string,
  repoName: string,
  announcementImageUrl: string | null,
  ownerPictureUrl: string | null
): Promise<string | null> {
  try {
    const onDisk = await readRepoLogoFromBridge(ownerPubkey, repoName);
    if (onDisk && !onDisk.contentType.includes("svg")) {
      const meta = await sharp(onDisk.buffer).metadata();
      const w = meta.width || 0;
      const h = meta.height || 0;
      if (w >= 32 && h >= 32) {
        const png = await sharp(onDisk.buffer)
          .resize(220, 220, { fit: "cover", position: "centre" })
          .png()
          .toBuffer();
        return `data:image/png;base64,${png.toString("base64")}`;
      }
    }
  } catch {
    /* continue */
  }

  const remoteCandidates = [
    announcementImageUrl,
    await fetchRepoLogoUrlFromNostr(ownerPubkey, repoName, 900).catch(
      () => null
    ),
    ownerPictureUrl,
  ];
  for (const candidate of remoteCandidates) {
    if (!candidate) continue;
    const dataUrl = await httpsImageToDataUrl(candidate);
    if (dataUrl) return dataUrl;
  }

  return null;
}

async function fetchOwnerProfile(
  ownerPubkey: string,
  timeoutMs: number
): Promise<{ label: string; pictureUrl: string | null }> {
  const fallback = {
    label: shortNpub(ownerPubkey),
    pictureUrl: null as string | null,
  };
  try {
    const { RelayPool } = await import("nostr-relaypool");
    const profileRelays = [
      "wss://purplepag.es",
      "wss://user.kindpag.es",
      "wss://relay.gittr.space",
      "wss://relay.damus.io",
      "wss://nos.lol",
    ];
    const pool = new RelayPool(profileRelays);
    const meta = await new Promise<{
      name?: string;
      display_name?: string;
      picture?: string;
    } | null>((resolve) => {
      let settled = false;
      const finish = (
        value: { name?: string; display_name?: string; picture?: string } | null
      ) => {
        if (settled) return;
        settled = true;
        try {
          pool.close();
        } catch {
          /* ignore */
        }
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      try {
        pool.subscribe(
          [{ kinds: [0], authors: [ownerPubkey], limit: 1 }],
          profileRelays,
          (event: { content?: string }) => {
            clearTimeout(timer);
            try {
              finish(JSON.parse(event.content || "{}"));
            } catch {
              finish(null);
            }
          }
        );
      } catch {
        clearTimeout(timer);
        finish(null);
      }
    });
    if (!meta) return fallback;
    let label = fallback.label;
    if (typeof meta.name === "string" && meta.name.trim()) {
      label = meta.name.trim();
    } else if (
      typeof meta.display_name === "string" &&
      meta.display_name.trim()
    ) {
      label = meta.display_name.trim();
    }
    const pictureUrl =
      typeof meta.picture === "string" && meta.picture.startsWith("https://")
        ? meta.picture.trim()
        : null;
    return { label, pictureUrl };
  } catch {
    return fallback;
  }
}

/**
 * Gather everything needed to paint a repo OG card. Soft-fails per field.
 */
export async function fetchRepoOgData(
  entity: string,
  repo: string,
  _baseUrl?: string
): Promise<RepoOgData> {
  const repoName = cleanRepoName(repo);
  const ownerPubkey = resolvePubkey(entity);

  if (!ownerPubkey) {
    return {
      repoName,
      ownerLabel: entity,
      description: null,
      logoDataUrl: null,
      sourceStars: null,
      sourceForks: null,
      nostrStars: null,
    };
  }

  // Hard budget for social crawlers (X often drops images after ~3–5s total).
  const HARD_MS = 2200;
  const started = Date.now();
  const remaining = () => Math.max(120, HARD_MS - (Date.now() - started));

  const [announcement, owner] = await Promise.all([
    fetchAnnouncementBits(ownerPubkey, repoName, Math.min(1100, remaining())),
    fetchOwnerProfile(ownerPubkey, Math.min(900, remaining())),
  ]);

  if (remaining() < 200) {
    let description = announcement.description;
    if (description && description.length > 140) {
      description = `${description.slice(0, 137)}…`;
    }
    return {
      repoName,
      ownerLabel: owner.label,
      description,
      logoDataUrl: null,
      sourceStars: null,
      sourceForks: null,
      nostrStars: null,
    };
  }

  const phase2Budget = remaining();
  const [logoDataUrl, githubMeta, nostrStars] = await Promise.all([
    Promise.race([
      logoToDataUrl(
        ownerPubkey,
        repoName,
        announcement.imageUrl,
        owner.pictureUrl
      ),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), phase2Budget)
      ),
    ]),
    announcement.github
      ? fetchGithubMeta(
          announcement.github.owner,
          announcement.github.repo,
          Math.min(800, phase2Budget)
        )
      : Promise.resolve({
          stars: null,
          forks: null,
          description: null,
        } as GithubMeta),
    announcement.eventId
      ? fetchNostrStarCount(
          announcement.eventId,
          Math.min(700, phase2Budget)
        )
      : Promise.resolve(null),
  ]);

  let description = announcement.description || githubMeta.description;
  if (description && description.length > 140) {
    description = `${description.slice(0, 137)}…`;
  }

  return {
    repoName,
    ownerLabel: owner.label,
    description,
    logoDataUrl,
    sourceStars:
      typeof githubMeta.stars === "number" && githubMeta.stars > 0
        ? githubMeta.stars
        : null,
    sourceForks:
      typeof githubMeta.forks === "number" && githubMeta.forks > 0
        ? githubMeta.forks
        : null,
    nostrStars:
      typeof nostrStars === "number" && nostrStars > 0 ? nostrStars : null,
  };
}
