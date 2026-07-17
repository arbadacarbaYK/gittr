import {
  DEFAULT_WOT_MAX_HOPS,
  DEFAULT_WOT_ORACLE_URL,
  type WoTOracleDistanceResponse,
  hopsFromOracleBody,
  normalizeHexPubkey,
} from "@/lib/nostr/wot";

import type { NextApiRequest, NextApiResponse } from "next";

const ORACLE_URL = process.env.WOT_ORACLE_URL?.trim() || DEFAULT_WOT_ORACLE_URL;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const from = normalizeHexPubkey(
    typeof req.query.from === "string" ? req.query.from : null
  );
  const to = normalizeHexPubkey(
    typeof req.query.to === "string" ? req.query.to : null
  );

  if (!from || !to) {
    return res.status(400).json({ error: "Invalid from or to pubkey" });
  }

  const maxHopsRaw =
    typeof req.query.max_hops === "string"
      ? parseInt(req.query.max_hops, 10)
      : DEFAULT_WOT_MAX_HOPS;
  const maxHops = Number.isFinite(maxHopsRaw)
    ? Math.min(10, Math.max(1, maxHopsRaw))
    : DEFAULT_WOT_MAX_HOPS;

  const url = new URL(
    "/distance",
    ORACLE_URL.endsWith("/") ? ORACLE_URL : `${ORACLE_URL}/`
  );
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  url.searchParams.set("max_hops", String(maxHops));

  try {
    const upstream = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      return res.status(502).json({
        error: "WoT oracle unavailable",
        detail: text.slice(0, 200),
      });
    }

    const body = (await upstream.json()) as WoTOracleDistanceResponse;
    const hops = hopsFromOracleBody(body);

    return res.status(200).json({
      from,
      to,
      hops,
      distance: hops,
      mutual_follow: Boolean(body.mutual_follow ?? body.mutual),
      path_count: body.path_count ?? body.paths ?? undefined,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "fetch failed";
    return res
      .status(502)
      .json({ error: "WoT oracle fetch failed", detail: message });
  }
}
