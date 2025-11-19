"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2 } from "lucide-react";

export default function TestDataPage() {
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);

  const createTestData = () => {
    setCreating(true);
    
    try {
      const testPubkey = "9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c";
      const testRepo = { 
        entity: testPubkey.slice(0, 8), 
        repo: "test-repo",
        entityDisplayName: "Test User"
      };

      // Create repo
      let repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
      if (!repos.find((r: any) => r.entity === testRepo.entity && r.repo === testRepo.repo)) {
        repos.push({
          ...testRepo,
          ownerPubkey: testPubkey,
          defaultBranch: "main",
          branches: ["main", "dev", "feature/new-feature"],
          tags: ["v1.0.0", "v1.1.0", "v2.0.0-beta"],
          description: "Test repository for issues, PRs, and bounties",
          createdAt: Date.now() - 86400000 * 7,
          contributors: [{
            pubkey: testPubkey,
            weight: 100,
            name: "Test User"
          }]
        });
        localStorage.setItem("gittr_repos", JSON.stringify(repos));
      }

      // Create issues with bounties
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
          createdAt: Date.now() - 172800000,
          number: "1",
          labels: ["bug", "critical", "authentication"],
          assignees: [],
          bountyAmount: 10,
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
          createdAt: Date.now() - 432000000,
          number: "2",
          labels: ["enhancement", "ui"],
          assignees: [],
          bountyAmount: 10,
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
          createdAt: Date.now() - 86400000,
          number: "3",
          labels: ["documentation"],
          assignees: []
        },
        {
          id: `issue-${Date.now()}-4`,
          entity: testRepo.entity,
          repo: testRepo.repo,
          title: "Performance optimization needed",
          description: "The app is slow on mobile devices. Need to optimize rendering.",
          status: "closed",
          author: testPubkey,
          createdAt: Date.now() - 864000000,
          closedAt: Date.now() - 259200000,
          number: "4",
          labels: ["performance", "mobile"],
          assignees: [],
          bountyAmount: 10,
          bountyStatus: "released"
        }
      ];
      localStorage.setItem(issuesKey, JSON.stringify(testIssues));

      // Create PRs
      const prsKey = `gittr_prs__${testRepo.entity}__${testRepo.repo}`;
      const testPRs = [
        {
          id: `pr-${Date.now()}-1`,
          title: "Add new feature: User profiles",
          body: "This PR adds a complete user profile system with avatars, bios, and preferences.",
          status: "open",
          author: testPubkey,
          createdAt: Date.now() - 86400000,
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
          createdAt: Date.now() - 43200000,
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
          createdAt: Date.now() - 604800000,
          mergedAt: Date.now() - 518400000,
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
          createdAt: Date.now() - 777600000,
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

      // Dispatch events
      window.dispatchEvent(new CustomEvent("gittr:issue-created"));
      window.dispatchEvent(new CustomEvent("gittr:pr-created"));

      setCreating(false);
      setCreated(true);
      
      setTimeout(() => {
        window.location.href = "/issues";
      }, 1500);
    } catch (error) {
      console.error("Failed to create test data:", error);
      alert("Failed to create test data: " + (error as Error).message);
      setCreating(false);
    }
  };

  return (
    <div className="container mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-bold mb-6">Create Test Data</h1>
      
      <div className="border border-gray-700 rounded p-6 bg-gray-900/50">
        <p className="mb-4 text-gray-300">
          This will create test data for issues, PRs, and bounties to help test the UI.
        </p>
        
        <div className="mb-4">
          <h3 className="font-semibold mb-2">What will be created:</h3>
          <ul className="list-disc list-inside text-sm text-gray-400 space-y-1">
            <li>1 test repository (9a83779e/test-repo)</li>
            <li>4 test issues (2 with bounties, 1 closed, 3 open)</li>
            <li>4 test PRs (2 open, 1 merged, 1 closed)</li>
            <li>Multiple branches and tags</li>
          </ul>
        </div>

        <Button
          onClick={createTestData}
          disabled={creating || created}
          className="w-full bg-purple-600 hover:bg-purple-700"
        >
          {creating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating test data...
            </>
          ) : created ? (
            <>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Test data created! Redirecting...
            </>
          ) : (
            "Create Test Data"
          )}
        </Button>

        {created && (
          <div className="mt-4 p-3 bg-green-900/20 border border-green-700 rounded text-sm text-green-300">
            ✅ Test data created successfully! You will be redirected to the issues page.
          </div>
        )}
      </div>
    </div>
  );
}

