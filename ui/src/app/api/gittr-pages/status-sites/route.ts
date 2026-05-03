import { parseGatewayManifestsJson } from "@/lib/gittr-pages/gateway-manifests-json";
import {
  parseGatewayStatusHtml,
  parseGatewayStatusMeta,
} from "@/lib/gittr-pages/parse-gateway-status-html";

import { NextResponse } from "next/server";

function pagesBase(): string {
  return (
    process.env.NEXT_PUBLIC_GITTR_PAGES_URL || "https://pages.gittr.space"
  ).replace(/\/$/, "");
}

export async function GET() {
  const base = pagesBase();
  const statusUrl = `${base}/status`;
  const manifestsUrl = `${base}/status/manifests.json`;

  try {
    const jsonRes = await fetch(manifestsUrl, {
      headers: { Accept: "application/json" },
      next: { revalidate: 120 },
    });

    if (jsonRes.ok) {
      const raw = await jsonRes.json();
      const { sites, meta } = parseGatewayManifestsJson(raw, base);
      return NextResponse.json({
        pagesBase: base,
        statusUrl,
        manifestsUrl,
        source: "json" as const,
        sites,
        meta,
      });
    }

    const res = await fetch(statusUrl, {
      headers: { Accept: "text/html" },
      next: { revalidate: 120 },
    });

    if (!res.ok) {
      return NextResponse.json(
        {
          error: `Gateway returned ${res.status} (JSON and HTML status both failed)`,
          statusUrl,
          manifestsUrl,
        },
        { status: 502 }
      );
    }

    const html = await res.text();
    const sites = parseGatewayStatusHtml(html, base);
    const meta = parseGatewayStatusMeta(html);

    return NextResponse.json({
      pagesBase: base,
      statusUrl,
      manifestsUrl,
      source: "html" as const,
      sites,
      meta,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: message, statusUrl, manifestsUrl },
      { status: 500 }
    );
  }
}
