import { gittrPagesBlossomOrigin } from "@/lib/gittr-pages/gittr-pages-blossom-origin";

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SHA256_RE = /^[0-9a-f]{64}$/;

type AuthEvent = {
  kind?: unknown;
  tags?: unknown;
};

/**
 * Server-side DELETE of one Blossom blob (same-origin, so the browser is not
 * blocked by the file server). The signed kind 24242 event must be t=delete
 * and must name this hash. Used after a page publish to drop the previous
 * version's files.
 */
export async function POST(req: Request) {
  let body: { authEvent?: AuthEvent; sha256?: unknown };
  try {
    body = (await req.json()) as { authEvent?: AuthEvent; sha256?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sha256 = String(body.sha256 || "").trim().toLowerCase();
  if (!SHA256_RE.test(sha256)) {
    return NextResponse.json({ error: "sha256 must be 64 hex chars" }, { status: 400 });
  }
  const auth = body.authEvent;
  if (!auth || auth.kind !== 24242 || !Array.isArray(auth.tags)) {
    return NextResponse.json(
      { error: "authEvent must be a kind 24242 delete token" },
      { status: 400 }
    );
  }
  const tags = auth.tags as unknown[];
  const verb = tags.find(
    (t): t is string[] => Array.isArray(t) && t[0] === "t" && typeof t[1] === "string"
  );
  const verbName = verb?.[1];
  if (typeof verbName !== "string" || verbName.toLowerCase() !== "delete") {
    return NextResponse.json(
      { error: "authEvent must include t=delete" },
      { status: 400 }
    );
  }
  const named = tags.some(
    (t) =>
      Array.isArray(t) &&
      t[0] === "x" &&
      String(t[1] || "").toLowerCase() === sha256
  );
  if (!named) {
    return NextResponse.json(
      { error: "authEvent must include x tag matching sha256" },
      { status: 400 }
    );
  }

  const origin = gittrPagesBlossomOrigin().replace(/\/$/, "");
  const authHeader =
    "Nostr " +
    Buffer.from(JSON.stringify(auth), "utf8").toString("base64url");

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20_000);
  try {
    const upstream = await fetch(`${origin}/${sha256}`, {
      method: "DELETE",
      signal: ac.signal,
      headers: { Authorization: authHeader },
    });
    if (upstream.status === 204 || upstream.status === 404) {
      return NextResponse.json({ ok: true, status: upstream.status });
    }
    const text = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: text.slice(0, 200) || `Blossom delete failed (${upstream.status})` },
      { status: upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502 }
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `Upstream delete failed: ${message}` },
      { status: 502 }
    );
  } finally {
    clearTimeout(timer);
  }
}
