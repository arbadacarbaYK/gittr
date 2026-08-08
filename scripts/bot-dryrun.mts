/**
 * Dry-run of the (not yet live) CVE-alert bot against real repos on
 * gittr.space. Uses the real manifest parser + the production audit API and
 * prints the issue each repo owner WOULD have received. Sends nothing.
 *
 * Bot eligibility rules (per docs/SETUP_INSTRUCTIONS.md): confirmed only
 * (lockfile-pinned version inside affected range), direct dependencies only,
 * CRITICAL/HIGH only, deduped per advisory+repo.
 *
 * Usage: npx tsx scripts/bot-dryrun.ts
 */

import {
  type ManifestPackage,
  isManifestPath,
  mergeManifestPackages,
  parseManifest,
} from "../ui/src/lib/security/dependency-manifest-parser";

const BASE = process.env.GITTR_BASE || "https://gittr.space";

const REPOS: Array<{ owner: string; repo: string; label: string }> = [
  // Shakespeare-generated JS repos (various ages)
  { owner: "0461fcbecc4c3374439932d6b8f11269ccdb7cc973ad7a50ae362db135a474dd", repo: "armada", label: "armada" },
  { owner: "0461fcbecc4c3374439932d6b8f11269ccdb7cc973ad7a50ae362db135a474dd", repo: "mkstack", label: "mkstack" },
  { owner: "0461fcbecc4c3374439932d6b8f11269ccdb7cc973ad7a50ae362db135a474dd", repo: "din", label: "din" },
  { owner: "0461fcbecc4c3374439932d6b8f11269ccdb7cc973ad7a50ae362db135a474dd", repo: "lovable-blank", label: "lovable-blank (old, 2025-03)" },
  { owner: "03b8a3aba225414032d6058c8e1b07c0c01fbeacc0f889b88fd77a5edbaa14ee", repo: "nostr-0-git", label: "nostr-0-git" },
  { owner: "0057059046164d2238bbdbdf45fa2e106f59188289f6842d6bf362218ef4a58c", repo: "routstrd", label: "routstrd" },
  // Our own (known-clean after today's fixes)
  { owner: "9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c", repo: "gittr", label: "gittr (ours, fixed today)" },
  { owner: "9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c", repo: "gitnostr", label: "gitnostr (ours, Go)" },
];

type Advisory = {
  id: string;
  aliases: string[];
  summary: string;
  severity: string;
  url: string;
  package: { ecosystem: string; name: string; version: string };
  direct: boolean;
  precision: string;
};

async function getJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function botIssueMessage(repoLabel: string, eligible: Advisory[]): string {
  const lines: string[] = [];
  lines.push(`Title: [security] ${eligible.length} known ${eligible.length === 1 ? "vulnerability" : "vulnerabilities"} in pinned dependencies`);
  lines.push("");
  lines.push(
    "Automated dependency audit (OSV.dev). Exact versions from this repo's committed lockfiles fall inside the affected range of published advisories:"
  );
  lines.push("");
  for (const a of eligible) {
    const cve = a.aliases.find((x) => x.startsWith("CVE-")) || a.id;
    lines.push(
      `- ${a.severity}: ${a.package.name}@${a.package.version} — ${a.summary} (${cve}, ${a.url})`
    );
  }
  lines.push("");
  lines.push(
    "Fix: update the listed packages to a version outside the affected range and re-run the audit on your Dependencies tab. This issue was opened by the gittr platform bot; disable these alerts in Settings → Notifications → Security."
  );
  return lines.join("\n");
}

for (const target of REPOS) {
  console.log(`\n===== ${target.label} =====`);
  let branch = "main";
  let files: Array<{ path: string }> | null = null;
  for (const b of ["main", "master"]) {
    const data = await getJson(
      `${BASE}/api/nostr/repo/files?ownerPubkey=${target.owner}&repo=${encodeURIComponent(target.repo)}&branch=${b}`
    );
    if (Array.isArray(data?.files) && data.files.length > 0) {
      files = data.files;
      branch = b;
      break;
    }
  }
  if (!files) {
    console.log("  no file listing (bridge has no content) — bot would NOT alert");
    continue;
  }

  const manifests = files
    .map((f) => f.path)
    .filter((p) => typeof p === "string" && isManifestPath(p))
    .slice(0, 12);
  if (manifests.length === 0) {
    console.log(`  ${files.length} files, no supported manifests — bot would NOT alert`);
    continue;
  }

  const groups: ManifestPackage[][] = [];
  for (const path of manifests) {
    const data = await getJson(
      `${BASE}/api/nostr/repo/file-content?ownerPubkey=${target.owner}&repo=${encodeURIComponent(target.repo)}&path=${encodeURIComponent(path)}&branch=${branch}`
    );
    if (typeof data?.content === "string") {
      groups.push(parseManifest(path, data.content));
    }
  }
  const packages = mergeManifestPackages(groups);
  console.log(`  branch=${branch} manifests=[${manifests.join(", ")}] packages=${packages.length}`);
  if (packages.length === 0) {
    console.log("  nothing version-checkable — bot would NOT alert");
    continue;
  }

  const res = await fetch(`${BASE}/api/security/audit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ packages }),
  });
  if (!res.ok) {
    console.log(`  audit API error ${res.status}`);
    continue;
  }
  const { advisories = [] } = (await res.json()) as { advisories: Advisory[] };

  const confirmed = advisories.filter((a) => a.precision === "pinned");
  const unconfirmed = advisories.length - confirmed.length;
  const counts: Record<string, number> = {};
  for (const a of confirmed) counts[a.severity] = (counts[a.severity] || 0) + 1;
  console.log(
    `  badge: confirmed=${confirmed.length} ${JSON.stringify(counts)} | unconfirmed(range-min, collapsed)=${unconfirmed}`
  );

  // Bot rules: confirmed + direct + CRITICAL/HIGH, dedupe per advisory+package
  const seen = new Set<string>();
  const eligible = confirmed.filter((a) => {
    if (!a.direct) return false;
    if (a.severity !== "CRITICAL" && a.severity !== "HIGH") return false;
    const key = `${a.id}|${a.package.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (eligible.length === 0) {
    console.log("  bot would NOT alert (no direct+pinned critical/high)");
  } else {
    console.log(`  bot WOULD open 1 issue with ${eligible.length} item(s):`);
    console.log(
      botIssueMessage(target.label, eligible)
        .split("\n")
        .map((l) => `    | ${l}`)
        .join("\n")
    );
  }
}
console.log("\nDry run complete — nothing was sent or opened.");
