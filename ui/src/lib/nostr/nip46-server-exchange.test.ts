import { describe, expect, it } from "vitest";

import {
  nip46RelayAllowed,
  nip46RequestShape,
  startNip46Exchange,
  takeNip46Exchange,
} from "./nip46-server-exchange";

const NOW = Math.floor(Date.now() / 1000);

function wire(over: Record<string, unknown> = {}) {
  return {
    id: "a".repeat(64),
    pubkey: "b".repeat(64),
    created_at: NOW,
    kind: 24133,
    tags: [["p", "c".repeat(64)]],
    content: "encrypted",
    sig: "d".repeat(128),
    ...over,
  };
}

describe("nip46 server exchange", () => {
  it("accepts only public bunker relays", () => {
    expect(nip46RelayAllowed("wss://relay.gittr.space")).toBe(true);
    expect(nip46RelayAllowed("wss://nostr.mom")).toBe(true);
    expect(nip46RelayAllowed("https://relay.gittr.space")).toBe(false);
    expect(nip46RelayAllowed("wss://127.0.0.1")).toBe(false);
    expect(nip46RelayAllowed("wss://umbrel.local")).toBe(false);
  });

  it("accepts a fresh kind-24133 and rejects anything else", () => {
    expect(nip46RequestShape(wire(), NOW).ok).toBe(true);
    expect(nip46RequestShape(wire({ kind: 1 }), NOW).ok).toBe(false);
    expect(nip46RequestShape(wire({ created_at: NOW - 10_000 }), NOW).ok).toBe(
      false
    );
    expect(nip46RequestShape(wire({ tags: [["d", "nope"]] }), NOW).ok).toBe(
      false
    );
  });

  it("returns Amber's reply on the ticket and ignores our own event", async () => {
    const sockets: Array<{
      handlers: Record<string, (data?: unknown) => void>;
      sent: string[];
    }> = [];
    const started = await startNip46Exchange(
      [wire() as never],
      ["wss://relay.gittr.space"],
      () => {
        const sock = { handlers: {} as Record<string, (data?: unknown) => void>, sent: [] as string[] };
        sockets.push(sock);
        return {
          send: (data: string) => {
            sock.sent.push(data);
          },
          close: () => undefined,
          on(event: string, cb: (data?: unknown) => void) {
            sock.handlers[event] = cb;
          },
        };
      }
    );
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    sockets[0].handlers.open();
    expect(sockets[0].sent.some((line) => line.includes('"EVENT"'))).toBe(true);
    sockets[0].handlers.message(
      JSON.stringify(["OK", "a".repeat(64), true, ""])
    );
    const reply = wire({
      id: "e".repeat(64),
      pubkey: "f".repeat(64),
      tags: [["p", "b".repeat(64)]],
    });
    sockets[0].handlers.message(JSON.stringify(["EVENT", "sub", reply]));
    sockets[0].handlers.message(JSON.stringify(["EVENT", "sub", wire()]));
    const taken = takeNip46Exchange(started.ticket);
    expect(taken?.acked).toBe(true);
    expect(taken?.events).toHaveLength(1);
    expect(taken?.events[0].id).toBe("e".repeat(64));
  });
});
