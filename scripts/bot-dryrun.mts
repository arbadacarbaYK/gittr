/**
 * Dry-run of the CVE-alert eligibility filter against real repos on
 * gittr.space. Uses the real manifest parser + the production audit API and
 * prints the issue each repo owner WOULD have received. Sends nothing.
 *
 * Bot eligibility: shared eligibleCveAdvisories() — confirmed (pinned, not
 * unfixable+UNKNOWN) + direct + CRITICAL/HIGH. Live publish is scripts/cve-bot.mts.
 *
 * Usage: npx tsx scripts/bot-dryrun.mts
 */

import {
  type ManifestPackage,
  isManifestPath,
  mergeManifestPackages,
  parseManifest,
} from "../ui/src/lib/security/dependency-manifest-parser";
import {
  eligibleCveAdvisories,
  isConfirmedAdvisory,
} from "../ui/src/lib/security/cve-eligibility";
import { formatCveIssueBody } from "../ui/src/lib/security/cve-issue-format";

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
  { owner: "9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c", repo: "pyramid", label: "pyramid (ours, relay)" },
  { owner: "9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c", repo: "gittr-mcp", label: "gittr-mcp (ours)" },
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
  const { title, description } = formatCveIssueBody(
    repoLabel,
    "dry-run",
    eligible
  );
  return `Title: ${title}\n\n${description}`;
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

  const confirmed = advisories.filter((a) =>
    isConfirmedAdvisory({
      id: a.id,
      severity: a.severity,
      precision: a.precision,
      direct: a.direct,
      unfixable: (a as { unfixable?: boolean }).unfixable,
      package: a.package,
    })
  );
  const unconfirmed = advisories.length - confirmed.length;
  const counts: Record<string, number> = {};
  for (const a of confirmed) counts[a.severity] = (counts[a.severity] || 0) + 1;
  console.log(
    `  badge: confirmed=${confirmed.length} ${JSON.stringify(counts)} | unconfirmed(range-min, collapsed)=${unconfirmed}`
  );

  // Bot rules: shared eligibleCveAdvisories (confirmed + direct + CRITICAL/HIGH)
  const eligible = eligibleCveAdvisories(
    advisories.map((a) => ({
      ...a,
      unfixable: (a as { unfixable?: boolean }).unfixable,
    }))
  );

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
