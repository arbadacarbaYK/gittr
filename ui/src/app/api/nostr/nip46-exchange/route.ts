import {
  nip46RelayAllowed,
  nip46RequestShape,
  startNip46Exchange,
  takeNip46Exchange,
  type Nip46WireEvent,
} from "@/lib/nostr/nip46-server-exchange";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY = 200_000;

/**
 * The signed-in browser sometimes cannot open any relay socket, so Amber
 * never sees the signing request. This route publishes that already-encrypted
 * kind-24133 from the server and hands Amber's reply back to the browser.
 * The phone key and the browser's bunker secret never come here.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_BODY) {
    return NextResponse.json(
      { ok: false, reason: "The signing request is too large." },
      { status: 400 }
    );
  }
  let body: { events?: unknown; relays?: unknown };
  try {
    body = JSON.parse(raw) as { events?: unknown; relays?: unknown };
  } catch {
    return NextResponse.json(
      { ok: false, reason: "Missing signing request." },
      { status: 400 }
    );
  }
  if (!Array.isArray(body.events) || !Array.isArray(body.relays)) {
    return NextResponse.json(
      { ok: false, reason: "Missing signing request." },
      { status: 400 }
    );
  }
  const events: Nip46WireEvent[] = [];
  for (const item of body.events.slice(0, 2)) {
    const shaped = nip46RequestShape(item);
    if (!shaped.ok) {
      return NextResponse.json(
        { ok: false, reason: shaped.reason },
        { status: 400 }
      );
    }
    events.push(shaped.event);
  }
  const relays = body.relays
    .filter((item): item is string => typeof item === "string")
    .filter(nip46RelayAllowed)
    .slice(0, 8);
  if (events.length === 0 || relays.length === 0) {
    return NextResponse.json(
      { ok: false, reason: "No public relay to reach Amber." },
      { status: 400 }
    );
  }

  const { validateEvent, verifySignature } = await import("nostr-tools");
  for (const event of events) {
    if (!validateEvent(event) || !verifySignature(event)) {
      return NextResponse.json(
        { ok: false, reason: "The signing request signature does not check out." },
        { status: 400 }
      );
    }
  }

  const started = await startNip46Exchange(events, relays);
  if (!started.ok) {
    return NextResponse.json(
      { ok: false, reason: started.reason },
      { status: 429 }
    );
  }
  return NextResponse.json({ ok: true, ticket: started.ticket });
}

export async function GET(req: Request) {
  const ticket = new URL(req.url).searchParams.get("ticket") || "";
  if (!/^[0-9a-f-]{36}$/i.test(ticket)) {
    return NextResponse.json(
      { ok: false, reason: "Missing signing request." },
      { status: 400 }
    );
  }
  const found = takeNip46Exchange(ticket);
  if (!found) {
    return NextResponse.json(
      { ok: false, reason: "That signing request already finished." },
      { status: 404 }
    );
  }
  return NextResponse.json({
    ok: true,
    events: found.events,
    acked: found.acked,
    failed: found.failed,
  });
}
