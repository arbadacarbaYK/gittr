/**
 * Facts for a per-app share card.
 * The catalog snapshot is local; author, icon, and GitHub stars are best-effort
 * inside a short budget so X/Telegram do not drop the picture.
 */
import { fetchUserMetadata } from "@/lib/nostr/fetch-metadata-server";
import {
  SOFTWARE_CATALOG_SNAPSHOT_PATH,
  loadSoftwareCatalogSnapshot,
} from "@/lib/nostr/software-catalog-snapshot";
import {
  type AppOgCardModel,
  type AppOgCatalogSlice,
  appOgAuthorLabel,
  indexNewestApps,
  shapeAppOgCard,
} from "@/lib/seo/app-og-card";

import { stat } from "node:fs/promises";
import sharp from "sharp";

export type AppOgData = AppOgCardModel & {
  authorLabel: string;
  iconDataUrl: string | null;
  sourceStars: number | null;
  sourceForks: number | null;
};

const HARD_MS = 2200;

let catalogCache: { key: string; byId: Map<string, AppOgCardModel> } | null =
  null;
let catalogPending: {
  key: string;
  task: Promise<Map<string, AppOgCardModel>>;
} | null = null;

function decodeAppId(raw: string): string {
  const trimmed = (raw || "").trim();
  try {
    return decodeURIComponent(trimmed).trim();
  } catch {
    return trimmed;
  }
}

async function catalogIndex(): Promise<Map<string, AppOgCardModel>> {
  const st = await stat(SOFTWARE_CATALOG_SNAPSHOT_PATH).catch(() => null);
  if (!st) return new Map();
  const key = `${st.mtimeMs}:${st.size}`;
  if (catalogCache?.key === key) return catalogCache.byId;
  if (catalogPending?.key === key) return catalogPending.task;
  const task = (async () => {
    const snap = await loadSoftwareCatalogSnapshot();
    const byId = indexNewestApps((snap?.apps || []) as AppOgCatalogSlice[]);
    catalogCache = { key, byId };
    return byId;
  })();
  catalogPending = { key, task };
  try {
    return await task;
  } finally {
    if (catalogPending?.task === task) catalogPending = null;
  }
}

async function authorLabelFor(
  pubkey: string,
  timeoutMs: number
): Promise<string> {
  try {
    const meta = await Promise.race([
      fetchUserMetadata(pubkey),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), timeoutMs)
      ),
    ]);
    return appOgAuthorLabel(meta, pubkey);
  } catch {
    return appOgAuthorLabel(null, pubkey);
  }
}

async function httpsIconToDataUrl(
  url: string,
  timeoutMs: number
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

async function fetchGithubCounts(
  owner: string,
  repo: string,
  timeoutMs: number
): Promise<{ stars: number | null; forks: number | null }> {
  const empty = { stars: null as number | null, forks: null as number | null };
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
      `https://api.github.com/repos/${encodeURIComponent(
        owner
      )}/${encodeURIComponent(repo)}`,
      { headers, signal: ctrl.signal }
    );
    if (!res.ok) return empty;
    const data = (await res.json()) as {
      stargazers_count?: unknown;
      forks_count?: unknown;
    };
    return {
      stars:
        typeof data.stargazers_count === "number"
          ? data.stargazers_count
          : null,
      forks: typeof data.forks_count === "number" ? data.forks_count : null,
    };
  } catch {
    return empty;
  } finally {
    clearTimeout(timer);
  }
}

function positiveCount(n: number | null): number | null {
  return typeof n === "number" && n > 0 ? n : null;
}

export async function fetchAppOgData(rawId: string): Promise<AppOgData> {
  const appId = decodeAppId(rawId);
  const started = Date.now();
  const remaining = () => Math.max(80, HARD_MS - (Date.now() - started));
  try {
    const index = await catalogIndex();
    const shaped =
      index.get(appId.toLowerCase()) || shapeAppOgCard(null, appId);

    const authorPromise = shaped.pubkey
      ? authorLabelFor(shaped.pubkey, Math.min(700, remaining()))
      : Promise.resolve(appOgAuthorLabel(null, null));
    const iconPromise = shaped.iconUrl
      ? httpsIconToDataUrl(shaped.iconUrl, Math.min(1400, remaining()))
      : Promise.resolve(null);
    const githubPromise = shaped.github
      ? fetchGithubCounts(
          shaped.github.owner,
          shaped.github.repo,
          Math.min(700, remaining())
        )
      : Promise.resolve({ stars: null, forks: null });

    const [authorLabel, iconDataUrl, github] = await Promise.all([
      authorPromise,
      iconPromise,
      githubPromise,
    ]);

    return {
      ...shaped,
      authorLabel,
      iconDataUrl,
      sourceStars: positiveCount(github.stars),
      sourceForks: positiveCount(github.forks),
    };
  } catch {
    const shaped = shapeAppOgCard(null, appId);
    return {
      ...shaped,
      authorLabel: "Nostr app",
      iconDataUrl: null,
      sourceStars: null,
      sourceForks: null,
    };
  }
}
