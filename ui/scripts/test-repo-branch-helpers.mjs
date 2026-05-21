/**
 * Run: cd ui && node scripts/test-repo-branch-helpers.mjs
 */
import assert from "node:assert/strict";

// Inline mirror of repo-file-tree-branch.ts (node cannot import .ts without build)
const BOT_BRANCH_RE = /^(dependabot|renovate)\//i;
function isBotFeatureBranch(name) {
  return BOT_BRANCH_RE.test((name || "").trim());
}
function sanitizeRepoDefaultBranch(defaultBranch, branches) {
  const d = (defaultBranch || "").trim() || "main";
  if (!isBotFeatureBranch(d)) return d;
  const list = (branches || []).map((b) => (b || "").trim()).filter(Boolean);
  if (list.includes("main")) return "main";
  if (list.includes("master")) return "master";
  const canonical = list.find((b) => !isBotFeatureBranch(b));
  return canonical || "main";
}
function repoDefaultBranch(repo) {
  return sanitizeRepoDefaultBranch(
    (repo?.defaultBranch || "").trim() || "main",
    repo?.branches
  );
}
function resolveNip34HeadBranchName(refs, preferredBranch) {
  const heads = refs
    .filter((r) => r.ref?.startsWith("refs/heads/"))
    .map((r) => ({
      branch: r.ref.replace(/^refs\/heads\//i, ""),
      commit: (r.commit || "").trim(),
    }));
  const pref = (preferredBranch || "").trim().toLowerCase();
  if (pref) {
    const exact = heads.find((h) => h.branch.toLowerCase() === pref);
    if (exact) return exact.branch;
  }
  for (const canonical of ["main", "master"]) {
    const match = heads.find(
      (h) => h.branch.toLowerCase() === canonical && h.commit.length > 0
    );
    if (match) return match.branch;
  }
  const withCommit = heads.find(
    (h) => h.commit.length > 0 && !isBotFeatureBranch(h.branch)
  );
  if (withCommit) return withCommit.branch;
  return heads[0]?.branch || "main";
}
function resolveSharedRepoBranch(searchParams, repo) {
  const fromUrl = searchParams?.get("branch")?.trim();
  if (fromUrl && !isBotFeatureBranch(fromUrl)) return fromUrl;
  return repoDefaultBranch(repo);
}
function shouldSyncBranchFromFetch(resolved, repoDefault, current, userPicked) {
  const b = (resolved || "").trim();
  if (!b) return false;
  const def = (repoDefault || "main").trim();
  const cur = (current || "").trim();
  if (userPicked) return b === cur;
  if (b !== def) return false;
  return !cur || cur === def;
}

const repo = { defaultBranch: "main" };
assert.equal(resolveSharedRepoBranch(null, repo), "main");
assert.equal(
  resolveSharedRepoBranch({ get: () => "dependabot/npm_and_yarn/ui/next-14.2.32" }, repo),
  "main",
  "ignore dependabot in URL for shared tabs"
);
assert.equal(
  resolveSharedRepoBranch({ get: () => "main" }, repo),
  "main"
);

assert.equal(
  shouldSyncBranchFromFetch("dependabot/x", "main", "", false),
  false,
  "must not auto-select dependabot"
);
assert.equal(
  shouldSyncBranchFromFetch("main", "main", "", false),
  true,
  "may select default on empty selection"
);
assert.equal(
  shouldSyncBranchFromFetch("dependabot/x", "main", "dependabot/x", true),
  true,
  "user-picked branch honored"
);

assert.equal(
  sanitizeRepoDefaultBranch("dependabot/npm/foo", ["main", "dependabot/npm/foo"]),
  "main"
);
assert.equal(
  resolveNip34HeadBranchName(
    [
      { ref: "refs/heads/dependabot/x", commit: "abc" },
      { ref: "refs/heads/main", commit: "def" },
    ],
    "main"
  ),
  "main"
);
assert.equal(
  resolveNip34HeadBranchName(
    [
      { ref: "refs/heads/dependabot/x", commit: "abc" },
      { ref: "refs/heads/main", commit: "def" },
    ],
    null
  ),
  "main",
  "prefer main over first dependabot ref"
);

console.log("✅ repo branch helper tests passed");
