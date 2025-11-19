"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { BarChart4, GitFork, Star, Code, TrendingUp, GitMerge, MessageSquare, FileText } from "lucide-react";
import { getActivities, type Activity } from "@/lib/activity-tracking";

interface RepoFileEntry {
  path: string;
  type: string;
}

interface Contributor {
  pubkey: string;
  weight?: number;
}

interface StoredRepoSummary {
  entity: string;
  repo?: string;
  slug?: string;
  name?: string;
  files?: RepoFileEntry[];
  stars?: number;
  forks?: number;
  contributors?: Contributor[];
  languages?: Record<string, number>;
}

interface StoredIssue {
  status?: string;
}

interface StoredPullRequest {
  status?: string;
}

interface RepoStats {
  issues: { total: number; open: number; closed: number };
  prs: { total: number; open: number; merged: number; closed: number };
  commits: number;
  discussions: number;
  activities: number;
}

const parseJsonArray = <T,>(value: string | null): T[] => {
  if (!value) return [];
  try {
    return JSON.parse(value) as T[];
  } catch {
    return [];
  }
};

const getStatus = (value: string | undefined, fallback: string): string =>
  (value ?? fallback).toLowerCase();

const getLanguageEntries = (record?: Record<string, number>): Array<[string, number]> => {
  if (!record) return [];
  return Object.entries(record);
};

export default function InsightsPage() {
  const params = useParams<{ entity: string; repo: string }>();
  const entity = params?.entity ?? "";
  const repoName = params?.repo ?? "";
  
  const [repoData, setRepoData] = useState<StoredRepoSummary | null>(null);

  // Load repo data
  useEffect(() => {
    try {
      const repos = parseJsonArray<StoredRepoSummary>(localStorage.getItem("gittr_repos"));
      const foundRepo = repos.find((storedRepo) => {
        const entityMatches = storedRepo.entity === entity;
        const nameMatches = storedRepo.repo === repoName || storedRepo.slug === repoName;
        return entityMatches && nameMatches;
      });
      
      if (foundRepo) {
        setRepoData(foundRepo);
      } else {
        console.warn("Insights: Repo not found", { entity, repoName, availableRepos: repos.map((r) => ({ entity: r.entity, repo: r.repo, slug: r.slug })) });
        setRepoData(null);
      }
    } catch (error) {
      console.error("Error loading repo data for insights:", error);
      setRepoData(null);
    }
  }, [entity, repoName]);

  // Load additional stats from localStorage and activity tracking
  const stats = useMemo<RepoStats | null>(() => {
    if (!entity || !repoName) return null;
    
    const repoId = `${entity}/${repoName}`;
    
    try {
      // Load issues count
      const issueKey = `gittr_issues__${entity}__${repoName}`;
      const issues = parseJsonArray<StoredIssue>(localStorage.getItem(issueKey));
      const openIssues = issues.filter((issue) => getStatus(issue.status, "open") === "open").length;
      const closedIssues = issues.filter((issue) => getStatus(issue.status, "open") === "closed").length;
      
      // Load PRs count
      const prKey = `gittr_prs__${entity}__${repoName}`;
      const prs = parseJsonArray<StoredPullRequest>(localStorage.getItem(prKey));
      const openPRs = prs.filter((pr) => getStatus(pr.status, "open") === "open").length;
      const mergedPRs = prs.filter((pr) => getStatus(pr.status, "open") === "merged").length;
      const closedPRs = prs.filter((pr) => getStatus(pr.status, "open") === "closed").length;
      
      // Load commits from activity tracking
      const activities = getActivities();
      const repoActivities = activities.filter((activity: Activity) => activity.repo === repoId);
      const commitCount = repoActivities.filter((activity) => activity.type === "commit_created").length;
      
      // Load discussions count
      const discussionKey = `gittr_discussions_${entity}_${repoName}`;
      const discussions = parseJsonArray<unknown>(localStorage.getItem(discussionKey));
      
      return {
        issues: {
          total: issues.length,
          open: openIssues,
          closed: closedIssues,
        },
        prs: {
          total: prs.length,
          open: openPRs,
          merged: mergedPRs,
          closed: closedPRs,
        },
        commits: commitCount,
        discussions: discussions.length,
        activities: repoActivities.length,
      };
    } catch (error) {
      console.error("Error loading stats:", error);
      return {
        issues: { total: 0, open: 0, closed: 0 },
        prs: { total: 0, open: 0, merged: 0, closed: 0 },
        commits: 0,
        discussions: 0,
        activities: 0,
      };
    }
  }, [entity, repoName]);

  const languageEntries = getLanguageEntries(repoData?.languages);
  const hasLanguageData = languageEntries.length > 0;
  const totalLanguageBytes = languageEntries.reduce((sum, [, bytes]) => sum + bytes, 0);
  const topLanguageEntries = hasLanguageData
    ? [...languageEntries].sort(([, a], [, b]) => b - a).slice(0, 10)
    : [];

  return (
    <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
      <h1 className="text-2xl font-bold mb-6">Insights</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="border border-[#383B42] rounded p-4 bg-[#171B21]">
          <div className="flex items-center gap-2 mb-2">
            <Code className="h-5 w-5 text-purple-500" />
            <h3 className="font-semibold">Files</h3>
          </div>
          <p className="text-3xl font-bold">
            {repoData?.files ? repoData.files.filter((file) => file.type === "file").length : 0}
          </p>
          <p className="text-sm text-gray-400">Total files</p>
        </div>
        
        <div className="border border-[#383B42] rounded p-4 bg-[#171B21]">
          <div className="flex items-center gap-2 mb-2">
            <Star className="h-5 w-5 text-yellow-500" />
            <h3 className="font-semibold">Stars</h3>
          </div>
          <p className="text-3xl font-bold">{repoData?.stars || 0}</p>
          <p className="text-sm text-gray-400">Total stars</p>
        </div>
        
        <div className="border border-[#383B42] rounded p-4 bg-[#171B21]">
          <div className="flex items-center gap-2 mb-2">
            <GitFork className="h-5 w-5 text-green-500" />
            <h3 className="font-semibold">Forks</h3>
          </div>
          <p className="text-3xl font-bold">{repoData?.forks || 0}</p>
          <p className="text-sm text-gray-400">Total forks</p>
        </div>
        
        <div className="border border-[#383B42] rounded p-4 bg-[#171B21]">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="h-5 w-5 text-blue-500" />
            <h3 className="font-semibold">Contributors</h3>
          </div>
          <p className="text-3xl font-bold">{repoData?.contributors?.length ?? 0}</p>
          <p className="text-sm text-gray-400">Active contributors</p>
        </div>
      </div>

      {/* Additional stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <div className="border border-[#383B42] rounded p-4 bg-[#171B21]">
          <div className="flex items-center gap-2 mb-2">
            <MessageSquare className="h-5 w-5 text-purple-500" />
            <h3 className="font-semibold">Issues</h3>
          </div>
          <p className="text-3xl font-bold">{stats?.issues.total || 0}</p>
          <p className="text-sm text-gray-400">{stats?.issues.open || 0} open, {stats?.issues.closed || 0} closed</p>
        </div>
        
        <div className="border border-[#383B42] rounded p-4 bg-[#171B21]">
          <div className="flex items-center gap-2 mb-2">
            <GitMerge className="h-5 w-5 text-purple-500" />
            <h3 className="font-semibold">Pull Requests</h3>
          </div>
          <p className="text-3xl font-bold">{stats?.prs.total || 0}</p>
          <p className="text-sm text-gray-400">{stats?.prs.open || 0} open, {stats?.prs.merged || 0} merged</p>
        </div>
        
        <div className="border border-[#383B42] rounded p-4 bg-[#171B21]">
          <div className="flex items-center gap-2 mb-2">
            <Code className="h-5 w-5 text-purple-500" />
            <h3 className="font-semibold">Commits</h3>
          </div>
          <p className="text-3xl font-bold">{stats?.commits || 0}</p>
          <p className="text-sm text-gray-400">Total commits</p>
        </div>
        
        <div className="border border-[#383B42] rounded p-4 bg-[#171B21]">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="h-5 w-5 text-purple-500" />
            <h3 className="font-semibold">Discussions</h3>
          </div>
          <p className="text-3xl font-bold">{stats?.discussions || 0}</p>
          <p className="text-sm text-gray-400">Total discussions</p>
        </div>
        
        <div className="border border-[#383B42] rounded p-4 bg-[#171B21]">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="h-5 w-5 text-purple-500" />
            <h3 className="font-semibold">Activity</h3>
          </div>
          <p className="text-3xl font-bold">{stats?.activities || 0}</p>
          <p className="text-sm text-gray-400">Total activities</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border border-[#383B42] rounded p-6 bg-[#171B21]">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <BarChart4 className="h-5 w-5" />
            Languages
          </h2>
          {hasLanguageData ? (
            <div className="space-y-2">
              {topLanguageEntries.map(([lang, bytes]) => {
                const percentage = totalLanguageBytes > 0 ? ((bytes / totalLanguageBytes) * 100).toFixed(1) : "0";
                return (
                  <div key={lang} className="flex items-center gap-3">
                    <div className="w-32 text-sm">{lang}</div>
                    <div className="flex-1 bg-gray-800 rounded-full h-2">
                      <div 
                        className="bg-purple-500 h-2 rounded-full" 
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                    <div className="w-16 text-sm text-gray-400 text-right">{percentage}%</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-gray-400">No language data available</p>
          )}
        </div>

        <div className="border border-[#383B42] rounded p-6 bg-[#171B21]">
          <h2 className="text-xl font-bold mb-4">Activity</h2>
          <p className="text-gray-400">Activity charts coming soon...</p>
          <p className="text-sm text-gray-500 mt-2">
            Track commits, pull requests, and issues over time
          </p>
        </div>
      </div>
    </div>
  );
}
