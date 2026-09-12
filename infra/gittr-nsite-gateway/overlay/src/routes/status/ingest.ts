import type { Context } from "@hono/hono";
import { ingestReplaceableManifest } from "../../services/nostr.ts";

const HEX64 = /^[0-9a-f]{64}$/i;
const D_TAG = /^[a-z0-9-]{0,13}$/;

/**
 * Force-load one replaceable site manifest from relays into the event store.
 * gittr calls this after Push Manifest so Links / profile / /pages do not wait
 * for the next directory pass.
 */
export async function statusIngestRoute(c: Context) {
  const url = new URL(c.req.url);
  const pubkey = (url.searchParams.get("pubkey") || "").trim().toLowerCase();
  const identifier = (url.searchParams.get("d") ||
    url.searchParams.get("identifier") ||
    "").trim().toLowerCase();

  if (!HEX64.test(pubkey)) {
    return c.json({ ok: false, error: "pubkey must be 64-char hex" }, 400);
  }
  if (!D_TAG.test(identifier) || identifier.endsWith("-")) {
    return c.json(
      { ok: false, error: "d must be a NIP-5A name (0–13 chars)" },
      400,
    );
  }

  const event = await ingestReplaceableManifest(pubkey, identifier, 10_000);
  return c.json(
    {
      ok: true,
      pubkey,
      identifier,
      found: Boolean(event),
      id: event?.id ?? null,
      createdAt: event?.created_at ?? null,
    },
    200,
    { "Cache-Control": "no-store" },
  );
}
