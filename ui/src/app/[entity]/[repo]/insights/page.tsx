"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";

import { fetchBridgeRead } from "@/lib/nostr/bridge-read";
import { inferLanguagesFromFiles } from "@/lib/repos/infer-languages-from-files";
import {
  type RepoInsightsSnapshot,
  loadRepoInsightsSnapshot,
} from "@/lib/repos/insights-stats";
import { useRepoChromeStats } from "@/lib/repos/repo-chrome-stats";
import { type StoredRepo, loadStoredRepos } from "@/lib/repos/storage";
import {
  getRepoOwnerPubkey,
  resolveEntityToPubkey,
} from "@/lib/utils/entity-resolver";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";

import {
  BarChart4,
  Code,
  FileText,
  GitFork,
  GitMerge,
  MessageSquare,
  Star,
  TrendingUp,
} from "lucide-react";
import { useParams } from "next/navigation";

const emptySnapshot = (): RepoInsightsSnapshot => ({
  fileCount: 0,
  storedStars: 0,
  forks: 0,
  contributors: 0,
  issues: { total: 0, open: 0, closed: 0 },
  prs: { total: 0, open: 0, closed: 0, merged: 0 },
  commits: 0,
  discussions: 0,
  languages: {},
});

function StatCard({
  icon,
  title,
  value,
  detail,
}: {
  icon: ReactNode;
  title: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="border border-[var(--color-border)] rounded p-4 bg-[var(--color-bg-secondary)]">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h3 className="font-semibold text-[var(--color-text-primary)]">
          {title}
        </h3>
      </div>
      <p className="text-3xl font-bold text-[var(--color-text-primary)]">
        {value}
      </p>
      <p className="text-sm text-[var(--color-text-secondary)]">{detail}</p>
    </div>
  );
}

export default function InsightsPage() {
  const params = useParams<{ entity: string; repo: string }>();
  const entity = params?.entity ?? "";
  const repoName = params?.repo ?? "";
  const chrome = useRepoChromeStats();

  const [mounted, setMounted] = useState(false);
  const [snapshot, setSnapshot] = useState<RepoInsightsSnapshot>(emptySnapshot);
  const [liveCommits, setLiveCommits] = useState<number | null>(null);
  const [liveFileCount, setLiveFileCount] = useState<number | null>(null);
  const [liveLanguages, setLiveLanguages] = useState<Record<
    string,
    number
  > | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !entity || !repoName) return;
    setSnapshot(loadRepoInsightsSnapshot(entity, repoName));
  }, [mounted, entity, repoName]);

  useEffect(() => {
    if (!mounted || !entity || !repoName) return;
    let cancelled = false;

    const run = async () => {
      const stored = findRepoByEntityAndName<StoredRepo>(
        loadStoredRepos(),
        entity,
        repoName
      );
      const owner =
        (stored ? getRepoOwnerPubkey(stored, entity) : null) ||
        resolveEntityToPubkey(entity);
      const repoId = stored?.repo || stored?.name || repoName;
      const branch =
        (stored as StoredRepo & { defaultBranch?: string })?.defaultBranch ||
        "main";
      if (!owner || !repoId) return;
      try {
        const [commitRes, filesRes] = await Promise.all([
          fetchBridgeRead(
            `/api/nostr/repo/commits?ownerPubkey=${encodeURIComponent(
              owner
            )}&repo=${encodeURIComponent(repoId)}&branch=${encodeURIComponent(
              branch
            )}&limit=500`
          ),
          fetchBridgeRead(
            `/api/nostr/repo/files?ownerPubkey=${encodeURIComponent(
              owner
            )}&repo=${encodeURIComponent(repoId)}&branch=${encodeURIComponent(
              branch
            )}`
          ),
        ]);
        if (cancelled) return;
        if (commitRes.ok) {
          const data = (await commitRes.json()) as { commits?: unknown[] };
          const n = Array.isArray(data.commits) ? data.commits.length : 0;
          if (n > 0) setLiveCommits(n);
        }
        if (filesRes.ok) {
          const data = (await filesRes.json()) as {
            files?: Array<{ path?: string; type?: string; size?: number }>;
            totalFileCount?: number;
          };
          const tree = Array.isArray(data.files) ? data.files : [];
          const fromList = tree.filter(
            (f) => !f.type || f.type === "file"
          ).length;
          const n =
            typeof data.totalFileCount === "number" && data.totalFileCount > 0
              ? data.totalFileCount
              : fromList;
          if (n > 0) setLiveFileCount(n);
          const langs = inferLanguagesFromFiles(tree);
          if (Object.keys(langs).length > 0) setLiveLanguages(langs);
        }
      } catch {
        /* keep cached counts */
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [mounted, entity, repoName]);

  const starCount = chrome?.nostrStarCount ?? snapshot.storedStars;
  const forkCount = Math.max(chrome?.forkCount ?? 0, snapshot.forks);
  const commitCount = Math.max(liveCommits ?? 0, snapshot.commits);
  const fileCount = Math.max(liveFileCount ?? 0, snapshot.fileCount);
  const githubStars = chrome?.githubStarCount;

  const languageEntries = useMemo(() => {
    const record = liveLanguages ?? snapshot.languages;
    return Object.entries(record).sort(([, a], [, b]) => b - a);
  }, [liveLanguages, snapshot.languages]);
  const totalLanguageBytes = languageEntries.reduce(
    (sum, [, bytes]) => sum + bytes,
    0
  );

  if (!mounted) {
    return (
      <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
        <h1 className="text-2xl font-bold mb-6">Insights</h1>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
      <h1 className="text-2xl font-bold mb-6">Insights</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          icon={<Code className="h-5 w-5 text-purple-500" />}
          title="Files"
          value={fileCount}
          detail="In the last loaded tree"
        />
        <StatCard
          icon={<Star className="h-5 w-5 text-yellow-500" />}
          title="Stars"
          value={starCount}
          detail={
            githubStars != null
              ? `${githubStars} on GitHub`
              : "Nostr stars (same as the Star button)"
          }
        />
        <StatCard
          icon={<GitFork className="h-5 w-5 text-green-500" />}
          title="Forks"
          value={forkCount}
          detail="Known fork count"
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5 text-blue-500" />}
          title="Contributors"
          value={snapshot.contributors}
          detail="From repo metadata"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          icon={<MessageSquare className="h-5 w-5 text-purple-500" />}
          title="Issues"
          value={snapshot.issues.total}
          detail={`${snapshot.issues.open} open, ${snapshot.issues.closed} closed`}
        />
        <StatCard
          icon={<GitMerge className="h-5 w-5 text-purple-500" />}
          title="Pull Requests"
          value={snapshot.prs.total}
          detail={`${snapshot.prs.open} open, ${
            snapshot.prs.merged ?? 0
          } merged`}
        />
        <StatCard
          icon={<Code className="h-5 w-5 text-purple-500" />}
          title="Commits"
          value={commitCount}
          detail="From git history"
        />
        <StatCard
          icon={<FileText className="h-5 w-5 text-purple-500" />}
          title="Discussions"
          value={snapshot.discussions}
          detail="On this repo"
        />
      </div>

      {languageEntries.length > 0 && totalLanguageBytes > 0 && (
        <div className="border border-[var(--color-border)] rounded p-6 bg-[var(--color-bg-secondary)]">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <BarChart4 className="h-5 w-5" />
            Languages
          </h2>
          <div className="space-y-2">
            {languageEntries.slice(0, 10).map(([lang, bytes]) => {
              const percentage = ((bytes / totalLanguageBytes) * 100).toFixed(
                1
              );
              return (
                <div key={lang} className="flex items-center gap-3">
                  <div className="w-32 text-sm">{lang}</div>
                  <div className="flex-1 bg-[var(--color-bg-primary)] rounded-full h-2">
                    <div
                      className="bg-purple-500 h-2 rounded-full"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <div className="w-16 text-sm text-[var(--color-text-secondary)] text-right">
                    {percentage}%
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
