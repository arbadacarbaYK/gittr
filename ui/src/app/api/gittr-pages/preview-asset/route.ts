import { guessManifestFileContentType } from "@/lib/gittr-pages/blossom-upload-mime";
import { forgeRawFileHref } from "@/lib/gittr-pages/html-preview-base";
import { isGittrPagesManifestPath } from "@/lib/gittr-pages/pages-manifest-paths";
import { assertSafeOutboundGitUrl } from "@/lib/security/safe-remote-url";
import { normalizeGithubSourceUrl } from "@/lib/utils/normalize-github-source-url";

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BYTES = 2 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 20_000;

/**
 * Same-origin bytes for Code-tab HTML preview (srcDoc iframe).
 * GitHub raw CSS is text/plain + nosniff, so the iframe cannot load it
 * cross-origin; this re-serves with the real MIME under gittr.space CSP.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const sourceRaw = (url.searchParams.get("sourceUrl") || "").trim();
  const filePath = (url.searchParams.get("path") || "").trim();
  const branch = (url.searchParams.get("branch") || "main").trim() || "main";

  const sourceUrl = normalizeGithubSourceUrl(sourceRaw);
  if (!sourceUrl) {
    return NextResponse.json(
      { error: "sourceUrl is required" },
      { status: 400 }
    );
  }
  if (!filePath || filePath.includes("\0") || filePath.includes("..")) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }
  if (!isGittrPagesManifestPath(filePath)) {
    return NextResponse.json({ error: "path not allowed" }, { status: 400 });
  }

  const urlSafety = await assertSafeOutboundGitUrl(sourceUrl, {
    requireRepoPath: true,
  });
  if (!urlSafety.ok) {
    return NextResponse.json(
      { error: "sourceUrl blocked", details: urlSafety.error },
      { status: 400 }
    );
  }

  const upstreamUrl = forgeRawFileHref({
    sourceUrl,
    branch,
    filePath,
  });
  if (!upstreamUrl) {
    return NextResponse.json(
      { error: "unsupported forge for preview assets" },
      { status: 400 }
    );
  }

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(upstreamUrl, {
      signal: ac.signal,
      headers: { Accept: "*/*", "User-Agent": "gittr-pages-preview" },
      redirect: "follow",
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `upstream ${upstream.status}` },
        { status: upstream.status === 404 ? 404 : 502 }
      );
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length === 0) {
      return NextResponse.json({ error: "empty file" }, { status: 404 });
    }
    if (buf.length > MAX_BYTES) {
      return NextResponse.json({ error: "file too large" }, { status: 413 });
    }
    const contentType = guessManifestFileContentType(filePath);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=120, stale-while-revalidate=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "upstream fetch failed" },
      { status: 502 }
    );
  } finally {
    clearTimeout(t);
  }
}
