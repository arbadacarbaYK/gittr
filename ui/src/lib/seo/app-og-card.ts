import { nip19 } from "nostr-tools";

import {
  pickProfileDisplayName,
  trimmedKind0String,
} from "../nostr/kind0-profile-fields";
import {
  normalizeSoftwareIconUrl,
  platformHintToLabel,
} from "../nostr/nip82-software";

import { softwareAppPath } from "./software-app-path";

/**
 * Bump when the app share-card drawing changes.
 * `opengraph-image.tsx` / `twitter-image.tsx` repeat this token in a comment
 * so Next’s file hash moves, and the page `?v=` uses this constant.
 */
export const GITTR_APP_OG_CARD_REV = "app1";

export type AppOgCatalogSlice = {
  appId?: string;
  name?: string;
  summary?: string;
  icon?: string;
  license?: string;
  topics?: string[];
  platformHints?: string[];
  pubkey?: string;
  repository?: string;
  createdAt?: number;
};

export type AppOgGithubRepo = { owner: string; repo: string };

/** Facts painted on the share card. Network fields are filled in later. */
export type AppOgCardModel = {
  name: string;
  appId: string;
  description: string | null;
  license: string | null;
  tags: string[];
  iconUrl: string | null;
  pubkey: string | null;
  github: AppOgGithubRepo | null;
  /** False when the title is already the package id. */
  showAppId: boolean;
  createdAt: number;
};

const NAME_MAX = 80;
const DESC_MAX = 180;
const AUTHOR_MAX = 72;
const APP_ID_MAX = 56;
const PILL_MAX = 28;
const TAG_LIMIT = 6;

export function appOgImagePath(appId: string): string {
  const id = (appId || "").trim();
  if (!id || id.toLowerCase() === "mine") return "/apps/opengraph-image";
  return `${softwareAppPath(id)}/opengraph-image?v=${GITTR_APP_OG_CARD_REV}`;
}

export function formatAppOgCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return String(Math.floor(n));
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}

function plainOgText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function clipOgLine(value: string, max: number): string {
  const text = plainOgText(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function shortNpub(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, 12)}…`;
  } catch {
    return `${pubkey.slice(0, 8)}…`;
  }
}

export function appOgAuthorLabel(
  meta: {
    name?: unknown;
    display_name?: unknown;
    displayName?: unknown;
    nip05?: unknown;
    [key: string]: unknown;
  } | null,
  pubkey: string | null
): string {
  const name = pickProfileDisplayName(meta);
  const nip05 = trimmedKind0String(meta?.nip05);
  const combined = name && nip05 ? `${name} · ${nip05}` : name || nip05;
  if (combined) return clipOgLine(combined, AUTHOR_MAX);
  if (pubkey && /^[0-9a-f]{64}$/i.test(pubkey)) return shortNpub(pubkey);
  return "Nostr app";
}

/** github.com owner/repo from an app `repository` tag. Other forges stay unset. */
export function parseAppGithubRepo(
  url: string | undefined
): AppOgGithubRepo | null {
  const trimmed = (url || "").trim();
  if (!trimmed) return null;
  let normalized = trimmed;
  if (trimmed.startsWith("git@github.com:")) {
    normalized = `https://github.com/${trimmed.slice(
      "git@github.com:".length
    )}`;
  }
  try {
    const u = new URL(normalized);
    if (!/(^|\.)github\.com$/i.test(u.hostname)) return null;
    const parts = u.pathname
      .replace(/^\//, "")
      .replace(/\.git$/, "")
      .split("/");
    if (parts.length < 2) return null;
    const owner = parts[0] || "";
    const repo = parts[1] || "";
    if (!/^[a-zA-Z0-9._-]+$/.test(owner) || !/^[a-zA-Z0-9._-]+$/.test(repo)) {
      return null;
    }
    return { owner, repo };
  } catch {
    return null;
  }
}

function httpsIconUrl(raw: string | undefined): string | null {
  const normalized = normalizeSoftwareIconUrl(raw);
  if (!normalized || !normalized.startsWith("https://")) return null;
  if (/\.svg(\?|$)/i.test(normalized)) return null;
  return normalized;
}

function pushPill(out: string[], seen: Set<string>, raw: string | undefined) {
  const text = clipOgLine(raw || "", PILL_MAX);
  if (!text) return;
  const key = text.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push(text);
}

export function shapeAppOgCard(
  app: AppOgCatalogSlice | null,
  requestedId: string
): AppOgCardModel {
  const requested = plainOgText(requestedId || "");
  const appId = plainOgText(app?.appId || requested);
  const name = clipOgLine(app?.name || appId || "App", NAME_MAX);
  const summary = plainOgText(app?.summary || "");
  const seen = new Set<string>();
  const licenseRaw = plainOgText(app?.license || "");
  const license = licenseRaw ? clipOgLine(licenseRaw, PILL_MAX) : null;
  if (license) seen.add(license.toLowerCase());
  const tags: string[] = [];
  for (const topic of app?.topics || []) {
    if (tags.length >= TAG_LIMIT) break;
    pushPill(tags, seen, topic);
  }
  for (const hint of app?.platformHints || []) {
    if (tags.length >= TAG_LIMIT) break;
    pushPill(tags, seen, platformHintToLabel(hint));
  }
  const pubkey = (app?.pubkey || "").trim().toLowerCase();
  return {
    name: name || "App",
    appId: clipOgLine(appId || requested || "app", APP_ID_MAX),
    description: summary ? clipOgLine(summary, DESC_MAX) : null,
    license,
    tags,
    iconUrl: httpsIconUrl(app?.icon),
    pubkey: /^[0-9a-f]{64}$/.test(pubkey) ? pubkey : null,
    github: parseAppGithubRepo(app?.repository),
    showAppId: Boolean(appId) && appId.toLowerCase() !== name.toLowerCase(),
    createdAt: app?.createdAt || 0,
  };
}

/** Newest listing wins when the snapshot has more than one event per package id. */
export function indexNewestApps(
  apps: AppOgCatalogSlice[]
): Map<string, AppOgCardModel> {
  const byId = new Map<string, AppOgCardModel>();
  for (const app of apps) {
    const appId = plainOgText(app.appId || "");
    const key = appId.toLowerCase();
    if (!key || key === "mine") continue;
    const prev = byId.get(key);
    const createdAt = app.createdAt || 0;
    if (prev && prev.createdAt >= createdAt) continue;
    byId.set(key, shapeAppOgCard(app, appId));
  }
  return byId;
}
