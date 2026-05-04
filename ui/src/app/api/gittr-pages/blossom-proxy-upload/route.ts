import { reconcileBlossomUpstreamContentType } from "@/lib/gittr-pages/blossom-upload-mime";

import { createHash } from "crypto";
import { NextResponse } from "next/server";

/** Large uploads + slow upstream (Blossom); avoid platform default cutting the handler short. */
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const MAX_BYTES = 4 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 110_000;

function blossomOrigin(): string {
  const raw = (
    process.env.NEXT_PUBLIC_BLOSSOM_URL || "https://blossom.band"
  ).trim();
  const withProto = raw.startsWith("http") ? raw : `https://${raw}`;
  return withProto.replace(/\/$/, "");
}

type AuthEvent = {
  kind?: unknown;
  tags?: unknown;
  [key: string]: unknown;
};

function validateAuthEvent(
  auth: AuthEvent,
  sha256: string
): { ok: true } | { ok: false; error: string } {
  if (!auth || typeof auth !== "object") {
    return { ok: false, error: "authEvent required" };
  }
  if (auth.kind !== 24242) {
    return { ok: false, error: "authEvent.kind must be 24242" };
  }
  const tags = Array.isArray(auth.tags) ? auth.tags : [];
  const xTags = tags.filter(
    (t): t is string[] =>
      Array.isArray(t) && t[0] === "x" && typeof t[1] === "string"
  );
  const want = sha256.toLowerCase();
  if (!xTags.some((t) => String(t[1] ?? "").toLowerCase() === want)) {
    return { ok: false, error: "authEvent must include x tag matching sha256" };
  }
  const exp = tags.find(
    (t): t is string[] =>
      Array.isArray(t) && t[0] === "expiration" && typeof t[1] === "string"
  );
  if (!exp) {
    return { ok: false, error: "authEvent missing expiration tag" };
  }
  const expTs = parseInt(String(exp[1] ?? ""), 10);
  if (!Number.isFinite(expTs) || expTs <= Math.floor(Date.now() / 1000)) {
    return { ok: false, error: "authEvent expired or invalid expiration" };
  }
  return { ok: true };
}

/** Safe Content-Type for upstream PUT (Blossom storage rules are MIME-sensitive). */
function upstreamContentType(candidate: unknown): string {
  const fallback = "application/octet-stream";
  if (typeof candidate !== "string") return fallback;
  const raw = candidate.trim().slice(0, 128);
  if (!raw) return fallback;
  const head = raw.split(";")[0];
  if (!head) return fallback;
  const main = head.trim().toLowerCase();
  if (
    !/^[a-z0-9][a-z0-9._+-]{0,127}\/[a-z0-9][a-z0-9._+-]{0,127}$/.test(main)
  ) {
    return fallback;
  }
  return raw.length <= 128 ? raw : main;
}

/**
 * Server-side PUT to the configured Blossom origin (avoids browser CORS to the CDN).
 * Client must sign kind 24242 with NIP-07 and send the full signed event + body + sha256.
 */
export async function POST(req: Request) {
  let body: {
    authEvent: AuthEvent;
    contentBase64: string;
    sha256: string;
    /** IANA MIME for this blob; required for hosts that reject octet-stream on .js etc. */
    contentType?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sha256 = (body.sha256 || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    return NextResponse.json(
      { error: "sha256 must be 64 hex chars" },
      { status: 400 }
    );
  }

  const v = validateAuthEvent(body.authEvent, sha256);
  if (!v.ok) {
    return NextResponse.json({ error: v.error }, { status: 400 });
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(body.contentBase64 || "", "base64");
  } catch {
    return NextResponse.json(
      { error: "Invalid contentBase64" },
      { status: 400 }
    );
  }

  if (buf.length === 0) {
    return NextResponse.json({ error: "Empty file" }, { status: 400 });
  }
  if (buf.length > MAX_BYTES) {
    return NextResponse.json(
      { error: `File exceeds ${MAX_BYTES} bytes` },
      { status: 413 }
    );
  }

  const computed = createHash("sha256")
    .update(buf as unknown as Uint8Array)
    .digest("hex");
  if (computed !== sha256) {
    return NextResponse.json(
      { error: "contentBase64 sha256 does not match sha256 field" },
      { status: 400 }
    );
  }

  const origin = blossomOrigin();
  const authHeader =
    "Nostr " +
    Buffer.from(JSON.stringify(body.authEvent), "utf8").toString("base64url");

  const uploadUrl = `${origin}/upload`;
  const bodyBytes = new Uint8Array(buf);
  const len = bodyBytes.byteLength;
  const mime = reconcileBlossomUpstreamContentType(
    upstreamContentType(body.contentType),
    bodyBytes
  );

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetch(uploadUrl, {
      method: "PUT",
      signal: ac.signal,
      headers: {
        Authorization: authHeader,
        "X-SHA-256": sha256,
        "Content-Type": mime,
        // BUD-02 / blossom-server: Content-Length is required; set explicitly for all runtimes.
        "Content-Length": String(len),
      },
      body: bodyBytes,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[blossom-proxy-upload] upstream fetch error:", message);
    return NextResponse.json(
      { error: `Upstream fetch failed: ${message}` },
      { status: 502 }
    );
  } finally {
    clearTimeout(timer);
  }

  const reason = upstream.headers.get("x-reason");
  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    const st = upstream.status;
    console.error(
      "[blossom-proxy-upload] Blossom non-OK:",
      st,
      reason || "",
      text.slice(0, 200)
    );
    // Forward 4xx/5xx from Blossom so the client can distinguish 401 vs 503 vs 502.
    const outStatus = st >= 400 && st < 600 ? st : 502;
    let hint: string | undefined;
    try {
      const host = new URL(uploadUrl).hostname.toLowerCase();
      if (
        st === 415 &&
        (host === "nostr.build" ||
          host.endsWith(".nostr.build") ||
          host.includes("nostr.build"))
      ) {
        hint =
          "Use a Blossom that accepts your static files: set NEXT_PUBLIC_BLOSSOM_URL=https://blossom.band (recommended) or your own NIP-96 server, then yarn build && restart gittr-frontend. See SETUP_INSTRUCTIONS → Publish Pages / Blossom.";
      }
    } catch {
      /* ignore */
    }
    return NextResponse.json(
      {
        error: `Blossom returned ${st}`,
        reason: reason || undefined,
        body: text.slice(0, 500),
        hint,
      },
      { status: outStatus }
    );
  }

  return NextResponse.json({ ok: true, sha256 });
}
