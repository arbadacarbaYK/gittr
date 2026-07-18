/**
 * Smoke-test C4 overview generation against public GitHub trees.
 * Usage: node scripts/test-architecture-overview.mjs
 */
import { createRequire } from "module";

// Compile-free: duplicate minimal call via tsx if available, else dynamic import of built path.
// Prefer running through npx tsx for TypeScript source.
const repos = [
  { owner: "arbadacarbaYK", name: "gittr", branch: "main" },
  { owner: "arbadacarbaYK", name: "gitnostr", branch: "main" },
  { owner: "likec4", name: "likec4", branch: "main" },
];

async function fetchTree(owner, name, branch) {
  const url = `https://api.github.com/repos/${owner}/${name}/git/trees/${encodeURIComponent(
    branch
  )}?recursive=1`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "gittr-architecture-test",
      Accept: "application/vnd.github.v3+json",
    },
  });
  if (!res.ok) {
    throw new Error(`${owner}/${name}: HTTP ${res.status}`);
  }
  const data = await res.json();
  return (data.tree || [])
    .filter((n) => n.type === "blob")
    .map((n) => ({ type: "file", path: n.path }));
}

async function main() {
  const { generateArchitectureDiagram } = await import(
    "../src/lib/utils/architecture-generator.ts"
  ).catch(async () => {
    // Fallback: register ts via tsx loader suggestion
    console.error(
      "Direct TS import failed. Run: npx tsx scripts/test-architecture-overview.mjs"
    );
    process.exit(1);
  });

  for (const r of repos) {
    process.stdout.write(`\n=== ${r.owner}/${r.name} ===\n`);
    try {
      const files = await fetchTree(r.owner, r.name, r.branch);
      const diagram = generateArchitectureDiagram(files, "overview", r.name);
      const nodes = (diagram.match(/C_\w+/g) || []).length;
      const edges = (diagram.match(/-->/g) || []).length;
      console.log(`files: ${files.length}`);
      console.log(`container refs: ${nodes}, edges: ${edges}`);
      console.log("--- diagram ---");
      console.log(diagram);
      if (!diagram.includes("Users") || !diagram.includes("subgraph System")) {
        console.error("FAIL: missing Users/System boundary");
        process.exitCode = 1;
      }
      if (diagram.includes("F_empty") || /F_\w+\[/.test(diagram)) {
        // detailed-style file dump would look like this — overview must not
      }
      // Overview should not list dozens of individual filenames as nodes
      const labeledNodes = (diagram.match(/^\s+\w+\["/gm) || []).length;
      if (labeledNodes > 12) {
        console.error(
          `FAIL: too many nodes (${labeledNodes}) — looks like file dump`
        );
        process.exitCode = 1;
      } else {
        console.log(`OK: calm overview (${labeledNodes} labeled nodes)`);
      }
    } catch (e) {
      console.error("ERROR:", e.message || e);
      process.exitCode = 1;
    }
  }
}

main();
