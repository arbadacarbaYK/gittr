import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Vulnerability audit via OSV.dev (free, no key). Client sends the packages it
 * parsed from a repo's manifests; we batch-query OSV, fetch advisory details,
 * and return a normalized list. No DMs here — this only powers the on-page
 * security badge (Phase 1).
 */

type IncomingPackage = {
  ecosystem: string;
  name: string;
  version: string;
  direct?: boolean;
  precision?: "pinned" | "range-min";
};

type Advisory = {
  id: string;
  aliases: string[];
  summary: string;
  severity: "CRITICAL" | "HIGH" | "MODERATE" | "LOW" | "UNKNOWN";
  url: string;
  package: { ecosystem: string; name: string; version: string };
  direct: boolean;
  precision: "pinned" | "range-min";
  /**
   * True when no OSV range has a "fixed" event — no release ever fixes it
   * (e.g. GO-2026-5932 "x/crypto/openpgp is unmaintained" flags every version
   * forever). Unfixable + UNKNOWN severity is treated as informational by the
   * UI: no version bump can clear it, so it must not read as an alarm.
   */
  unfixable: boolean;
};

const OSV_BATCH_URL = "https://api.osv.dev/v1/querybatch";
const OSV_VULN_URL = "https://api.osv.dev/v1/vulns/";
const MAX_PACKAGES = 800;
const MAX_DETAIL_FETCHES = 250;
const DETAIL_TTL_MS = 6 * 60 * 60 * 1000; // 6h

const detailCache = new Map<
  string,
  { at: number; value: NormalizedVuln | null }
>();

type NormalizedVuln = {
  id: string;
  aliases: string[];
  summary: string;
  severity: Advisory["severity"];
  url: string;
  unfixable: boolean;
};

function hasAnyFixEvent(vuln: any): boolean {
  const affected = Array.isArray(vuln?.affected) ? vuln.affected : [];
  for (const a of affected) {
    const ranges = Array.isArray(a?.ranges) ? a.ranges : [];
    for (const r of ranges) {
      const events = Array.isArray(r?.events) ? r.events : [];
      if (events.some((e: any) => typeof e?.fixed === "string")) return true;
    }
    // Some ecosystems publish fixes via versions list absence — treat an
    // explicit last_affected as "bounded" (a fix exists beyond it).
    const bounded = (Array.isArray(a?.ranges) ? a.ranges : []).some(
      (r: any) =>
        Array.isArray(r?.events) &&
        r.events.some((e: any) => typeof e?.last_affected === "string")
    );
    if (bounded) return true;
  }
  return false;
}

const ALLOWED_ECOSYSTEMS = new Set([
  "npm",
  "PyPI",
  "Go",
  "crates.io",
  "RubyGems",
  "Packagist",
  "Maven",
]);

function normalizeSeverity(vuln: any): Advisory["severity"] {
  const dbSev = String(
    vuln?.database_specific?.severity || ""
  ).toUpperCase();
  if (dbSev.includes("CRIT")) return "CRITICAL";
  if (dbSev === "HIGH") return "HIGH";
  if (dbSev === "MODERATE" || dbSev === "MEDIUM") return "MODERATE";
  if (dbSev === "LOW") return "LOW";
  // Fall back to CVSS base score parsed from the vector's numeric score, if any
  const sev = Array.isArray(vuln?.severity) ? vuln.severity : [];
  for (const s of sev) {
    const score = Number(s?.score);
    if (!Number.isNaN(score)) {
      if (score >= 9) return "CRITICAL";
      if (score >= 7) return "HIGH";
      if (score >= 4) return "MODERATE";
      if (score > 0) return "LOW";
    }
  }
  return "UNKNOWN";
}

function pickUrl(vuln: any, id: string): string {
  const refs = Array.isArray(vuln?.references) ? vuln.references : [];
  const advisory = refs.find(
    (r: any) => r?.type === "ADVISORY" && typeof r?.url === "string"
  );
  if (advisory?.url) return advisory.url;
  return `https://osv.dev/vulnerability/${encodeURIComponent(id)}`;
}

async function fetchVulnDetail(id: string): Promise<NormalizedVuln | null> {
  const cached = detailCache.get(id);
  if (cached && Date.now() - cached.at < DETAIL_TTL_MS) {
    return cached.value;
  }
  try {
    const res = await fetch(`${OSV_VULN_URL}${encodeURIComponent(id)}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      detailCache.set(id, { at: Date.now(), value: null });
      return null;
    }
    const vuln = await res.json();
    const normalized: NormalizedVuln = {
      id,
      aliases: Array.isArray(vuln?.aliases)
        ? vuln.aliases.filter((a: unknown) => typeof a === "string")
        : [],
      summary:
        (typeof vuln?.summary === "string" && vuln.summary) ||
        (typeof vuln?.details === "string" && vuln.details.slice(0, 200)) ||
        "Known vulnerability",
      severity: normalizeSeverity(vuln),
      url: pickUrl(vuln, id),
      unfixable: !hasAnyFixEvent(vuln),
    };
    detailCache.set(id, { at: Date.now(), value: normalized });
    return normalized;
  } catch {
    return null;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res, req);
    return;
  }
  setCorsHeaders(res, req);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const body = req.body || {};
  const rawPackages: IncomingPackage[] = Array.isArray(body.packages)
    ? body.packages
    : [];

  const packages = rawPackages
    .filter(
      (p) =>
        p &&
        ALLOWED_ECOSYSTEMS.has(p.ecosystem) &&
        typeof p.name === "string" &&
        p.name.length > 0 &&
        p.name.length < 256 &&
        typeof p.version === "string" &&
        p.version.length > 0 &&
        p.version.length < 128
    )
    .slice(0, MAX_PACKAGES);

  if (packages.length === 0) {
    return res
      .status(200)
      .json({ advisories: [], scanned: 0, source: "osv.dev" });
  }

  try {
    const batchRes = await fetch(OSV_BATCH_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        queries: packages.map((p) => ({
          package: { ecosystem: p.ecosystem, name: p.name },
          version: p.version,
        })),
      }),
    });
    if (!batchRes.ok) {
      return res
        .status(502)
        .json({ error: "osv_batch_failed", status: batchRes.status });
    }
    const batch = await batchRes.json();
    const results: Array<{ vulns?: Array<{ id: string }> }> = Array.isArray(
      batch?.results
    )
      ? batch.results
      : [];

    // Collect unique vuln ids while remembering which package each maps to
    const idToPackages = new Map<string, IncomingPackage[]>();
    results.forEach((result, i) => {
      const pkg = packages[i];
      if (!pkg || !Array.isArray(result?.vulns)) return;
      for (const v of result.vulns) {
        if (!v?.id) continue;
        const arr = idToPackages.get(v.id) || [];
        arr.push(pkg);
        idToPackages.set(v.id, arr);
      }
    });

    const uniqueIds = Array.from(idToPackages.keys()).slice(
      0,
      MAX_DETAIL_FETCHES
    );
    const details = await Promise.all(uniqueIds.map(fetchVulnDetail));

    const advisories: Advisory[] = [];
    details.forEach((detail, i) => {
      if (!detail) return;
      const id = uniqueIds[i]!;
      for (const pkg of idToPackages.get(id) || []) {
        advisories.push({
          id: detail.id,
          aliases: detail.aliases,
          summary: detail.summary,
          severity: detail.severity,
          url: detail.url,
          package: {
            ecosystem: pkg.ecosystem,
            name: pkg.name,
            version: pkg.version,
          },
          direct: !!pkg.direct,
          precision: pkg.precision === "pinned" ? "pinned" : "range-min",
          unfixable: detail.unfixable,
        });
      }
    });

    const severityRank = {
      CRITICAL: 0,
      HIGH: 1,
      MODERATE: 2,
      LOW: 3,
      UNKNOWN: 4,
    } as const;
    advisories.sort(
      (a, b) =>
        severityRank[a.severity] - severityRank[b.severity] ||
        Number(b.direct) - Number(a.direct) ||
        a.package.name.localeCompare(b.package.name)
    );

    return res.status(200).json({
      advisories,
      scanned: packages.length,
      affectedPackages: new Set(advisories.map((a) => a.package.name)).size,
      source: "osv.dev",
    });
  } catch (error: any) {
    return res.status(500).json({
      error: "audit_failed",
      message: error?.message || "unknown",
    });
  }
}
