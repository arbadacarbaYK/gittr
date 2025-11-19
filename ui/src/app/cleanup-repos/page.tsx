"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export default function CleanupReposPage() {
  const router = useRouter();
  const [repos, setRepos] = useState<any[]>([]);
  const [deleted, setDeleted] = useState<string[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("gittr_repos");
      if (stored) {
        const parsed = JSON.parse(stored);
        setRepos(Array.isArray(parsed) ? parsed : []);
      }
    } catch (error) {
      console.error("Failed to load repos:", error);
    }
  }, []);

  const deleteRepo = (entity: string, repoName: string) => {
    try {
      const stored = localStorage.getItem("gittr_repos");
      if (!stored) return;

      const repos = JSON.parse(stored);
      const filtered = repos.filter((r: any) => {
        const rEntity = r.entity || r.slug?.split("/")[0];
        const rRepo = r.repo || r.slug?.split("/")[1] || r.name || r.slug;
        return !(rEntity === entity && rRepo === repoName);
      });

      localStorage.setItem("gittr_repos", JSON.stringify(filtered));
      setRepos(filtered);
      setDeleted([...deleted, `${entity}/${repoName}`]);

      // Clean all possible localStorage keys related to this repo
      const keyVariations = [
        `${entity}__${repoName}`,
        `${entity}_${repoName}`,
        `${entity}/${repoName}`,
      ];
      
      keyVariations.forEach(keyBase => {
        // Issues, PRs, overrides, etc.
        localStorage.removeItem(`gittr_issues__${keyBase}`);
        localStorage.removeItem(`gittr_prs__${keyBase}`);
        localStorage.removeItem(`gittr_overrides__${keyBase}`);
        localStorage.removeItem(`gittr_repo_overrides__${keyBase}`);
        localStorage.removeItem(`gittr_repo_deleted__${keyBase}`);
        localStorage.removeItem(`gittr_milestones_${keyBase}`);
        localStorage.removeItem(`gittr_discussions__${keyBase}`);
        localStorage.removeItem(`gittr_releases__${keyBase}`);
        localStorage.removeItem(`gittr_accumulated_zaps_${keyBase}`);
      });

      // Also try entity/repo format variations
      const repoKey = `${entity}/${repoName}`;
      localStorage.removeItem(`gittr_issues__${entity}__${repoName}`);
      localStorage.removeItem(`gittr_prs__${entity}__${repoName}`);
      localStorage.removeItem(`gittr_accumulated_zaps_${repoKey}`);

      console.log(`Deleted repo ${entity}/${repoName} and all related data from localStorage`);
    } catch (error) {
      console.error("Failed to delete repo:", error);
      alert(`Failed to delete repo: ${error}`);
    }
  };

  return (
    <div className="container mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-bold mb-4">Repository Cleanup</h1>
      <p className="text-gray-400 mb-6">
        Delete malformed or unwanted repositories from localStorage.
      </p>
      <div className="mb-4 p-3 bg-yellow-900/20 border border-yellow-500 rounded text-sm">
        <p className="text-yellow-400 font-semibold mb-1">⚠️ About Nostr Events</p>
        <p className="text-yellow-300">
          If a repository was published to Nostr relays, the event remains on relays even after local deletion. 
          Nostr events cannot be truly deleted, but you can publish a replacement event to update it. 
          The repo will be removed from your local storage, but others may still see it if they sync from Nostr.
        </p>
      </div>

      {deleted.length > 0 && (
        <div className="mb-4 p-4 bg-green-900/20 border border-green-500 rounded">
          <p className="text-green-400 font-semibold">Deleted:</p>
          <ul className="list-disc list-inside text-green-300">
            {deleted.map((repo) => (
              <li key={repo}>{repo}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2 mb-6">
        {repos.map((repo, idx) => {
          const entity = repo.entity || repo.slug?.split("/")[0] || "unknown";
          const repoName = repo.repo || repo.slug?.split("/")[1] || repo.name || repo.slug || "unknown";
          const key = `${entity}/${repoName}`;

          return (
            <div
              key={idx}
              className="flex items-center justify-between p-3 border border-gray-700 rounded bg-gray-900"
            >
              <div className="flex-1">
                <div className="font-semibold">{key}</div>
                <div className="text-sm text-gray-400">
                  Entity: {entity} | Repo: {repoName}
                </div>
                {repo.name && repo.name !== repoName && (
                  <div className="text-xs text-gray-500">Name: {repo.name}</div>
                )}
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  if (confirm(`Delete ${key}? This cannot be undone.`)) {
                    deleteRepo(entity, repoName);
                  }
                }}
              >
                Delete
              </Button>
            </div>
          );
        })}
      </div>

      {repos.length === 0 && (
        <div className="text-gray-400 text-center py-8">
          No repositories found in localStorage
        </div>
      )}

      <div className="mt-6">
        <Button variant="outline" onClick={() => router.push("/repositories")}>
          Back to Repositories
        </Button>
      </div>
    </div>
  );
}

