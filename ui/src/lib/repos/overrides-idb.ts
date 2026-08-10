/**
 * Large / binary file overrides (Upload, new-file) live in IndexedDB.
 * localStorage only keeps a small pointer so GIF/folder uploads survive
 * QuotaExceededError on gittr_overrides__*.
 */
import { nip19 } from "nostr-tools";

const DB_NAME = "gittr-overrides-v1";
const STORE = "blobs";
const DB_VERSION = 1;

/** localStorage value prefix: `__gittr_idb__:image/gif` */
export const OVERRIDE_IDB_MARKER_PREFIX = "__gittr_idb__:";

type BlobRecord = {
  key: string;
  entity: string;
  repo: string;
  path: string;
  content: string;
  mime?: string;
  updatedAt: number;
};

const memory = new Map<string, string>();

/** Match `normalizeEntityForStorage` (npub keys) without pulling UI @ aliases into vitest. */
function canonEntity(entity: string): string {
  if (!entity) return "";
  if (entity.startsWith("npub")) return entity;
  if (/^[0-9a-f]{64}$/i.test(entity)) {
    try {
      return nip19.npubEncode(entity.toLowerCase());
    } catch {
      return entity.toLowerCase();
    }
  }
  return entity;
}

function memKey(entity: string, repo: string, path: string): string {
  return `${canonEntity(entity)}\0${repo}\0${path}`;
}

export function isOverrideIdbMarker(value: string | undefined | null): boolean {
  return (
    typeof value === "string" && value.startsWith(OVERRIDE_IDB_MARKER_PREFIX)
  );
}

export function overrideIdbMarker(mime = "application/octet-stream"): string {
  return `${OVERRIDE_IDB_MARKER_PREFIX}${mime || "application/octet-stream"}`;
}

export function mimeFromOverrideIdbMarker(value: string): string {
  if (!isOverrideIdbMarker(value)) return "application/octet-stream";
  return (
    value.slice(OVERRIDE_IDB_MARKER_PREFIX.length) || "application/octet-stream"
  );
}

/** MIME for IDB marker: prefer real types; never label known text as octet-stream. */
export function mimeForOverrideStorage(
  path: string,
  fileType?: string,
  isBinary?: boolean
): string {
  if (fileType && fileType.startsWith("image/")) return fileType;
  if (fileType && fileType.startsWith("text/")) return fileType;
  if (fileType === "application/json" || fileType === "application/xml") {
    return fileType;
  }
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const textMimes: Record<string, string> = {
    md: "text/markdown",
    markdown: "text/markdown",
    txt: "text/plain",
    json: "application/json",
    js: "text/javascript",
    mjs: "text/javascript",
    cjs: "text/javascript",
    ts: "text/plain",
    tsx: "text/plain",
    jsx: "text/plain",
    css: "text/css",
    html: "text/html",
    htm: "text/html",
    xml: "application/xml",
    yml: "text/yaml",
    yaml: "text/yaml",
    toml: "text/plain",
    sh: "text/x-shellscript",
    py: "text/x-python",
    rs: "text/plain",
    go: "text/plain",
    svg: "image/svg+xml",
  };
  if (textMimes[ext]) return textMimes[ext];
  if (isBinary === false) return "text/plain";
  if (
    fileType &&
    fileType !== "file" &&
    fileType !== "application/octet-stream"
  ) {
    return fileType;
  }
  return isBinary ? "application/octet-stream" : "text/plain";
}

export function rememberOverrideBlob(
  entity: string,
  repo: string,
  path: string,
  content: string
): void {
  memory.set(memKey(entity, repo, path), content);
}

export function peekOverrideBlob(
  entity: string,
  repo: string,
  path: string
): string | undefined {
  return memory.get(memKey(entity, repo, path));
}

export function forgetOverrideBlob(
  entity: string,
  repo: string,
  path?: string
): void {
  if (path) {
    memory.delete(memKey(entity, repo, path));
    return;
  }
  const prefix = `${entity}\0${repo}\0`;
  for (const k of [...memory.keys()]) {
    if (k.startsWith(prefix)) memory.delete(k);
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error || new Error("IDB open failed"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("byRepo", ["entity", "repo"], { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

function recordKey(entity: string, repo: string, path: string): string {
  return `${canonEntity(entity)}__${repo}__${path}`;
}

export async function idbPutOverride(opts: {
  entity: string;
  repo: string;
  path: string;
  content: string;
  mime?: string;
}): Promise<void> {
  const entity = canonEntity(opts.entity);
  const { repo, path, content, mime } = opts;
  rememberOverrideBlob(entity, repo, path, content);
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const record: BlobRecord = {
        key: recordKey(entity, repo, path),
        entity,
        repo,
        path,
        content,
        mime,
        updatedAt: Date.now(),
      };
      store.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IDB put failed"));
    });
  } finally {
    db.close();
  }
}

export async function idbGetOverride(
  entity: string,
  repo: string,
  path: string
): Promise<string | null> {
  const ent = canonEntity(entity);
  const cached = peekOverrideBlob(ent, repo, path);
  if (cached) return cached;
  const db = await openDb();
  try {
    const content = await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(recordKey(ent, repo, path));
      req.onsuccess = () => {
        const row = req.result as BlobRecord | undefined;
        resolve(row?.content || null);
      };
      req.onerror = () => reject(req.error || new Error("IDB get failed"));
    });
    if (content) rememberOverrideBlob(ent, repo, path, content);
    return content;
  } finally {
    db.close();
  }
}

export async function idbDeleteOverride(
  entity: string,
  repo: string,
  path: string
): Promise<void> {
  const ent = canonEntity(entity);
  forgetOverrideBlob(ent, repo, path);
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(recordKey(ent, repo, path));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IDB delete failed"));
    });
  } finally {
    db.close();
  }
}

export async function idbDeleteRepoOverrides(
  entity: string,
  repo: string
): Promise<number> {
  const ent = canonEntity(entity);
  forgetOverrideBlob(ent, repo);
  const db = await openDb();
  try {
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const index = store.index("byRepo");
      const req = index.openCursor(IDBKeyRange.only([ent, repo]));
      let removed = 0;
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        cursor.delete();
        removed += 1;
        cursor.continue();
      };
      tx.oncomplete = () => resolve(removed);
      tx.onerror = () => reject(tx.error || new Error("IDB delete failed"));
    });
  } finally {
    db.close();
  }
}

/** Load every blob for a repo into the memory cache (for sync display helpers). */
export async function hydrateRepoOverrideBlobs(
  entity: string,
  repo: string
): Promise<number> {
  const ent = canonEntity(entity);
  const db = await openDb();
  try {
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const index = tx.objectStore(STORE).index("byRepo");
      const req = index.openCursor(IDBKeyRange.only([ent, repo]));
      let n = 0;
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const row = cursor.value as BlobRecord;
        if (row?.path && row?.content) {
          rememberOverrideBlob(ent, repo, row.path, row.content);
          n += 1;
        }
        cursor.continue();
      };
      tx.oncomplete = () => resolve(n);
      tx.onerror = () => reject(tx.error || new Error("IDB hydrate failed"));
    });
  } finally {
    db.close();
  }
}

/**
 * Expand localStorage override map: IDB markers → real base64/text for Push.
 */
export async function resolveOverridesMap(
  entity: string,
  repo: string,
  overrides: Record<string, string>
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [path, value] of Object.entries(overrides)) {
    if (!isOverrideIdbMarker(value)) {
      out[path] = value;
      continue;
    }
    const blob = await idbGetOverride(entity, repo, path);
    if (blob) out[path] = blob;
  }
  return out;
}
