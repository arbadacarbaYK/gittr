// Script to create test data for issues, PRs, and bounties
// Run in browser console or via Node

const testPubkey = "9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c";
const testRepo = {
  entity: testPubkey.slice(0, 8),
  repo: "test-repo",
  entityDisplayName: "Test User"
};

// Load existing repos or create test repo
let repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
let existingRepo = repos.find(r => r.entity === testRepo.entity && r.repo === testRepo.repo);
if (!existingRepo) {
  repos.push({
    ...testRepo,
    ownerPubkey: testPubkey,
    defaultBranch: "main",
    branches: ["main", "dev", "feature/new-feature"],
    tags: ["v1.0.0", "v1.1.0", "v2.0.0-beta"],
    description: "Test repository for issues, PRs, and bounties",
    createdAt: Date.now() - 86400000 * 7, // 7 days ago
    contributors: [{
      pubkey: testPubkey,
      weight: 100,
      name: "Test User"
    }]
  });
  localStorage.setItem("gittr_repos", JSON.stringify(repos));
  console.log("✅ Created test repo");
}

// Create test issues with bounties
const issuesKey = `gittr_issues__${testRepo.entity}__${testRepo.repo}`;
const testIssues = [
  {
    id: `issue-${Date.now()}-1`,
    entity: testRepo.entity,
    repo: testRepo.repo,
    title: "Fix critical bug in authentication",
    description: "Users cannot log in after the latest update. This is blocking all users.",
    status: "open",
    author: testPubkey,
    createdAt: Date.now() - 86400000 * 2, // 2 days ago
    number: "1",
    labels: ["bug", "critical", "authentication"],
    assignees: [],
    bountyAmount: 10, // 10 sats for testing
    bountyStatus: "paid",
    bountyInvoice: "lnbc10u1...",
    bountyPaymentHash: "abc123..."
  },
  {
    id: `issue-${Date.now()}-2`,
    entity: testRepo.entity,
    repo: testRepo.repo,
    title: "Add dark mode support",
    description: "Users have been requesting dark mode for a while. This would improve UX significantly.",
    status: "open",
    author: testPubkey,
    createdAt: Date.now() - 86400000 * 5, // 5 days ago
    number: "2",
    labels: ["enhancement", "ui"],
    assignees: [],
    bountyAmount: 10, // 10 sats for testing
    bountyStatus: "pending",
    bountyInvoice: "lnbc10u1...",
    bountyPaymentHash: null
  },
  {
    id: `issue-${Date.now()}-3`,
    entity: testRepo.entity,
    repo: testRepo.repo,
    title: "Improve documentation",
    description: "The README is outdated and doesn't cover the new features.",
    status: "open",
    author: testPubkey,
    createdAt: Date.now() - 86400000, // 1 day ago
    number: "3",
    labels: ["documentation"],
    assignees: [],
    // No bounty
  },
  {
    id: `issue-${Date.now()}-4`,
    entity: testRepo.entity,
    repo: testRepo.repo,
    title: "Performance optimization needed",
    description: "The app is slow on mobile devices. Need to optimize rendering.",
    status: "closed",
    author: testPubkey,
    createdAt: Date.now() - 86400000 * 10, // 10 days ago
    closedAt: Date.now() - 86400000 * 3, // 3 days ago
    number: "4",
    labels: ["performance", "mobile"],
    assignees: [],
    bountyAmount: 10,
    bountyStatus: "released",
  }
];

localStorage.setItem(issuesKey, JSON.stringify(testIssues));
console.log(`✅ Created ${testIssues.length} test issues`);

// Create test PRs
const prsKey = `gittr_prs__${testRepo.entity}__${testRepo.repo}`;
const testPRs = [
  {
    id: `pr-${Date.now()}-1`,
    title: "Add new feature: User profiles",
    body: "This PR adds a complete user profile system with avatars, bios, and preferences.",
    status: "open",
    author: testPubkey,
    createdAt: Date.now() - 86400000, // 1 day ago
    baseBranch: "main",
    headBranch: "feature/user-profiles",
    changedFiles: [
      {
        path: "src/components/Profile.tsx",
        status: "added",
        after: "export function Profile() { return <div>Profile</div>; }"
      },
      {
        path: "src/routes/profile.ts",
        status: "added",
        after: "export const profileRoutes = []"
      }
    ],
    contributors: [testPubkey],
    linkedIssue: "1"
  },
  {
    id: `pr-${Date.now()}-2`,
    title: "Fix authentication bug",
    body: "Fixes the critical authentication issue reported in #1",
    status: "open",
    author: testPubkey,
    createdAt: Date.now() - 86400000 * 0.5, // 12 hours ago
    baseBranch: "main",
    headBranch: "fix/auth-bug",
    changedFiles: [
      {
        path: "src/auth.ts",
        status: "modified",
        before: "if (!user) return;",
        after: "if (!user || !user.verified) return;"
      }
    ],
    contributors: [testPubkey],
    linkedIssue: "1"
  },
  {
    id: `pr-${Date.now()}-3`,
    title: "Update README documentation",
    body: "Updates the README with current features and setup instructions.",
    status: "merged",
    author: testPubkey,
    createdAt: Date.now() - 86400000 * 7, // 7 days ago
    mergedAt: Date.now() - 86400000 * 6, // 6 days ago
    mergedBy: testPubkey,
    baseBranch: "main",
    headBranch: "docs/update-readme",
    changedFiles: [
      {
        path: "README.md",
        status: "modified",
        before: "# Old README",
        after: "# New Updated README\n\nWith all the latest features..."
      }
    ],
    contributors: [testPubkey]
  },
  {
    id: `pr-${Date.now()}-4`,
    title: "Performance improvements",
    body: "Various performance optimizations for mobile devices.",
    status: "closed",
    author: testPubkey,
    createdAt: Date.now() - 86400000 * 9, // 9 days ago
    baseBranch: "main",
    headBranch: "perf/mobile-optimization",
    changedFiles: [
      {
        path: "src/utils/render.ts",
        status: "modified",
        before: "renderSlow()",
        after: "renderFast()"
      }
    ],
    contributors: [testPubkey],
    linkedIssue: "4"
  }
];

localStorage.setItem(prsKey, JSON.stringify(testPRs));
console.log(`✅ Created ${testPRs.length} test PRs`);

console.log("\n📊 Test Data Summary:");
console.log(`- Repo: ${testRepo.entity}/${testRepo.repo}`);
console.log(`- Issues: ${testIssues.length} (${testIssues.filter(i => i.bountyAmount).length} with bounties)`);
console.log(`- PRs: ${testPRs.length} (${testPRs.filter(p => p.status === "open").length} open, ${testPRs.filter(p => p.status === "merged").length} merged)`);
console.log(`\n🌐 Navigate to:`);
console.log(`- Issues: http://localhost:3000/issues`);
console.log(`- PRs: http://localhost:3000/pulls`);
console.log(`- Repo Issues: http://localhost:3000/${testRepo.entity}/${testRepo.repo}/issues`);
console.log(`- Repo PRs: http://localhost:3000/${testRepo.entity}/${testRepo.repo}/pulls`);
console.log(`- Bounty Hunt: http://localhost:3000/bounty-hunt`);

// Dispatch events to trigger UI updates
window.dispatchEvent(new CustomEvent("gittr:issue-created"));
window.dispatchEvent(new CustomEvent("gittr:pr-created"));

