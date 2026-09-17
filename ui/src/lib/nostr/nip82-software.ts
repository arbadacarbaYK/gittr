/**
 * NIP-82 (draft): software catalog — kinds 32267 (app), 30063 (release), 3063 (asset).
 * Used to list Zapstore-compatible apps from relays (e.g. wss://relay.zapstore.dev).
 */
import { nip19 } from "nostr-tools";

import { GITTR_OWNER_NPUB, GITTR_OWNER_PUBKEY_HEX } from "../gittr-repo-links";
import { compareSemver } from "../repo/gittr-android-shell";

/** Keep in sync with `GITTR_ANDROID_APP_ID` — do not import that module (cycle). */
const OFFICIAL_GITTR_APP_ID = "space.gittr.app";
const OFFICIAL_GITTR_REPO_SLUG = "gittr";

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
 * instead of a broken image. Profile and /apps both use the Package tile
 * fallback when no live icon URL remains.
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

/** Reverse of `gittrRepoPathFromNip34A` so slim catalog events can keep Repo. */
export function nip34AddressFromGittrRepoPath(path: string): string | null {
  const m = String(path || "")
    .trim()
    .match(/^\/(npub1[a-z0-9]+|[0-9a-f]{64})\/([^/]+)$/i);
  if (!m?.[1] || !m[2]) return null;
  const repo = m[2].trim();
  if (!repo || /[\s/?#]/.test(repo)) return null;
  let hex = m[1];
  if (/^npub1/i.test(hex)) {
    try {
      const decoded = nip19.decode(hex);
      if (decoded.type !== "npub") return null;
      hex = typeof decoded.data === "string" ? decoded.data : "";
    } catch {
      return null;
    }
  }
  hex = hex.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  return `30617:${hex}:${repo}`;
}

/** Operator `space.gittr.app` always points at the gittr Code tab. */
export function officialGittrAndroidRepoPath(
  pubkey: string,
  appId: string
): string | undefined {
  if ((pubkey || "").trim().toLowerCase() !== GITTR_OWNER_PUBKEY_HEX) {
    return undefined;
  }
  if ((appId || "").trim().toLowerCase() !== OFFICIAL_GITTR_APP_ID) {
    return undefined;
  }
  return `/${GITTR_OWNER_NPUB}/${OFFICIAL_GITTR_REPO_SLUG}`;
}

function gittrRepoPathForParsedApp(
  event: NostrEventLike,
  appId: string,
  repository?: string
): string | undefined {
  return (
    gittrRepoPathFromSoftwareEvent(event, repository) ||
    officialGittrAndroidRepoPath(event.pubkey, appId)
  );
}

/** NIP-34 `a` tags to keep on a slim catalog event (pointer + optional relay). */
export function softwareAppNip34CatalogTags(
  app: ParsedSoftwareApp
): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  const push = (tag: string[]) => {
    const addr = (tag[1] || "").trim();
    if (!addr) return;
    if (!gittrRepoPathFromNip34A(addr)) return;
    const key = addr.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(tag[2] ? [tag[0]!, addr, tag[2]] : [tag[0]!, addr]);
  };
  for (const t of app.raw?.tags || []) {
    if (t[0] === "a") push(t);
  }
  if (out.length === 0 && app.gittrRepoPath) {
    const addr = nip34AddressFromGittrRepoPath(app.gittrRepoPath);
    if (addr) push(["a", addr]);
  }
  return out;
}

function withPreservedGittrRepoPath(
  incoming: ParsedSoftwareApp,
  prev?: ParsedSoftwareApp
): ParsedSoftwareApp {
  if (incoming.gittrRepoPath || !prev?.gittrRepoPath) return incoming;
  const tags = [...(incoming.raw?.tags || [])];
  const hasA = tags.some(
    (t) => t[0] === "a" && !!gittrRepoPathFromNip34A(t[1] || "")
  );
  if (!hasA) {
    const addr = nip34AddressFromGittrRepoPath(prev.gittrRepoPath);
    if (addr) tags.push(["a", addr]);
  }
  return {
    ...incoming,
    gittrRepoPath: prev.gittrRepoPath,
    raw: incoming.raw ? { ...incoming.raw, tags } : incoming.raw,
  };
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
   * repo (`a` tag), a gittr.space repository URL, or the official
   * `space.gittr.app` listing. Absent for most Zapstore apps.
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
    icon:
      normalizeSoftwareIconUrl(readTag(event, "icon")) ||
      normalizeSoftwareIconUrl(readTag(event, "image")),
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
    gittrRepoPath: gittrRepoPathForParsedApp(event, appId, repository),
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

/** Prefer `main` channel; then highest semver, then newest `created_at`. */
export function pickLatestMainRelease(
  releases: ParsedSoftwareRelease[]
): ParsedSoftwareRelease | undefined {
  const main = releases.filter((r) => (r.channel || "main") === "main");
  const pool = main.length > 0 ? main : releases;
  if (pool.length === 0) return undefined;
  return [...pool].sort((a, b) => {
    const sv = compareSemver(b.version, a.version);
    if (sv !== 0) return sv;
    return b.createdAt - a.createdAt;
  })[0];
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
  return sortSoftwareAppsByCreatedAt(out);
}

/** Newest NIP-82 announce first (same clock Home / profile already use). */
export function sortSoftwareAppsByCreatedAt<
  T extends { createdAt?: number; name?: string }
>(apps: T[]): T[] {
  return [...apps].sort((a, b) => {
    const d = (b.createdAt || 0) - (a.createdAt || 0);
    if (d !== 0) return d;
    return (a.name || "").localeCompare(b.name || "", undefined, {
      sensitivity: "base",
    });
  });
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

/**
 * Union two catalog paints. Relays only return the newest ~4000 kind 32267
 * events, so a fresh scrape can drop older unique apps when new ones appear.
 * Newest `createdAt` wins on the same pubkey+appId; missing keys are kept.
 */
export function mergeSoftwareApps(
  previous: ParsedSoftwareApp[] | undefined | null,
  incoming: ParsedSoftwareApp[] | undefined | null
): ParsedSoftwareApp[] {
  const map = new Map<string, ParsedSoftwareApp>();
  for (const app of previous || []) {
    if (!app?.pubkey || !app?.appId) continue;
    map.set(appDedupKey(app.pubkey, app.appId), app);
  }
  for (const app of incoming || []) {
    if (!app?.pubkey || !app?.appId) continue;
    const key = appDedupKey(app.pubkey, app.appId);
    const prev = map.get(key);
    if (!prev || (app.createdAt || 0) > (prev.createdAt || 0)) {
      map.set(key, withPreservedGittrRepoPath(app, prev));
    }
  }
  return sortSoftwareAppsByCreatedAt(Array.from(map.values()));
}

const SOFTWARE_NIP09_A = /^(32267|30063|3063):[0-9a-f]{64}:.+/i;

/** NIP-09 kind 5 `e` / `a` tags that point at app, release, or asset events. */
export function collectNip09SoftwareDeletions(event: {
  kind?: number;
  pubkey?: string;
  tags?: string[][];
}): { eventIds: string[]; addressKeys: string[] } {
  const eventIds: string[] = [];
  const addressKeys: string[] = [];
  if (event.kind !== 5) return { eventIds, addressKeys };
  const author = (event.pubkey || "").toLowerCase();
  for (const t of event.tags || []) {
    if (
      t[0] === "e" &&
      typeof t[1] === "string" &&
      /^[0-9a-f]{64}$/i.test(t[1])
    ) {
      eventIds.push(t[1].toLowerCase());
    }
    if (t[0] === "a" && typeof t[1] === "string") {
      const a = t[1].trim();
      if (!SOFTWARE_NIP09_A.test(a)) continue;
      const key = a.toLowerCase();
      const tagged = key.split(":")[1] || "";
      if (author && tagged === author) addressKeys.push(key);
    }
  }
  return { eventIds, addressKeys };
}

export function mergeDeletedEventAuthors(
  previous: Record<string, string> | Map<string, string> | null | undefined,
  incoming: Record<string, string> | Map<string, string> | null | undefined,
  cap = 8000
): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (
    src: Record<string, string> | Map<string, string> | null | undefined
  ) => {
    if (!src) return;
    const entries = src instanceof Map ? src.entries() : Object.entries(src);
    for (const [id, pk] of entries) {
      if (!/^[0-9a-f]{64}$/i.test(id) || !/^[0-9a-f]{64}$/i.test(pk)) continue;
      out[id.toLowerCase()] = pk.toLowerCase();
      if (Object.keys(out).length >= cap) return;
    }
  };
  add(previous);
  add(incoming);
  return out;
}

function deletedAuthorsMap(
  deletedEventAuthors:
    | Map<string, string>
    | Record<string, string>
    | null
    | undefined
): Map<string, string> {
  if (!deletedEventAuthors) return new Map();
  if (deletedEventAuthors instanceof Map) return deletedEventAuthors;
  return new Map(
    Object.entries(deletedEventAuthors).map(([id, pk]) => [
      id.toLowerCase(),
      String(pk).toLowerCase(),
    ])
  );
}

export function softwareAppIsDeleted(
  app: ParsedSoftwareApp,
  deletedEventAuthors:
    | Map<string, string>
    | Record<string, string>
    | null
    | undefined,
  deletedAddressKeys?: Iterable<string>
): boolean {
  const authors = deletedAuthorsMap(deletedEventAuthors);
  const id = (app.raw?.id || "").toLowerCase();
  const owner = (app.pubkey || "").toLowerCase();
  if (id && authors.get(id) === owner) return true;
  if (!deletedAddressKeys) return false;
  const addrs =
    deletedAddressKeys instanceof Set
      ? deletedAddressKeys
      : new Set([...deletedAddressKeys].map((a) => String(a).toLowerCase()));
  return addrs.has(`32267:${owner}:${app.appId}`.toLowerCase());
}

export function omitDeletedSoftwareApps(
  apps: ParsedSoftwareApp[] | undefined | null,
  deletedEventAuthors:
    | Map<string, string>
    | Record<string, string>
    | null
    | undefined,
  deletedAddressKeys?: Iterable<string>
): ParsedSoftwareApp[] {
  return (apps || []).filter(
    (app) => !softwareAppIsDeleted(app, deletedEventAuthors, deletedAddressKeys)
  );
}

/** Rebuild NIP-82 tags so a slim catalog event can be parsed again. */
export function softwareAppCatalogTags(app: ParsedSoftwareApp): string[][] {
  const tags: string[][] = [
    ["d", app.appId],
    ["name", app.name],
  ];
  if (app.summary) tags.push(["summary", app.summary]);
  if (app.icon) tags.push(["icon", app.icon]);
  if (app.repository) tags.push(["repository", app.repository]);
  if (app.webUrl) tags.push(["url", app.webUrl]);
  if (app.license) tags.push(["license", app.license]);
  for (const t of app.topics) tags.push(["t", t]);
  for (const f of app.platformHints) tags.push(["f", f]);
  for (const p of app.attributedPubkeys) tags.push(["p", p]);
  for (const a of softwareAppNip34CatalogTags(app)) tags.push(a);
  return tags;
}

/**
 * Drop relaypool metadata and long descriptions so /apps JSON stays under
 * Next’s 4MB warning as the Zapstore page-walk grows past ~509 apps.
 */
export function slimSoftwareAppForCatalog(
  app: ParsedSoftwareApp
): ParsedSoftwareApp {
  const content = app.summary || (app.content || "").slice(0, 280);
  return {
    ...app,
    content,
    raw: {
      id: app.raw?.id || "",
      pubkey: app.pubkey,
      kind: KIND_SOFTWARE_APPLICATION,
      created_at: app.createdAt,
      content,
      tags: softwareAppCatalogTags(app),
    },
  };
}

export function slimSoftwareReleaseForCatalog(
  r: ParsedSoftwareRelease
): ParsedSoftwareRelease {
  return {
    ...r,
    raw: {
      id: r.raw?.id || "",
      pubkey: r.pubkey,
      kind: KIND_SOFTWARE_RELEASE,
      created_at: r.createdAt,
      content: r.content || "",
      tags: [
        ["d", r.d],
        ["i", r.appId],
        ["version", r.version],
        ["c", r.channel || "main"],
        ...r.assetEventIds.map((id) => ["e", id]),
      ],
    },
  };
}

export function slimReleaseRecordsForCatalog(
  map: Record<string, ParsedSoftwareRelease[]> | undefined
): Record<string, ParsedSoftwareRelease[]> {
  const out: Record<string, ParsedSoftwareRelease[]> = {};
  for (const [k, list] of Object.entries(map || {})) {
    const latest = pickLatestMainRelease(list);
    if (latest) out[k] = [slimSoftwareReleaseForCatalog(latest)];
  }
  return out;
}
