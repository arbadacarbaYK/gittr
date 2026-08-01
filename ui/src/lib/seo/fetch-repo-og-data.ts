/**
 * Server-side data for composed repo Open Graph cards.
 * Keeps timeouts tight so social crawlers don't hang.
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

import { nip19 } from "nostr-tools";
import sharp from "sharp";

const OG_RELAYS = [
  "wss://relay.gittr.space",
  "wss://relay.damus.io",
  "wss://relay.noderunners.network",
  "wss://nos.lol",
  "wss://relay.ngit.dev",
  "wss://gitnostr.com",
];

export type RepoOgData = {
  repoName: string;
  ownerLabel: string;
  description: string | null;
  logoDataUrl: string | null;
  sourceStars: number | null;
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

function githubFromTags(tags: string[][]): { owner: string; repo: string } | null {
  for (const tag of tags) {
    if (tag[0] !== "clone" && tag[0] !== "source" && tag[0] !== "web") continue;
    for (let i = 1; i < tag.length; i++) {
      const v = tag[i];
      if (typeof v !== "string") continue;
      const parsed = parseGithubOwnerRepo(v);
      if (parsed) return parsed;
    }
  }
  return null;
}

type AnnouncementBits = {
  description: string | null;
  eventId: string | null;
  github: { owner: string; repo: string } | null;
  imageUrl: string | null;
};

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
  };
  try {
    const { RelayPool } = await import("nostr-relaypool");
    const pool = new RelayPool(OG_RELAYS);
    return await new Promise<AnnouncementBits>((resolve) => {
      let settled = false;
      const finish = (value: AnnouncementBits) => {
        if (settled) return;
        settled = true;
        try {
          pool.close();
        } catch {
          /* ignore */
        }
        resolve(value);
      };
      const timer = setTimeout(() => finish(empty), timeoutMs);
      try {
        pool.subscribe(
          [
            {
              kinds: [KIND_REPOSITORY, KIND_REPOSITORY_NIP34],
              authors: [ownerPubkey],
              "#d": [repoName],
              limit: 1,
            },
          ],
          OG_RELAYS,
          (event: {
            id?: string;
            content?: string;
            tags?: string[][];
            pubkey?: string;
            kind?: number;
            created_at?: number;
          }) => {
            clearTimeout(timer);
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
            const descTag = event.tags?.find((t) => t[0] === "description");
            if (
              !description &&
              typeof descTag?.[1] === "string" &&
              descTag[1].trim()
            ) {
              description = descTag[1];
            }
            const tags = event.tags || [];
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
                for (let i = 1; i < tag.length; i++) {
                  const v = tag[i];
                  if (
                    typeof v === "string" &&
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
            finish({
              description,
              eventId: typeof event.id === "string" ? event.id : null,
              github: githubFromTags(tags),
              imageUrl,
            });
          },
          undefined,
          () => {
            clearTimeout(timer);
            finish(empty);
          }
        );
      } catch {
        clearTimeout(timer);
        finish(empty);
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
      const finish = () => {
        if (settled) return;
        settled = true;
        try {
          pool.close();
        } catch {
          /* ignore */
        }
        const { count } = aggregateRepoStarReactions(events as any);
        resolve(count);
      };
      const timer = setTimeout(finish, timeoutMs);
      try {
        pool.subscribe(
          [
            {
              kinds: [KIND_REACTION],
              "#e": [eventId],
              limit: 200,
            },
          ],
          OG_RELAYS,
          (event: any) => {
            events.push(event);
          },
          undefined,
          () => {
            clearTimeout(timer);
            finish();
          }
        );
      } catch {
        clearTimeout(timer);
        finish();
      }
    });
  } catch {
    return null;
  }
}

async function fetchGithubStars(
  owner: string,
  repo: string,
  timeoutMs: number
): Promise<number | null> {
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
    if (!res.ok) return null;
    const data = (await res.json()) as { stargazers_count?: unknown };
    return typeof data.stargazers_count === "number"
      ? data.stargazers_count
      : null;
  } catch {
    return null;
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
    // Allow modest icons; skip tiny junk.
    if (w > 0 && h > 0 && (w < 32 || h < 32)) return null;
    const png = await sharp(buf)
      .resize(160, 160, {
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
  // 1) Bridge bare-repo logo.png (etc.)
  try {
    const onDisk = await readRepoLogoFromBridge(ownerPubkey, repoName);
    if (onDisk && !onDisk.contentType.includes("svg")) {
      const meta = await sharp(onDisk.buffer).metadata();
      const w = meta.width || 0;
      const h = meta.height || 0;
      if (w >= 32 && h >= 32) {
        const png = await sharp(onDisk.buffer)
          .resize(160, 160, { fit: "cover", position: "centre" })
          .png()
          .toBuffer();
        return `data:image/png;base64,${png.toString("base64")}`;
      }
    }
  } catch {
    /* continue */
  }

  // 2) Announcement `image` / image-like web (passed in or fetched)
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
  const fallback = { label: shortNpub(ownerPubkey), pictureUrl: null as string | null };
  try {
    const { fetchUserMetadata } = await import(
      "@/lib/nostr/fetch-metadata-server"
    );
    const meta = await Promise.race([
      fetchUserMetadata(ownerPubkey),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!meta) return fallback;
    let label = fallback.label;
    if (typeof meta.name === "string" && meta.name.trim()) label = meta.name.trim();
    else if (typeof meta.display_name === "string" && meta.display_name.trim()) {
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
      nostrStars: null,
    };
  }

  const announcement = await fetchAnnouncementBits(ownerPubkey, repoName, 1200);
  const owner = await fetchOwnerProfile(ownerPubkey, 1000);

  const [logoDataUrl, sourceStars, nostrStars] = await Promise.all([
    logoToDataUrl(
      ownerPubkey,
      repoName,
      announcement.imageUrl,
      owner.pictureUrl
    ),
    announcement.github
      ? fetchGithubStars(
          announcement.github.owner,
          announcement.github.repo,
          1500
        )
      : Promise.resolve(null),
    announcement.eventId
      ? fetchNostrStarCount(announcement.eventId, 1400)
      : Promise.resolve(null),
  ]);

  let description = announcement.description;
  if (description && description.length > 140) {
    description = `${description.slice(0, 137)}…`;
  }

  return {
    repoName,
    ownerLabel: owner.label,
    description,
    logoDataUrl,
    // Omit zeros — empty meta beats a row of ★ 0 · N 0
    sourceStars:
      typeof sourceStars === "number" && sourceStars > 0 ? sourceStars : null,
    nostrStars:
      typeof nostrStars === "number" && nostrStars > 0 ? nostrStars : null,
  };
}
