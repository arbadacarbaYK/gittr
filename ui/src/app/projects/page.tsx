"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import useSession from "@/lib/nostr/useSession";

import {
  Calendar,
  CheckCircle2,
  Circle,
  Clock,
  Folder,
  Plus,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";

interface AggregatedProject {
  repoId: string; // entity/repo
  repoName: string;
  projectId: string;
  projectName: string;
  items: {
    id: string;
    title: string;
    status: "todo" | "in_progress" | "done";
    type: "issue" | "pr" | "note";
  }[];
}

export default function UserProjectsPage() {
  const { isLoggedIn } = useSession();
  const { pubkey } = useNostrContext();
  const [allProjects, setAllProjects] = useState<AggregatedProject[]>([]);
  const [selectedView, setSelectedView] = useState<
    "all" | "active" | "overdue"
  >("all");
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isLoggedIn || !pubkey) {
      setLoading(false);
      return;
    }

    try {
      // Get all repos the user owns or has access to
      const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");

      // Aggregate all projects from all repos
      const aggregated: AggregatedProject[] = [];

      repos.forEach((repo: any) => {
        try {
          const projectKey = `gittr_projects_${repo.entity}_${
            repo.repo || repo.slug
          }`;
          const projects = JSON.parse(localStorage.getItem(projectKey) || "[]");

          projects.forEach((project: any) => {
            if (project.status === "active" && project.items.length > 0) {
              aggregated.push({
                repoId: `${repo.entity}/${repo.repo || repo.slug}`,
                repoName: repo.name || repo.repo || repo.slug,
                projectId: project.id,
                projectName: project.name,
                items: project.items.map((item: any) => ({
                  id: item.id,
                  title: item.title,
                  status: item.status,
                  type: item.type,
                })),
              });
            }
          });
        } catch {}
      });

      setAllProjects(aggregated);
    } catch (error) {
      console.error("Failed to load aggregated projects:", error);
    } finally {
      setLoading(false);
    }
  }, [isLoggedIn, pubkey]);

  const filteredProjects = useMemo(() => {
    if (selectedView === "all") return allProjects;

    // Filter by status
    return allProjects
      .map((proj) => ({
        ...proj,
        items: proj.items.filter((item) => {
          if (selectedView === "active") {
            return item.status !== "done";
          }
          // overdue would need dueDate tracking
          return true;
        }),
      }))
      .filter((proj) => proj.items.length > 0);
  }, [allProjects, selectedView]);

  const stats = useMemo(() => {
    const total = allProjects.reduce((sum, p) => sum + p.items.length, 0);
    const done = allProjects.reduce(
      (sum, p) => sum + p.items.filter((i) => i.status === "done").length,
      0
    );
    const inProgress = allProjects.reduce(
      (sum, p) =>
        sum + p.items.filter((i) => i.status === "in_progress").length,
      0
    );
    const todo = allProjects.reduce(
      (sum, p) => sum + p.items.filter((i) => i.status === "todo").length,
      0
    );

    return {
      total,
      done,
      inProgress,
      todo,
      progress: total > 0 ? Math.round((done / total) * 100) : 0,
    };
  }, [allProjects]);

  if (!mounted) {
    return (
      <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
        <div className="text-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-purple-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
        <div className="border border-[#383B42] rounded p-12 text-center bg-[#171B21]">
          <Folder className="h-12 w-12 mx-auto mb-4 text-gray-500" />
          <h2 className="text-xl font-semibold mb-2">Sign in required</h2>
          <p className="text-gray-400 mb-4">
            Please sign in to view your aggregated projects
          </p>
          <Link href="/login">
            <Button>Sign In</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
        <div className="text-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-purple-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-400">Loading your projects...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Folder className="h-6 w-6" />
          Your Projects
        </h1>
        <div className="flex gap-2">
          <Button
            variant={selectedView === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedView("all")}
          >
            All
          </Button>
          <Button
            variant={selectedView === "active" ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedView("active")}
          >
            Active
          </Button>
        </div>
      </div>

      {/* Stats Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="border border-[#383B42] rounded p-4 bg-[#171B21]">
          <div className="text-sm text-gray-400 mb-1">Total Items</div>
          <div className="text-2xl font-bold">{stats.total}</div>
        </div>
        <div className="border border-[#383B42] rounded p-4 bg-[#171B21]">
          <div className="text-sm text-gray-400 mb-1">To Do</div>
          <div className="text-2xl font-bold text-gray-300">{stats.todo}</div>
        </div>
        <div className="border border-[#383B42] rounded p-4 bg-[#171B21]">
          <div className="text-sm text-gray-400 mb-1">In Progress</div>
          <div className="text-2xl font-bold text-purple-400">
            {stats.inProgress}
          </div>
        </div>
        <div className="border border-[#383B42] rounded p-4 bg-[#171B21]">
          <div className="text-sm text-gray-400 mb-1">Done</div>
          <div className="text-2xl font-bold text-green-400">{stats.done}</div>
          <div className="text-xs text-gray-500 mt-1">
            {stats.progress}% complete
          </div>
        </div>
      </div>

      {/* Projects List */}
      {filteredProjects.length === 0 ? (
        <div className="border border-[#383B42] rounded p-12 text-center bg-[#171B21]">
          <Folder className="h-12 w-12 mx-auto mb-4 text-gray-500" />
          <h3 className="text-xl font-semibold mb-2">No active projects</h3>
          <p className="text-gray-400 mb-4">
            Create projects in your repositories to see them aggregated here
          </p>
          <Link href="/explore">
            <Button variant="outline">Browse Repositories</Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredProjects.map((proj) => {
            const [entity, repo] = proj.repoId.split("/");
            const todoCount = proj.items.filter(
              (i) => i.status === "todo"
            ).length;
            const inProgressCount = proj.items.filter(
              (i) => i.status === "in_progress"
            ).length;
            const doneCount = proj.items.filter(
              (i) => i.status === "done"
            ).length;
            const progress =
              proj.items.length > 0
                ? Math.round((doneCount / proj.items.length) * 100)
                : 0;

            return (
              <div
                key={`${proj.repoId}-${proj.projectId}`}
                className="border border-[#383B42] rounded p-4 bg-[#171B21] hover:bg-[#1a1e25] transition-colors"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Link
                        href={`/${proj.repoId}/projects`}
                        className="text-lg font-semibold hover:text-purple-400"
                      >
                        {proj.projectName}
                      </Link>
                      <span className="text-sm text-gray-500">in</span>
                      <Link
                        href={`/${proj.repoId}`}
                        className="text-sm text-purple-400 hover:text-purple-300"
                      >
                        {proj.repoName}
                      </Link>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-400 mt-2">
                      <span className="flex items-center gap-1">
                        <Circle className="h-3 w-3" />
                        {todoCount} todo
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {inProgressCount} in progress
                      </span>
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        {doneCount} done
                      </span>
                    </div>
                  </div>
                  <Link href={`/${proj.repoId}/projects`}>
                    <Button size="sm" variant="outline">
                      View Project
                    </Button>
                  </Link>
                </div>
                {/* Progress bar */}
                <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-purple-600 transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
