import {
  gittrPagesGatewayBase,
  loadGatewayStatusSites,
} from "@/lib/gittr-pages/load-gateway-status-sites";
import { pageBelongsToOwner } from "@/lib/gittr-pages/pages-owner-match";
import {
  gatewayIngestUrl,
  parsePagesIngestParams,
} from "@/lib/gittr-pages/pages-published";

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * After Push Manifest: tell our nsite-gateway to fetch this pubkey+d from
 * relays (including relay.gittr.space), then bust the Next directory cache.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const parsed = parsePagesIngestParams(searchParams);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const base = gittrPagesGatewayBase();
  const ingestUrl = gatewayIngestUrl(base, parsed.authorHex, parsed.dTag);
  let gateway: {
    ok?: boolean;
    found?: boolean;
    id?: string | null;
    createdAt?: number | null;
    error?: string;
  } | null = null;
  try {
    const res = await fetch(ingestUrl, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const raw = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const errorText =
      raw && typeof raw.error === "string" ? raw.error : undefined;
    gateway = {
      ok: raw && typeof raw.ok === "boolean" ? raw.ok : res.ok,
      found: raw && typeof raw.found === "boolean" ? raw.found : undefined,
      id: raw && typeof raw.id === "string" ? raw.id : null,
      createdAt:
        raw && typeof raw.createdAt === "number" ? raw.createdAt : null,
      error: res.ok ? errorText : errorText || `gateway ingest ${res.status}`,
    };
    if (!res.ok) {
      gateway.ok = false;
    }
  } catch (e: unknown) {
    gateway = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const loaded = await loadGatewayStatusSites({ fresh: true });
  if ("error" in loaded) {
    return NextResponse.json(
      {
        error: loaded.error,
        gateway,
        ingestUrl,
      },
      { status: loaded.status }
    );
  }

  const sites = loaded.sites.filter((s) =>
    pageBelongsToOwner(s, parsed.authorHex)
  );

  return NextResponse.json(
    {
      ok: gateway?.ok !== false,
      ingestUrl,
      gateway,
      sites,
      total: sites.length,
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
