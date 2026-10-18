import {
  PAGES_DIRECTORY_RELAYS,
  pagesDirectoryEventShape,
  publishEventToRelay,
} from "@/lib/gittr-pages/publish-event-to-relay";

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY = 300_000;

/**
 * Store one signed kind-35128 on the relays that fill /pages.
 * The browser pool cannot: while Amber is paired, relay.gittr.space is
 * reserved for the bunker socket and stripped from every normal publish.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_BODY) {
    return NextResponse.json(
      {
        ok: false,
        reason: "The page is too large for the directory relay.",
        tryBrowser: false,
      },
      { status: 400 }
    );
  }
  let body: { event?: unknown };
  try {
    body = JSON.parse(raw) as { event?: unknown };
  } catch {
    return NextResponse.json(
      { ok: false, reason: "Missing signed page.", tryBrowser: false },
      { status: 400 }
    );
  }
  const shaped = pagesDirectoryEventShape(body.event);
  if (!shaped.ok) {
    return NextResponse.json(
      { ok: false, reason: shaped.reason, tryBrowser: false },
      { status: 400 }
    );
  }

  const { validateEvent, verifySignature } = await import("nostr-tools");
  const signed = shaped.event as import("nostr-tools").Event;
  if (!validateEvent(signed) || !verifySignature(signed)) {
    return NextResponse.json(
      {
        ok: false,
        reason: "The page signature does not check out.",
        tryBrowser: false,
      },
      { status: 400 }
    );
  }

  const wsMod = await import("ws");
  const Socket = wsMod.default || wsMod.WebSocket;
  if (!Socket) {
    return NextResponse.json(
      { ok: false, reason: "Could not open the relay.", tryBrowser: true },
      { status: 503 }
    );
  }

  const reasons: string[] = [];
  for (const relayUrl of PAGES_DIRECTORY_RELAYS) {
    const result = await publishEventToRelay(
      shaped.event,
      relayUrl,
      12000,
      (url) => new Socket(url)
    );
    if (result.ok) {
      return NextResponse.json({ ok: true, relay: result.relay });
    }
    const host = result.relay.replace(/^wss:\/\//, "");
    if (result.reason) reasons.push(`${host}: ${result.reason}`);
  }
  return NextResponse.json({
    ok: false,
    reason: reasons.join(" ") || "The directory relay did not accept the page.",
    tryBrowser: true,
  });
}
