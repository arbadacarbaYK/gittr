/**
 * NIP-82 (draft): software catalog — kinds 32267 (app), 30063 (release), 3063 (asset).
 * Used to list Zapstore-compatible apps from relays (e.g. wss://relay.zapstore.dev).
 */
import { nip19 } from "nostr-tools";

export const KIND_SOFTWARE_APPLICATION = 32267;
export const KIND_SOFTWARE_RELEASE = 30063;
export const KIND_SOFTWARE_ASSET = 3063;

export const MIME_ANDROID_APK = "application/vnd.android.package-archive";
export const MIME_IOS_IPA = "application/vnd.apple.ipa";
export const MIME_MAC_DMG = "application/x-apple-diskimage";
export const MIME_LINUX_APPIMAGE = "application/vnd.appimage";
export const MIME_WINDOWS_PE = "application/vnd.microsoft.portable-executable";

export type NostrEventLike = {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  content: string;
  tags: string[][];
};

export function readTag(
  event: NostrEventLike,
  key: string
): string | undefined {
  const row = event.tags?.find((t) => t[0] === key && typeof t[1] === "string");
  return row?.[1]?.trim() || undefined;
}

export function readTagAll(event: NostrEventLike, key: string): string[] {
  return (event.tags || [])
    .filter((t) => t[0] === key && typeof t[1] === "string")
    .map((t) => t[1] as string);
}

/**
 * Events are attacker-controlled: anyone can publish kind 32267/3063 with
 * `url: javascript:…` or `icon: data:text/html…`. These values land in
 * href/src attributes, so only allow http(s) here at the parse boundary.
 */
export function safeHttpUrlTag(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
    if (u.username || u.password) return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}

/**
 * Zapstore used to publish `https://cdn.zap.store/<sha>.webp`. That host no
 * longer resolves (browser `ERR_NAME_NOT_RESOLVED`). Current icons live on
 * `cdn.zapstore.dev` without a `.webp` suffix — and old hashes usually 404
 * there too. Drop the dead host so cards show the letter/package fallback
 * instead of a broken image.
 */
export function normalizeSoftwareIconUrl(
  raw: string | undefined
): string | undefined {
  const url = safeHttpUrlTag(raw);
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "cdn.zap.store" || host === "zap.store") return undefined;
    return url;
  } catch {
    return undefined;
  }
}

/**
 * NIP-34 pointer on a gittr-announced NIP-82 app: `30617:<owner-hex>:<repo-d>`.
 * Zapstore-only listings usually omit this.
 */
export function gittrRepoPathFromNip34A(value: string): string | null {
  const m = String(value || "")
    .trim()
    .match(/^30617:([0-9a-f]{64}):(.+)$/i);
  if (!m?.[1] || !m[2]) return null;
  const repo = m[2].trim();
  if (!repo || /[\s/?#]/.test(repo)) return null;
  const hex = m[1].toLowerCase();
  try {
    return `/${nip19.npubEncode(hex)}/${repo}`;
  } catch {
    return `/${hex}/${repo}`;
  }
}

/** `https://gittr.space/{npub|hex}/{repo}` — not git/pages/blossom/relay hosts. */
export function gittrRepoPathFromRepositoryUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host !== "gittr.space" && !host.endsWith(".gittr.space")) return null;
    if (
      host.startsWith("git.") ||
      host.startsWith("blossom.") ||
      host.startsWith("relay.") ||
      host.startsWith("pages.")
    ) {
      return null;
    }
    const segs = u.pathname.split("/").filter(Boolean);
    if (segs.length < 2) return null;
    const entity = segs[0]!;
    const repo = segs[1]!;
    if (!/^npub1/i.test(entity) && !/^[0-9a-f]{64}$/i.test(entity)) {
      return null;
    }
    if (/[\s/?#]/.test(repo)) return null;
    return `/${entity}/${repo}`;
  } catch {
    return null;
  }
}

export function gittrRepoPathFromSoftwareEvent(
  event: NostrEventLike,
  repository?: string
): string | undefined {
  for (const t of event.tags || []) {
    if (t[0] === "a" && typeof t[1] === "string") {
      const path = gittrRepoPathFromNip34A(t[1]);
      if (path) return path;
    }
  }
  if (repository) {
    const path = gittrRepoPathFromRepositoryUrl(repository);
    if (path) return path;
  }
  return undefined;
}

export interface ParsedSoftwareApp {
  pubkey: string;
  appId: string;
  name: string;
  summary?: string;
  icon?: string;
  repository?: string;
  webUrl?: string;
  /** NIP-82: multiple `t` tags — publisher categories (e.g. nostr, social). */
  topics: string[];
  /** NIP-82: optional `f` platform hints on the app event. */
  platformHints: string[];
  /** NIP-82: optional SPDX license id (e.g. MIT, Apache-2.0). */
  license?: string;
  /**
   * NIP-82 attribution: other pubkeys as `p` tags (hex). Not exhaustive; publishers may omit.
   */
  attributedPubkeys: string[];
  /**
   * gittr Code-tab path (`/{npub}/{repo}`) when the event points at a NIP-34
   * repo (`a` tag) or a gittr.space repository URL. Absent for most Zapstore apps.
   */
  gittrRepoPath?: string;
  content: string;
  createdAt: number;
  raw: NostrEventLike;
}

export function parseSoftwareApp(
  event: NostrEventLike
): ParsedSoftwareApp | null {
  if (event.kind !== KIND_SOFTWARE_APPLICATION) return null;
  const appId = readTag(event, "d");
  const name = readTag(event, "name");
  if (!appId || !name || !event.pubkey) return null;
  const attributedPubkeys = readTagAll(event, "p")
    .map((x) => x.trim().toLowerCase())
    .filter((x) => /^[0-9a-f]{64}$/.test(x))
    .filter((x) => x !== event.pubkey.toLowerCase());
  const repository = safeHttpUrlTag(readTag(event, "repository"));
  return {
    pubkey: event.pubkey,
    appId,
    name,
    summary: readTag(event, "summary"),
    icon: normalizeSoftwareIconUrl(readTag(event, "icon")),
    repository,
    webUrl: safeHttpUrlTag(readTag(event, "url")),
    topics: readTagAll(event, "t")
      .map((x) => x.trim())
      .filter(Boolean),
    platformHints: readTagAll(event, "f")
      .map((x) => x.trim())
      .filter(Boolean),
    license: readTag(event, "license"),
    attributedPubkeys,
    gittrRepoPath: gittrRepoPathFromSoftwareEvent(event, repository),
    content: typeof event.content === "string" ? event.content : "",
    createdAt: event.created_at,
    raw: event,
  };
}

export interface ParsedSoftwareRelease {
  pubkey: string;
  appId: string;
  version: string;
  d: string;
  channel: string;
  assetEventIds: string[];
  content: string;
  createdAt: number;
  raw: NostrEventLike;
}

export function parseSoftwareRelease(
  event: NostrEventLike
): ParsedSoftwareRelease | null {
  if (event.kind !== KIND_SOFTWARE_RELEASE) return null;
  const appId = readTag(event, "i");
  const version = readTag(event, "version");
  const d = readTag(event, "d");
  const channel = readTag(event, "c") || "main";
  if (!appId || !version || !d || !event.pubkey) return null;
  const assetEventIds = (event.tags || [])
    .filter((t) => t[0] === "e" && typeof t[1] === "string")
    .map((t) => t[1] as string);
  return {
    pubkey: event.pubkey,
    appId,
    version,
    d,
    channel,
    assetEventIds,
    content: typeof event.content === "string" ? event.content : "",
    createdAt: event.created_at,
    raw: event,
  };
}

export interface ParsedSoftwareAsset {
  id: string;
  pubkey: string;
  appId?: string;
  url?: string;
  mime: string;
  sha256: string;
  version?: string;
  platforms: string[];
  raw: NostrEventLike;
}

export function parseSoftwareAsset(
  event: NostrEventLike
): ParsedSoftwareAsset | null {
  if (event.kind !== KIND_SOFTWARE_ASSET) return null;
  const mime = readTag(event, "m");
  const sha256 = readTag(event, "x");
  if (!mime || !sha256 || !event.id || !event.pubkey) return null;
  return {
    id: event.id,
    pubkey: event.pubkey,
    appId: readTag(event, "i"),
    url: safeHttpUrlTag(readTag(event, "url")),
    mime,
    sha256,
    version: readTag(event, "version"),
    platforms: readTagAll(event, "f"),
    raw: event,
  };
}

/** Prefer `main` channel; then newest by created_at. */
export function pickLatestMainRelease(
  releases: ParsedSoftwareRelease[]
): ParsedSoftwareRelease | undefined {
  const main = releases.filter((r) => (r.channel || "main") === "main");
  const pool = main.length > 0 ? main : releases;
  if (pool.length === 0) return undefined;
  return [...pool].sort((a, b) => b.createdAt - a.createdAt)[0];
}

/** Map NIP-82 `f` platform id to a short UI label. */
export function platformHintToLabel(hint: string): string | undefined {
  const h = hint.toLowerCase();
  if (h.startsWith("android-")) return "Android";
  if (h.startsWith("ios-")) return "iOS";
  if (h.startsWith("darwin-")) return "macOS";
  if (h.startsWith("linux-")) return "Linux";
  if (h.startsWith("windows-")) return "Windows";
  if (h.startsWith("wasm")) return "Web/WASM";
  return undefined;
}

export function mimeToKindLabel(mime: string): string | undefined {
  switch (mime) {
    case MIME_ANDROID_APK:
      return "Android";
    case MIME_IOS_IPA:
      return "iOS";
    case MIME_MAC_DMG:
    case "application/vnd.apple.installer+xml":
      return "macOS";
    case MIME_LINUX_APPIMAGE:
    case "application/vnd.flatpak":
      return "Linux";
    case MIME_WINDOWS_PE:
    case "application/x-msi":
      return "Windows";
    case "application/webbundle":
      return "PWA/Web";
    default:
      return undefined;
  }
}

export function pickAndroidApkAsset(
  assets: ParsedSoftwareAsset[]
): ParsedSoftwareAsset | undefined {
  const apks = assets.filter((a) => a.mime === MIME_ANDROID_APK);
  if (apks.length === 0) return undefined;
  const arm64 = apks.find((a) => a.platforms.includes("android-arm64-v8a"));
  if (arm64) return arm64;
  const universal = apks.find((a) => a.platforms.length === 0);
  if (universal) return universal;
  return apks[0];
}

export function appDedupKey(pubkey: string, appId: string): string {
  return `${pubkey}:${appId}`;
}

export function softwareAppBelongsToOwner(
  app: ParsedSoftwareApp,
  ownerHex: string
): boolean {
  const h = ownerHex.toLowerCase();
  if (app.pubkey.toLowerCase() === h) return true;
  return (app.attributedPubkeys || []).some((p) => p.toLowerCase() === h);
}

/**
 * One card per package id on a profile. Prefer the owner's own 32267 over a
 * Zapstore (or other) republish that only tagged them in `p`. Keep attributed
 * listings when the owner never published that app id themselves.
 */
export function preferOwnerSoftwareApps(
  apps: ParsedSoftwareApp[],
  ownerHex: string
): ParsedSoftwareApp[] {
  const h = ownerHex.toLowerCase();
  const mine = apps.filter((a) => softwareAppBelongsToOwner(a, h));
  const byId = new Map<string, ParsedSoftwareApp[]>();
  for (const a of mine) {
    const id = a.appId.trim().toLowerCase();
    const list = byId.get(id) ?? [];
    list.push(a);
    byId.set(id, list);
  }
  const out: ParsedSoftwareApp[] = [];
  for (const group of byId.values()) {
    const owned = group.filter((a) => a.pubkey.toLowerCase() === h);
    const pool = owned.length > 0 ? owned : group;
    const pick = [...pool].sort(
      (a, b) => (b.createdAt || 0) - (a.createdAt || 0)
    )[0];
    if (!pick) continue;
    if (!pick.icon) {
      const borrowed = group.find((a) => a.icon)?.icon;
      if (borrowed) {
        out.push({ ...pick, icon: borrowed });
        continue;
      }
    }
    out.push(pick);
  }
  out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return out;
}

/** Keep the newest replaceable snapshot per author + app id. */
export function dedupeSoftwareApps(
  events: NostrEventLike[]
): Map<string, ParsedSoftwareApp> {
  const map = new Map<string, ParsedSoftwareApp>();
  for (const ev of events) {
    const parsed = parseSoftwareApp(ev);
    if (!parsed) continue;
    const key = appDedupKey(parsed.pubkey, parsed.appId);
    const prev = map.get(key);
    if (!prev || parsed.createdAt > prev.createdAt) {
      map.set(key, parsed);
    }
  }
  return map;
}
