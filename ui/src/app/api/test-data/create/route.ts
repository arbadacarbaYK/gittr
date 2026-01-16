import { NextResponse } from "next/server";

/**
 * API endpoint to create test data for issues, PRs, and bounties
 * POST /api/test-data/create
 */
export async function POST() {
  try {
    // This endpoint just returns instructions for creating test data
    // Actual data creation must happen in the browser (client-side)
    // since we need access to localStorage

    return NextResponse.json({
      success: true,
      message: "Test data script available. Run it in browser console.",
      script: `
// Run this in browser console:
const testPubkey = "9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c";
const testRepo = { entity: testPubkey.slice(0, 8), repo: "test-repo" };

// Create repo
let repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
if (!repos.find(r => r.entity === testRepo.entity && r.repo === testRepo.repo)) {
  repos.push({ ...testRepo, ownerPubkey: testPubkey, defaultBranch: "main", branches: ["main", "dev"], tags: ["v1.0.0"], description: "Test repo", createdAt: Date.now(), contributors: [{ pubkey: testPubkey, weight: 100 }] });
  localStorage.setItem("gittr_repos", JSON.stringify(repos));
}

// Create issues with bounties
const issuesKey = \`gittr_issues__\${testRepo.entity}__\${testRepo.repo}\`;
const testIssues = [
  { id: "issue-1", entity: testRepo.entity, repo: testRepo.repo, title: "Fix critical bug in authentication", description: "Users cannot log in after the latest update.", status: "open", author: testPubkey, createdAt: Date.now() - 172800000, number: "1", labels: ["bug", "critical"], assignees: [], bountyAmount: 50000, bountyStatus: "paid", bountyInvoice: "lnbc500u1..." },
  { id: "issue-2", entity: testRepo.entity, repo: testRepo.repo, title: "Add dark mode support", description: "Users have been requesting dark mode.", status: "open", author: testPubkey, createdAt: Date.now() - 432000000, number: "2", labels: ["enhancement", "ui"], assignees: [], bountyAmount: 100000, bountyStatus: "pending", bountyInvoice: "lnbc1000u1..." },
  { id: "issue-3", entity: testRepo.entity, repo: testRepo.repo, title: "Improve documentation", description: "The README is outdated.", status: "open", author: testPubkey, createdAt: Date.now() - 86400000, number: "3", labels: ["documentation"], assignees: [] },
  { id: "issue-4", entity: testRepo.entity, repo: testRepo.repo, title: "Performance optimization", description: "App is slow on mobile.", status: "closed", author: testPubkey, createdAt: Date.now() - 864000000, closedAt: Date.now() - 259200000, number: "4", labels: ["performance"], assignees: [], bountyAmount: 25000, bountyStatus: "released" }
];
localStorage.setItem(issuesKey, JSON.stringify(testIssues));

// Create PRs
const prsKey = \`gittr_prs__\${testRepo.entity}__\${testRepo.repo}\`;
const testPRs = [
  { id: "pr-1", title: "Add new feature: User profiles", body: "Complete user profile system", status: "open", author: testPubkey, createdAt: Date.now() - 86400000, baseBranch: "main", headBranch: "feature/profiles", changedFiles: [{ path: "src/components/Profile.tsx", status: "added", after: "export function Profile() { return <div>Profile</div>; }" }], contributors: [testPubkey], linkedIssue: "1" },
  { id: "pr-2", title: "Fix authentication bug", body: "Fixes the critical authentication issue #1", status: "open", author: testPubkey, createdAt: Date.now() - 43200000, baseBranch: "main", headBranch: "fix/auth-bug", changedFiles: [{ path: "src/auth.ts", status: "modified", before: "if (!user) return;", after: "if (!user || !user.verified) return;" }], contributors: [testPubkey], linkedIssue: "1" },
  { id: "pr-3", title: "Update README documentation", body: "Updates the README", status: "merged", author: testPubkey, createdAt: Date.now() - 604800000, mergedAt: Date.now() - 518400000, mergedBy: testPubkey, baseBranch: "main", headBranch: "docs/readme", changedFiles: [{ path: "README.md", status: "modified", before: "# Old", after: "# New" }], contributors: [testPubkey] },
  { id: "pr-4", title: "Performance improvements", body: "Various optimizations", status: "closed", author: testPubkey, createdAt: Date.now() - 777600000, baseBranch: "main", headBranch: "perf/mobile", changedFiles: [{ path: "src/utils/render.ts", status: "modified", before: "renderSlow()", after: "renderFast()" }], contributors: [testPubkey], linkedIssue: "4" }
];
localStorage.setItem(prsKey, JSON.stringify(testPRs));

window.dispatchEvent(new CustomEvent("gittr:issue-created"));
window.dispatchEvent(new CustomEvent("gittr:pr-created"));

alert("✅ Test data created! Refresh the page.");
      `.trim(),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
