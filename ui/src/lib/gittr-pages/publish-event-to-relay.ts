/**
 * /pages is filled from these relays. relay.gittr.space is also Amber's bunker
 * relay, so the normal publish list strips it for the whole signed-in session
 * and the directory keeps the previous manifest. The page is saved on a
 * separate short-lived socket (server first, then the browser), then closed,
 * so Amber can use the host again.
 */
export const PAGES_DIRECTORY_RELAYS = [
  "wss://relay.gittr.space",
  "wss://nsite.run",
] as const;

const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_128 = /^[0-9a-f]{128}$/;
const D_TAG = /^[a-z0-9-]{1,13}$/;

export type PagesDirectoryEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: 35128;
  tags: string[][];
  content: string;
  sig: string;
};

/** Kind 35128 only, so this cannot be used to push arbitrary events. */
export function pagesDirectoryEventShape(
  input: unknown
): { ok: true; event: PagesDirectoryEvent } | { ok: false; reason: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, reason: "Missing signed page." };
  }
  const raw = input as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.toLowerCase() : "";
  const pubkey = typeof raw.pubkey === "string" ? raw.pubkey.toLowerCase() : "";
  const sig = typeof raw.sig === "string" ? raw.sig.toLowerCase() : "";
  const createdAt = raw.created_at;
  if (raw.kind !== 35128) {
    return {
      ok: false,
      reason: "Only a Pages manifest can be saved this way.",
    };
  }
  if (!HEX_64.test(id) || !HEX_64.test(pubkey) || !HEX_128.test(sig)) {
    return { ok: false, reason: "The signed page is incomplete." };
  }
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) {
    return { ok: false, reason: "The signed page has no timestamp." };
  }
  if (typeof raw.content !== "string") {
    return { ok: false, reason: "The signed page is incomplete." };
  }
  if (!Array.isArray(raw.tags) || raw.tags.length > 2500) {
    return { ok: false, reason: "The page has no file list." };
  }
  const tags: string[][] = [];
  for (const tag of raw.tags) {
    if (
      !Array.isArray(tag) ||
      tag.length < 1 ||
      tag.some((part) => typeof part !== "string")
    ) {
      return { ok: false, reason: "The page file list is unreadable." };
    }
    tags.push(tag as string[]);
  }
  const d =
    tags
      .find((tag) => tag[0] === "d")?.[1]
      ?.trim()
      .toLowerCase() || "";
  if (!D_TAG.test(d) || d.endsWith("-")) {
    return { ok: false, reason: "The page name is missing." };
  }
  const event: PagesDirectoryEvent = {
    id,
    pubkey,
    created_at: Math.floor(createdAt),
    kind: 35128,
    tags,
    content: raw.content,
    sig,
  };
  if (JSON.stringify(event).length > 262144) {
    return {
      ok: false,
      reason: "The page is too large for the directory relay.",
    };
  }
  return { ok: true, event };
}

export type RelayOkParse = {
  done: boolean;
  ok: boolean;
  reason?: string;
};

export function parseRelayOkMessage(
  data: unknown,
  eventId: string
): RelayOkParse {
  if (!Array.isArray(data) || data[0] !== "OK" || data[1] !== eventId) {
    return { done: false, ok: false };
  }
  if (data[2] === true) return { done: true, ok: true };
  const reason =
    typeof data[3] === "string" && data[3].trim()
      ? data[3].trim()
      : "Relay rejected the page.";
  return { done: true, ok: false, reason };
}

export type DirectRelayPublishResult = {
  ok: boolean;
  relay: string;
  reason?: string;
};

type RelaySocket = {
  send: (data: string) => void;
  close: () => void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
};

export function publishEventToRelay(
  event: { id: string },
  relayUrl: string,
  timeoutMs = 12000,
  openSocket?: (url: string) => RelaySocket
): Promise<DirectRelayPublishResult> {
  return new Promise((resolve) => {
    const canOpenBrowserSocket = typeof WebSocket !== "undefined";
    if (!openSocket && !canOpenBrowserSocket) {
      resolve({
        ok: false,
        relay: relayUrl,
        reason: "This browser cannot open a relay socket.",
      });
      return;
    }
    let settled = false;
    let ws: RelaySocket | undefined;
    const finish = (result: DirectRelayPublishResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        /* already closed */
      }
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish({
        ok: false,
        relay: relayUrl,
        reason: "The relay did not acknowledge the page.",
      });
    }, timeoutMs);
    let socket: RelaySocket;
    try {
      socket = openSocket
        ? openSocket(relayUrl)
        : (new WebSocket(relayUrl) as unknown as RelaySocket);
    } catch {
      finish({
        ok: false,
        relay: relayUrl,
        reason: "Could not open the relay.",
      });
      return;
    }
    ws = socket;
    socket.onopen = () => {
      try {
        socket.send(JSON.stringify(["EVENT", event]));
      } catch {
        finish({
          ok: false,
          relay: relayUrl,
          reason: "Could not send the page to the relay.",
        });
      }
    };
    socket.onmessage = (msg) => {
      let data: unknown;
      try {
        data = JSON.parse(String(msg.data));
      } catch {
        return;
      }
      const parsed = parseRelayOkMessage(data, event.id);
      if (!parsed.done) return;
      finish(
        parsed.ok
          ? { ok: true, relay: relayUrl }
          : { ok: false, relay: relayUrl, reason: parsed.reason }
      );
    };
    socket.onerror = () => {
      finish({
        ok: false,
        relay: relayUrl,
        reason: "Could not reach the relay.",
      });
    };
  });
}

export type DirectorySaveResult = {
  ok: boolean;
  relay?: string;
  reason?: string;
  /** When false, the server already got a final yes/no. Do not open a browser socket. */
  tryBrowser?: boolean;
};

/**
 * Ask gittr's server to store the signed manifest on the directory relays.
 * The browser socket is only the fallback: opening relay.gittr.space in the
 * page fights Amber's bunker socket on that same host.
 */
export async function savePagesManifestOnDirectory(
  event: { id: string },
  post: (event: {
    id: string;
  }) => Promise<DirectorySaveResult | null> = postManifestToDirectoryApi
): Promise<DirectorySaveResult> {
  const viaApi = await post(event).catch(() => null);
  if (viaApi?.ok) return viaApi;
  if (viaApi && viaApi.tryBrowser === false) return viaApi;
  let reason = viaApi?.reason || "";
  for (const relayUrl of PAGES_DIRECTORY_RELAYS) {
    const direct = await publishEventToRelay(event, relayUrl);
    if (direct.ok) return { ok: true, relay: direct.relay };
    const host = relayUrl.replace(/^wss:\/\//, "");
    reason = direct.reason
      ? `${host}: ${direct.reason}`
      : `${host} did not accept the page.`;
  }
  return {
    ok: false,
    reason: reason || "The directory relay did not accept the page.",
  };
}

async function postManifestToDirectoryApi(event: {
  id: string;
}): Promise<DirectorySaveResult | null> {
  if (typeof fetch !== "function") return null;
  const res = await fetch("/api/gittr-pages/directory-relay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event }),
  });
  const data = (await res.json().catch(() => null)) as {
    ok?: boolean;
    relay?: string;
    reason?: string;
    tryBrowser?: boolean;
  } | null;
  if (!data || typeof data.ok !== "boolean") return null;
  if (data.ok) return { ok: true, relay: data.relay };
  return {
    ok: false,
    relay: data.relay,
    reason: data.reason || "The directory relay did not accept the page.",
    tryBrowser: data.tryBrowser !== false && res.status !== 400,
  };
}
