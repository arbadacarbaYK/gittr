import { urlLooksPrivateOrLocal } from "../security/private-network-host";

const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_128 = /^[0-9a-f]{128}$/;
const MAX_EVENTS = 2;
const MAX_RELAYS = 8;
const MAX_CONTENT = 80_000;
const MAX_TAGS = 8;
const MAX_TICKETS = 40;
const TICKET_MS = 130_000;

export type Nip46WireEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: 24133;
  tags: string[][];
  content: string;
  sig: string;
};

export function nip46RelayAllowed(raw: string): boolean {
  const t = String(raw || "").trim();
  if (!t.startsWith("wss://") || t.length > 200) return false;
  if (urlLooksPrivateOrLocal(t)) return false;
  try {
    const url = new URL(t);
    if (url.protocol !== "wss:") return false;
    if (url.username || url.password) return false;
    if (!url.hostname || url.hostname === "localhost") return false;
    return true;
  } catch {
    return false;
  }
}

export function nip46RequestShape(
  input: unknown,
  nowSec = Math.floor(Date.now() / 1000)
): { ok: true; event: Nip46WireEvent } | { ok: false; reason: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, reason: "Missing signing request." };
  }
  const raw = input as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.toLowerCase() : "";
  const pubkey = typeof raw.pubkey === "string" ? raw.pubkey.toLowerCase() : "";
  const sig = typeof raw.sig === "string" ? raw.sig.toLowerCase() : "";
  if (raw.kind !== 24133) {
    return { ok: false, reason: "Only a signer request can be sent this way." };
  }
  if (!HEX_64.test(id) || !HEX_64.test(pubkey) || !HEX_128.test(sig)) {
    return { ok: false, reason: "The signing request is incomplete." };
  }
  if (typeof raw.created_at !== "number" || !Number.isFinite(raw.created_at)) {
    return { ok: false, reason: "The signing request has no timestamp." };
  }
  const createdAt = Math.floor(raw.created_at);
  if (Math.abs(nowSec - createdAt) > 300) {
    return { ok: false, reason: "The signing request is too old." };
  }
  if (typeof raw.content !== "string" || raw.content.length > MAX_CONTENT) {
    return { ok: false, reason: "The signing request is the wrong size." };
  }
  if (!Array.isArray(raw.tags) || raw.tags.length < 1 || raw.tags.length > MAX_TAGS) {
    return { ok: false, reason: "The signing request is incomplete." };
  }
  const tags: string[][] = [];
  for (const tag of raw.tags) {
    if (
      !Array.isArray(tag) ||
      tag.length < 2 ||
      tag.length > 4 ||
      tag.some((part) => typeof part !== "string" || part.length > 200)
    ) {
      return { ok: false, reason: "The signing request is incomplete." };
    }
    tags.push(tag as string[]);
  }
  const remote = tags.find((tag) => tag[0] === "p")?.[1]?.toLowerCase() || "";
  if (!HEX_64.test(remote)) {
    return { ok: false, reason: "The signing request has no signer." };
  }
  return {
    ok: true,
    event: {
      id,
      pubkey,
      created_at: createdAt,
      kind: 24133,
      tags,
      content: raw.content,
      sig,
    },
  };
}

type Ticket = {
  events: Nip46WireEvent[];
  seen: Set<string>;
  acked: boolean;
  failed: boolean;
  created: number;
  close: () => void;
};

const tickets = new Map<string, Ticket>();

function sweepTickets(now = Date.now()) {
  for (const [id, ticket] of tickets) {
    if (now - ticket.created > TICKET_MS) {
      ticket.close();
      tickets.delete(id);
    }
  }
}

export function takeNip46Exchange(ticketId: string): {
  events: Nip46WireEvent[];
  acked: boolean;
  failed: boolean;
} | null {
  sweepTickets();
  const ticket = tickets.get(ticketId);
  if (!ticket) return null;
  const events = ticket.events.splice(0, ticket.events.length);
  return { events, acked: ticket.acked, failed: ticket.failed };
}

type RelaySocket = {
  send: (data: string) => void;
  close: () => void;
  on(event: "open", cb: () => void): void;
  on(event: "message", cb: (data: unknown) => void): void;
  on(event: "error", cb: () => void): void;
  on(event: "close", cb: () => void): void;
};

export async function startNip46Exchange(
  events: Nip46WireEvent[],
  relays: string[],
  openSocket?: (url: string) => RelaySocket
): Promise<{ ok: true; ticket: string } | { ok: false; reason: string }> {
  sweepTickets();
  if (events.length < 1 || events.length > MAX_EVENTS) {
    return { ok: false, reason: "Missing signing request." };
  }
  const allowed = [...new Set(relays.map((r) => r.trim()))].filter(nip46RelayAllowed);
  if (allowed.length < 1 || allowed.length > MAX_RELAYS) {
    return { ok: false, reason: "No public relay to reach Amber." };
  }
  if (tickets.size >= MAX_TICKETS) {
    return { ok: false, reason: "Too many signing requests. Try again in a minute." };
  }
  const first = events[0];
  if (!first) return { ok: false, reason: "Missing signing request." };
  const ticketId = crypto.randomUUID();
  const sent = new Set(events.map((event) => event.id));
  const clientPk = first.pubkey;
  const since = Math.min(...events.map((event) => event.created_at)) - 15;
  const sockets: RelaySocket[] = [];
  const ticket: Ticket = {
    events: [],
    seen: new Set(),
    acked: false,
    failed: false,
    created: Date.now(),
    close: () => {
      for (const socket of sockets) {
        try {
          socket.close();
        } catch {
          /* already closed */
        }
      }
    },
  };
  tickets.set(ticketId, ticket);

  const Socket = openSocket
    ? null
    : ((await import("ws")).default as unknown as new (url: string) => RelaySocket);
  let closedWithoutOpen = 0;
  const noteClosed = (didOpen: boolean) => {
    if (didOpen) return;
    closedWithoutOpen += 1;
    if (closedWithoutOpen >= allowed.length) ticket.failed = true;
  };
  for (const url of allowed) {
    let opened = false;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      noteClosed(opened);
    };
    let socket: RelaySocket;
    try {
      socket = openSocket ? openSocket(url) : new Socket!(url);
    } catch {
      done();
      continue;
    }
    sockets.push(socket);
    socket.on("open", () => {
      opened = true;
      try {
        const sub = crypto.randomUUID();
        socket.send(
          JSON.stringify([
            "REQ",
            sub,
            { kinds: [24133], "#p": [clientPk], since },
          ])
        );
        for (const event of events) {
          socket.send(JSON.stringify(["EVENT", event]));
        }
      } catch {
        try {
          socket.close();
        } catch {
          /* ignore */
        }
      }
    });
    socket.on("message", (data) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (!Array.isArray(msg)) return;
      if (msg[0] === "OK" && sent.has(String(msg[1])) && msg[2] === true) {
        ticket.acked = true;
        return;
      }
      if (msg[0] !== "EVENT" || !msg[2] || typeof msg[2] !== "object") return;
      const shaped = nip46RequestShape(msg[2], Math.floor(Date.now() / 1000) + 30);
      if (!shaped.ok) return;
      if (sent.has(shaped.event.id)) return;
      if (shaped.event.pubkey === clientPk) return;
      if (ticket.seen.has(shaped.event.id)) return;
      ticket.seen.add(shaped.event.id);
      if (ticket.events.length < 20) ticket.events.push(shaped.event);
    });
    socket.on("error", () => {
      /* close follows */
    });
    socket.on("close", () => {
      if (!opened) done();
    });
  }
  if (sockets.length === 0) {
    ticket.failed = true;
  }
  const timer = setTimeout(() => {
    ticket.close();
    tickets.delete(ticketId);
  }, TICKET_MS);
  timer.unref?.();
  return { ok: true, ticket: ticketId };
}
