import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import { resolveLabSnapshotHtmlPath } from "@/lib/lab/lab-snapshot-path";
import { sanitizeLabSnapshotHtml } from "@/lib/lab/sanitize-lab-snapshot-html";

import { existsSync, readFileSync, statSync } from "fs";
import type { NextApiRequest, NextApiResponse } from "next";

/**
 * GET /api/lab/snapshot
 * Read-only serve of scrubbed HTML on disk (scp via push-lab-snapshot.sh).
 * Does not proxy to any localhost dashboard. Sanitizes before return.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  setCorsHeaders(res, req);
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res, req);
    return;
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const filePath = resolveLabSnapshotHtmlPath();
  if (!existsSync(filePath)) {
    return res.status(404).json({
      error: "No lab snapshot on this server yet",
      hint: "Push scrubbed HTML with scripts/push-lab-snapshot.sh",
    });
  }

  let raw: string;
  let updatedAt: string;
  try {
    raw = readFileSync(filePath, "utf8");
    updatedAt = statSync(filePath).mtime.toISOString();
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Failed to read snapshot",
    });
  }

  if (!raw.trim()) {
    return res.status(404).json({ error: "Lab snapshot file is empty" });
  }

  const html = sanitizeLabSnapshotHtml(raw);

  res.setHeader(
    "Cache-Control",
    "public, max-age=60, stale-while-revalidate=300"
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Allow /lab same-origin iframe (global/nginx may send DENY).
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  // Snapshot is display-only; never treat as an active app context.
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline' data:; font-src data: https:; script-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
  );

  const format = String(req.query.format || "").toLowerCase();
  if (format === "json") {
    return res.status(200).json({
      html,
      updatedAt,
    });
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(html);
}
