/**
 * NIP-82 (draft): software catalog — kinds 32267 (app), 30063 (release), 3063 (asset).
 * Used to list Zapstore-compatible apps from relays (e.g. wss://relay.zapstore.dev).
 */

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
  return {
    pubkey: event.pubkey,
    appId,
    name,
    summary: readTag(event, "summary"),
    icon: readTag(event, "icon"),
    repository: readTag(event, "repository"),
    webUrl: readTag(event, "url"),
    topics: readTagAll(event, "t")
      .map((x) => x.trim())
      .filter(Boolean),
    platformHints: readTagAll(event, "f")
      .map((x) => x.trim())
      .filter(Boolean),
    license: readTag(event, "license"),
    attributedPubkeys,
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
    url: readTag(event, "url"),
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
