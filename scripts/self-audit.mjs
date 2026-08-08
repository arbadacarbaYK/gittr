#!/usr/bin/env node
/**
 * Uncapped OSV.dev audit of gittr's own dependency tree (ui/yarn.lock +
 * ui/gitnostr/go.mod). Prints affected packages, severity, and the minimum
 * fixed version per advisory so upgrades/resolutions can be planned.
 *
 * Usage: node scripts/self-audit.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseYarnLock(content) {
  const pkgs = new Map();
  const blocks = content.split(/\n(?=\S)/);
  for (const block of blocks) {
    const header = block.split("\n")[0] || "";
    const versionMatch = block.match(/\n\s+version:?\s+"?([^"\n]+)"?/);
    if (!versionMatch) continue;
    const first = header
      .split(",")[0]
      .trim()
      .replace(/:$/, "")
      .replace(/^"|"$/g, "");
    const at = first.lastIndexOf("@");
    const name = at > 0 ? first.slice(0, at) : first;
    if (!name) continue;
    pkgs.set(`npm|${name}|${versionMatch[1].trim()}`, {
      ecosystem: "npm",
      name,
      version: versionMatch[1].trim(),
    });
  }
  return [...pkgs.values()];
}

function parseGoMod(content) {
  const out = [];
  const re = /^\s*([\w./-]+\.[\w./-]+)\s+v(\d+\.\d+\.\d+[\w.+-]*)/;
  for (const line of content.split(/\r?\n/)) {
    const m = line.trim().match(re);
    if (m) out.push({ ecosystem: "Go", name: m[1], version: m[2] });
  }
  return out;
}

const packages = [
  ...parseYarnLock(readFileSync(join(root, "ui/yarn.lock"), "utf8")),
  ...parseGoMod(readFileSync(join(root, "ui/gitnostr/go.mod"), "utf8")),
];
console.log(`Scanning ${packages.length} packages against OSV.dev ...`);

const idToPkgs = new Map();
for (let i = 0; i < packages.length; i += 500) {
  const chunk = packages.slice(i, i + 500);
  const res = await fetch("https://api.osv.dev/v1/querybatch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      queries: chunk.map((p) => ({
        package: { ecosystem: p.ecosystem, name: p.name },
        version: p.version,
      })),
    }),
  });
  if (!res.ok) throw new Error(`OSV batch failed: ${res.status}`);
  const data = await res.json();
  data.results.forEach((r, j) => {
    for (const v of r?.vulns || []) {
      if (!idToPkgs.has(v.id)) idToPkgs.set(v.id, []);
      idToPkgs.get(v.id).push(chunk[j]);
    }
  });
}

function severityOf(vuln) {
  const db = String(vuln?.database_specific?.severity || "").toUpperCase();
  if (db) return db === "MEDIUM" ? "MODERATE" : db;
  for (const s of vuln?.severity || []) {
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

function fixedVersions(vuln, pkg) {
  const fixed = [];
  for (const aff of vuln?.affected || []) {
    if (aff?.package?.name !== pkg.name) continue;
    for (const range of aff?.ranges || []) {
      for (const ev of range?.events || []) {
        if (ev.fixed) fixed.push(ev.fixed);
      }
    }
  }
  return fixed;
}

const rows = [];
for (const [id, pkgs] of idToPkgs) {
  const res = await fetch(
    `https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`
  );
  if (!res.ok) continue;
  const vuln = await res.json();
  const sev = severityOf(vuln);
  const cve =
    (vuln.aliases || []).find((a) => a.startsWith("CVE-")) || id;
  for (const pkg of pkgs) {
    rows.push({
      sev,
      pkg: `${pkg.name}@${pkg.version}`,
      cve,
      id,
      fixed: fixedVersions(vuln, pkg).join(", ") || "none listed",
      summary: (vuln.summary || "").slice(0, 90),
    });
  }
}

const order = { CRITICAL: 0, HIGH: 1, MODERATE: 2, LOW: 3, UNKNOWN: 4 };
rows.sort((a, b) => order[a.sev] - order[b.sev] || a.pkg.localeCompare(b.pkg));
for (const r of rows) {
  console.log(
    `${r.sev.padEnd(9)} ${r.pkg}  fix>=${r.fixed}  ${r.cve}  ${r.summary}`
  );
}
const counts = rows.reduce((a, r) => ((a[r.sev] = (a[r.sev] || 0) + 1), a), {});
console.log("\nTotals:", JSON.stringify(counts));
