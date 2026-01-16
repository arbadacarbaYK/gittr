"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { hasWriteAccess } from "@/lib/repo-permissions";
import { type StoredRepo, loadStoredRepos } from "@/lib/repos/storage";
import { getNostrPrivateKey } from "@/lib/security/encryptedStorage";
import { formatDate24h, formatDateTime24h } from "@/lib/utils/date-format";
import { getRepoOwnerPubkey } from "@/lib/utils/entity-resolver";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";

import {
  Calendar,
  CheckCircle2,
  Circle,
  Clock,
  Edit2,
  FileText,
  Folder,
  Plus,
  Save,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";

interface Project {
  id: string;
  name: string;
  description?: string;
  status: "active" | "completed" | "archived";
  items: ProjectItem[];
  createdAt: number;
  view: "kanban" | "roadmap"; // View mode
}

interface ProjectItem {
  id: string;
  title: string;
  content?: string; // Notes/content with markdown support
  type: "issue" | "pr" | "note";
  status: "todo" | "in_progress" | "done";
  issueId?: string;
  prId?: string;
  assignee?: string;
  dueDate?: number;
  estimatedDays?: number; // For roadmap planning
  priority?: "low" | "medium" | "high";
}

export default function ProjectsPage() {
  const params = useParams();
  const entity = params?.entity as string;
  const repo = params?.repo as string;
  const { pubkey: currentUserPubkey } = useNostrContext();

  const [projects, setProjects] = useState<Project[]>([]);
  const [hasWrite, setHasWrite] = useState(false); // Write access (owner or maintainer)
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingContent, setEditingContent] = useState("");
  const [editingEstimatedDays, setEditingEstimatedDays] = useState<
    number | undefined
  >(undefined);
  const [editingDueDate, setEditingDueDate] = useState<string>("");
  const [editingProjectName, setEditingProjectName] = useState<string | null>(
    null
  );
  const [editingProjectNameValue, setEditingProjectNameValue] = useState("");
  const [draggedItem, setDraggedItem] = useState<ProjectItem | null>(null);
  const [openIssues, setOpenIssues] = useState<any[]>([]);

  // Load projects
  useEffect(() => {
    try {
      const stored = JSON.parse(
        localStorage.getItem(`gittr_projects_${entity}_${repo}`) || "[]"
      ) as Project[];
      // Ensure all projects have view property and items array
      const normalized: Project[] = stored.map((p) => ({
        ...p,
        view: (p.view || "kanban") as "kanban" | "roadmap",
        items: p.items || [], // Ensure items array exists
      }));
      setProjects(normalized);
      if (normalized.length > 0 && !selectedProject && normalized[0]) {
        setSelectedProject(normalized[0].id);
      }
    } catch {}
  }, [entity, repo, selectedProject]);

  // Load open issues for auto-linking
  useEffect(() => {
    try {
      const key = `gittr_issues__${entity}__${repo}`;
      const issues = JSON.parse(localStorage.getItem(key) || "[]");
      const open = issues.filter((i: any) => i.status === "open");
      setOpenIssues(open);
    } catch {}
  }, [entity, repo]);

  // Check if user has write access (owner or maintainer) - required for create/edit/delete
  useEffect(() => {
    try {
      const repos = loadStoredRepos();
      const rec = findRepoByEntityAndName<StoredRepo>(repos, entity, repo);
      if (rec && currentUserPubkey) {
        const repoOwnerPubkey = getRepoOwnerPubkey(rec, entity);
        const userHasWrite = hasWriteAccess(
          currentUserPubkey,
          rec.contributors,
          repoOwnerPubkey
        );
        setHasWrite(userHasWrite);
      } else {
        setHasWrite(false);
      }
    } catch {
      setHasWrite(false);
    }
  }, [entity, repo, currentUserPubkey]);

  const project = projects.find((p) => p.id === selectedProject);

  const saveProjects = useCallback(
    (updated: Project[]) => {
      setProjects(updated);
      localStorage.setItem(
        `gittr_projects_${entity}_${repo}`,
        JSON.stringify(updated)
      );
    },
    [entity, repo]
  );

  const handleCreateProject = async () => {
    // CRITICAL: Require write access (owner or maintainer) and signature
    if (!currentUserPubkey) {
      alert("Please log in to create projects");
      return;
    }

    if (!hasWrite) {
      alert("Only owners and maintainers can create projects");
      return;
    }

    // Get private key for signing (required for project creation)
    const privateKey = await getNostrPrivateKey();
    const hasNip07 = typeof window !== "undefined" && window.nostr;

    if (!privateKey && !hasNip07) {
      alert(
        "Creating projects requires signature. Please configure NIP-07 extension or private key in settings."
      );
      return;
    }

    const newProject: Project = {
      id: `project-${Date.now()}`,
      name: `New Project ${projects.length + 1}`,
      description: "",
      status: "active",
      items: [],
      createdAt: Date.now(),
      view: "kanban",
    };
    const updated = [...projects, newProject];
    saveProjects(updated);
    setSelectedProject(newProject.id);
  };

  const handleAddItem = (
    type: "issue" | "pr" | "note",
    issueId?: string,
    prId?: string
  ) => {
    if (!project) return;

    const newItem: ProjectItem = {
      id: `item-${Date.now()}`,
      title:
        type === "issue" && issueId
          ? openIssues.find((i) => i.id === issueId)?.title || "New Issue"
          : type === "note"
          ? "New Note"
          : "New Item",
      type,
      status: "todo",
      issueId,
      prId,
    };

    const updated = projects.map((p) =>
      p.id === project.id ? { ...p, items: [...p.items, newItem] } : p
    );
    saveProjects(updated);

    if (type === "note") {
      setEditingItem(newItem.id);
      setEditingTitle(newItem.title);
      setEditingContent("");
    }
  };

  const handleDragStart = (item: ProjectItem) => {
    setDraggedItem(item);
  };

  const handleDragOver = (
    e: React.DragEvent,
    status: "todo" | "in_progress" | "done"
  ) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (
    e: React.DragEvent,
    status: "todo" | "in_progress" | "done"
  ) => {
    e.preventDefault();
    if (!draggedItem || !project) return;

    const updated = projects.map((p) =>
      p.id === project.id
        ? {
            ...p,
            items: p.items.map((item) =>
              item.id === draggedItem.id ? { ...item, status } : item
            ),
          }
        : p
    );
    saveProjects(updated);
    setDraggedItem(null);
  };

  const handleDeleteItem = (itemId: string) => {
    if (!project) return;

    const item = project.items.find((i) => i.id === itemId);
    if (!item) return;

    // Build warning message based on item type
    let warningMessage = "Delete this item?\n\n";

    if (item.type === "issue") {
      warningMessage +=
        "⚠️ This will remove the issue from project planning, but the issue in the repository will NOT be deleted.\n\n";
    } else if (item.type === "pr") {
      warningMessage +=
        "⚠️ This will remove the PR from project planning, but the PR in the repository will NOT be deleted.\n\n";
    } else if (item.type === "note") {
      warningMessage +=
        "⚠️ This will permanently delete this note and all its content.\n\n";
    }

    warningMessage +=
      "All planning, notes, and links will be lost. This cannot be undone.";

    if (!confirm(warningMessage)) return;

    const updated = projects.map((p) =>
      p.id === project.id
        ? { ...p, items: p.items.filter((item) => item.id !== itemId) }
        : p
    );
    saveProjects(updated);
    if (editingItem === itemId) {
      setEditingItem(null);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    // CRITICAL: Require write access (owner or maintainer) and signature
    if (!currentUserPubkey) {
      alert("Please log in to delete projects");
      return;
    }

    if (!hasWrite) {
      alert("Only owners and maintainers can delete projects");
      return;
    }

    // Get private key for signing (required for project deletion)
    const privateKey = await getNostrPrivateKey();
    const hasNip07 = typeof window !== "undefined" && window.nostr;

    if (!privateKey && !hasNip07) {
      alert(
        "Deleting projects requires signature. Please configure NIP-07 extension or private key in settings."
      );
      return;
    }

    const projectToDelete = projects.find((p) => p.id === projectId);
    if (!projectToDelete) return;

    // Count linked issues and PRs
    const linkedIssues = projectToDelete.items.filter(
      (item) => item.type === "issue" && item.issueId
    ).length;
    const linkedPRs = projectToDelete.items.filter(
      (item) => item.type === "pr" && item.prId
    ).length;
    const notes = projectToDelete.items.filter(
      (item) => item.type === "note"
    ).length;

    let warningMessage = `⚠️ WARNING: Delete Project "${projectToDelete.name}"?\n\n`;
    warningMessage += "This will permanently delete:\n";
    warningMessage += `• All planning and timeline data\n`;
    warningMessage += `• All notes (${notes} note${notes !== 1 ? "s" : ""})\n`;
    warningMessage += `• All links to issues (${linkedIssues} issue${
      linkedIssues !== 1 ? "s" : ""
    })\n`;
    warningMessage += `• All links to PRs (${linkedPRs} PR${
      linkedPRs !== 1 ? "s" : ""
    })\n\n`;
    warningMessage +=
      "⚠️ The issues and PRs in your repository will NOT be deleted - only the project planning data.\n\n";
    warningMessage += "This action cannot be undone. Are you sure?";

    if (!confirm(warningMessage)) return;

    const updated = projects.filter((p) => p.id !== projectId);
    saveProjects(updated);

    // If deleted project was selected, select first remaining or null
    if (selectedProject === projectId) {
      setSelectedProject(
        updated.length > 0 && updated[0] ? updated[0].id : null
      );
    }
  };

  const handleSaveItem = async (itemId: string) => {
    if (!project || !editingTitle.trim()) return;

    // CRITICAL: Require write access (owner or maintainer) and signature for editing
    if (!currentUserPubkey) {
      alert("Please log in to edit project items");
      return;
    }

    if (!hasWrite) {
      alert("Only owners and maintainers can edit project items");
      return;
    }

    // Get private key for signing (required for project edits)
    const privateKey = await getNostrPrivateKey();
    const hasNip07 = typeof window !== "undefined" && window.nostr;

    if (!privateKey && !hasNip07) {
      alert(
        "Editing projects requires signature. Please configure NIP-07 extension or private key in settings."
      );
      return;
    }

    const updated = projects.map((p) =>
      p.id === project.id
        ? {
            ...p,
            items: p.items.map((item) =>
              item.id === itemId
                ? {
                    ...item,
                    title: editingTitle,
                    content: editingContent,
                    estimatedDays: editingEstimatedDays || undefined,
                    dueDate: editingDueDate
                      ? new Date(editingDueDate).getTime()
                      : undefined,
                  }
                : item
            ),
          }
        : p
    );
    saveProjects(updated);
    setEditingItem(null);
    setEditingTitle("");
    setEditingContent("");
    setEditingEstimatedDays(undefined);
    setEditingDueDate("");
  };

  const handleStartEditProjectName = (projectId: string) => {
    const proj = projects.find((p) => p.id === projectId);
    if (proj) {
      setEditingProjectName(projectId);
      setEditingProjectNameValue(proj.name);
    }
  };

  const handleSaveProjectName = async (projectId: string) => {
    if (!editingProjectNameValue.trim()) {
      setEditingProjectName(null);
      return;
    }

    // CRITICAL: Require write access (owner or maintainer) and signature for editing project name
    if (!currentUserPubkey) {
      alert("Please log in to edit project names");
      setEditingProjectName(null);
      setEditingProjectNameValue("");
      return;
    }

    if (!hasWrite) {
      alert("Only owners and maintainers can edit project names");
      setEditingProjectName(null);
      setEditingProjectNameValue("");
      return;
    }

    // Get private key for signing (required for project edits)
    const privateKey = await getNostrPrivateKey();
    const hasNip07 = typeof window !== "undefined" && window.nostr;

    if (!privateKey && !hasNip07) {
      alert(
        "Editing projects requires signature. Please configure NIP-07 extension or private key in settings."
      );
      setEditingProjectName(null);
      setEditingProjectNameValue("");
      return;
    }

    const updated = projects.map((p) =>
      p.id === projectId ? { ...p, name: editingProjectNameValue.trim() } : p
    );
    saveProjects(updated);
    setEditingProjectName(null);
    setEditingProjectNameValue("");
  };

  const handleCancelEditProjectName = () => {
    setEditingProjectName(null);
    setEditingProjectNameValue("");
  };

  const handleToggleView = () => {
    if (!project) return;
    const updated: Project[] = projects.map((p) =>
      p.id === project.id
        ? {
            ...p,
            view: (p.view === "kanban" ? "roadmap" : "kanban") as
              | "kanban"
              | "roadmap",
          }
        : p
    );
    saveProjects(updated);
  };

  const renderItem = (item: ProjectItem) => {
    if (editingItem === item.id) {
      return (
        <div className="border border-purple-500 rounded p-3 bg-gray-900 space-y-2">
          <Input
            value={editingTitle}
            onChange={(e) => setEditingTitle(e.target.value)}
            placeholder="Title"
            className="text-sm"
          />
          <Textarea
            value={editingContent}
            onChange={(e) => setEditingContent(e.target.value)}
            placeholder="Notes (markdown supported, links work)..."
            className="text-xs min-h-[100px]"
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">
                Estimated Days
              </label>
              <Input
                type="number"
                min="1"
                value={editingEstimatedDays || ""}
                onChange={(e) =>
                  setEditingEstimatedDays(
                    e.target.value ? parseInt(e.target.value) : undefined
                  )
                }
                placeholder="e.g. 7"
                className="text-xs"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">
                Due Date
              </label>
              <Input
                type="date"
                value={editingDueDate}
                onChange={(e) => setEditingDueDate(e.target.value)}
                className="text-xs"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => handleSaveItem(item.id)}
              className="flex-1"
            >
              <Save className="h-3 w-3 mr-1" />
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditingItem(null);
                setEditingTitle("");
                setEditingContent("");
                setEditingEstimatedDays(undefined);
                setEditingDueDate("");
              }}
            >
              <X className="h-3 w-3" />
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => handleDeleteItem(item.id)}
              title="Delete this item permanently"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div
        draggable={editingItem !== item.id}
        onDragStart={() => editingItem !== item.id && handleDragStart(item)}
        onClick={() => {
          // Click to edit (but allow drag if not editing)
          if (editingItem !== item.id) {
            setEditingItem(item.id);
            setEditingTitle(item.title);
            setEditingContent(item.content || "");
            setEditingEstimatedDays(item.estimatedDays);
            setEditingDueDate(
              item.dueDate
                ? new Date(item.dueDate).toISOString().split("T")[0] || ""
                : ""
            );
          }
        }}
        className="border border-gray-700 rounded p-3 bg-gray-900 hover:bg-gray-800 cursor-pointer group"
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1">
            <div className="text-sm font-medium mb-1">{item.title}</div>
            {item.content && (
              <div className="text-xs text-gray-400 prose prose-invert max-w-none prose-p:text-xs prose-a:text-purple-400 prose-a:no-underline hover:prose-a:underline">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw]}
                  components={{
                    a: ({ node, ...props }: any) => (
                      <a
                        {...props}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-purple-400 hover:text-purple-300"
                      />
                    ),
                  }}
                >
                  {item.content}
                </ReactMarkdown>
              </div>
            )}
            {item.type === "issue" && item.issueId && (
              <Link
                href={`/${entity}/${repo}/issues/${item.issueId}`}
                className="text-xs text-purple-400 hover:underline mt-1 block"
                onClick={(e) => e.stopPropagation()}
              >
                View Issue →
              </Link>
            )}
            {item.type === "pr" && item.prId && (
              <Link
                href={`/${entity}/${repo}/pulls/${item.prId}`}
                className="text-xs text-purple-400 hover:underline mt-1 block"
                onClick={(e) => e.stopPropagation()}
              >
                View PR →
              </Link>
            )}
          </div>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditingItem(item.id);
                setEditingTitle(item.title);
                setEditingContent(item.content || "");
              }}
              className="p-1 hover:bg-gray-700 rounded"
              title="Edit"
            >
              <Edit2 className="h-3 w-3" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteItem(item.id);
              }}
              className="p-1 hover:bg-red-900/50 rounded"
              title="Delete item permanently"
            >
              <Trash2 className="h-3 w-3 text-red-400" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderKanban = () => {
    if (!project) return null;

    return (
      <div className="grid grid-cols-3 gap-4">
        {/* To Do */}
        <div
          className="border border-[#383B42] rounded p-4 bg-[#171B21] min-h-[400px]"
          onDragOver={(e) => handleDragOver(e, "todo")}
          onDrop={(e) => handleDrop(e, "todo")}
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2">
              <Circle className="h-4 w-4" />
              To Do
            </h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleAddItem("note")}
              title="Add note"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-2">
            {project.items
              .filter((item) => item.status === "todo")
              .map((item) => (
                <div key={item.id}>{renderItem(item)}</div>
              ))}
            {project.items.filter((item) => item.status === "todo").length ===
              0 && (
              <div className="text-center text-gray-500 text-sm py-8 border border-dashed border-gray-700 rounded">
                Drop items here
              </div>
            )}
          </div>
        </div>

        {/* In Progress */}
        <div
          className="border border-[#383B42] rounded p-4 bg-[#171B21] min-h-[400px]"
          onDragOver={(e) => handleDragOver(e, "in_progress")}
          onDrop={(e) => handleDrop(e, "in_progress")}
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4" />
              In Progress
            </h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleAddItem("note")}
              title="Add note"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-2">
            {project.items
              .filter((item) => item.status === "in_progress")
              .map((item) => (
                <div key={item.id}>{renderItem(item)}</div>
              ))}
            {project.items.filter((item) => item.status === "in_progress")
              .length === 0 && (
              <div className="text-center text-gray-500 text-sm py-8 border border-dashed border-gray-700 rounded">
                Drop items here
              </div>
            )}
          </div>
        </div>

        {/* Done */}
        <div
          className="border border-[#383B42] rounded p-4 bg-[#171B21] min-h-[400px]"
          onDragOver={(e) => handleDragOver(e, "done")}
          onDrop={(e) => handleDrop(e, "done")}
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Done
            </h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleAddItem("note")}
              title="Add note"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-2">
            {project.items
              .filter((item) => item.status === "done")
              .map((item) => (
                <div key={item.id}>{renderItem(item)}</div>
              ))}
            {project.items.filter((item) => item.status === "done").length ===
              0 && (
              <div className="text-center text-gray-500 text-sm py-8 border border-dashed border-gray-700 rounded">
                Drop items here
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderRoadmap = () => {
    if (!project) return null;

    // Auto-estimate based on issue content and type
    const autoEstimate = (item: ProjectItem): number => {
      if (item.estimatedDays) return item.estimatedDays;

      // Smart defaults: notes are quick, issues vary by complexity
      if (item.type === "note") return 1;
      if (item.type === "issue") {
        // Check issue title/content for complexity hints
        const title = (item.title || "").toLowerCase();
        if (title.includes("fix") || title.includes("bug")) return 2;
        if (title.includes("refactor") || title.includes("update")) return 5;
        if (title.includes("feature") || title.includes("add")) return 7;
        if (title.includes("implement") || title.includes("create")) return 10;
        return 5; // Default
      }
      if (item.type === "pr") return 3; // PRs usually faster
      return 7; // Default
    };

    // Calculate timeline for items with estimated days
    const allItems = project.items.map((item) => ({
      ...item,
      estimatedDays: autoEstimate(item),
    }));

    const sortedItems = [...allItems]
      .filter((item) => item.status !== "done")
      .sort((a, b) => {
        // Sort by priority first, then by due date
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        const aPriority = priorityOrder[a.priority || "medium"];
        const bPriority = priorityOrder[b.priority || "medium"];
        if (aPriority !== bPriority) return bPriority - aPriority;
        return (a.dueDate || 0) - (b.dueDate || 0);
      });

    const today = Date.now();
    const formatDate = (timestamp: number) => formatDate24h(timestamp);

    return (
      <div className="space-y-4">
        <div className="border border-[#383B42] rounded p-4 bg-[#171B21]">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Timeline Roadmap
            </h3>
            <p className="text-xs text-gray-400">
              Smart estimates • Auto-linked from issues
            </p>
          </div>
          <div className="space-y-3">
            {sortedItems.length > 0 ? (
              sortedItems.map((item) => {
                const days = item.estimatedDays || 7;
                const startDate = item.dueDate
                  ? new Date(item.dueDate - days * 24 * 60 * 60 * 1000)
                  : new Date();
                const endDate = item.dueDate
                  ? new Date(item.dueDate)
                  : new Date(Date.now() + days * 24 * 60 * 60 * 1000);
                const isOverdue = endDate.getTime() < today;
                const daysUntilDue = item.dueDate
                  ? Math.ceil((item.dueDate - today) / (1000 * 60 * 60 * 24))
                  : null;

                return (
                  <div
                    key={item.id}
                    className={`border rounded p-3 bg-gray-900 ${
                      isOverdue
                        ? "border-red-700"
                        : item.status === "in_progress"
                        ? "border-purple-500"
                        : "border-gray-700"
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="font-medium">{item.title}</div>
                          {item.priority === "high" && (
                            <span className="text-xs bg-red-900/50 text-red-300 px-1.5 py-0.5 rounded">
                              High
                            </span>
                          )}
                          {item.type === "issue" && (
                            <span className="text-xs bg-blue-900/50 text-blue-300 px-1.5 py-0.5 rounded">
                              Issue
                            </span>
                          )}
                          {item.type === "note" && (
                            <span className="text-xs bg-purple-900/50 text-purple-300 px-1.5 py-0.5 rounded">
                              Note
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-gray-400 mt-1">
                          <span>
                            Est: {days} day{days !== 1 ? "s" : ""}
                          </span>
                          {item.dueDate && (
                            <span
                              className={
                                isOverdue
                                  ? "text-red-400"
                                  : daysUntilDue && daysUntilDue < 3
                                  ? "text-yellow-400"
                                  : ""
                              }
                            >
                              {isOverdue
                                ? "Overdue"
                                : daysUntilDue !== null
                                ? `${daysUntilDue} days left`
                                : ""}
                            </span>
                          )}
                          {!item.dueDate && (
                            <button
                              onClick={() => {
                                // Auto-set due date: today + estimated days
                                const newDueDate =
                                  Date.now() + days * 24 * 60 * 60 * 1000;
                                const updated = projects.map((p) =>
                                  p.id === project.id
                                    ? {
                                        ...p,
                                        items: p.items.map((i) =>
                                          i.id === item.id
                                            ? { ...i, dueDate: newDueDate }
                                            : i
                                        ),
                                      }
                                    : p
                                );
                                saveProjects(updated);
                              }}
                              className="text-purple-400 hover:text-purple-300"
                            >
                              Set deadline
                            </button>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setEditingItem(item.id);
                          setEditingTitle(item.title);
                          setEditingContent(item.content || "");
                          setEditingEstimatedDays(item.estimatedDays);
                          setEditingDueDate(
                            item.dueDate
                              ? new Date(item.dueDate)
                                  .toISOString()
                                  .split("T")[0] || ""
                              : ""
                          );
                        }}
                        className="text-gray-400 hover:text-gray-300"
                        title="Edit"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="h-3 bg-gray-800 rounded-full overflow-hidden relative mb-2">
                      <div
                        className={`h-full transition-all ${
                          isOverdue
                            ? "bg-red-600"
                            : item.status === "in_progress"
                            ? "bg-purple-600"
                            : item.status === "done"
                            ? "bg-green-600"
                            : "bg-gray-600"
                        }`}
                        style={{
                          width: `${Math.min(100, (days / 14) * 100)}%`,
                        }}
                      />
                      {item.dueDate && (
                        <div
                          className="absolute top-0 right-0 h-full w-0.5 bg-yellow-400"
                          title={formatDate(item.dueDate)}
                        />
                      )}
                    </div>
                    {item.content && (
                      <div className="mt-2 text-xs text-gray-400 line-clamp-2 prose prose-invert prose-a:text-purple-400 prose-a:no-underline hover:prose-a:underline max-w-none">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[rehypeRaw]}
                          components={{
                            a: ({ node, ...props }: any) => (
                              <a
                                {...props}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-purple-400 hover:text-purple-300"
                              />
                            ),
                          }}
                        >
                          {item.content.length > 150
                            ? `${item.content.substring(0, 150)}...`
                            : item.content}
                        </ReactMarkdown>
                      </div>
                    )}
                    {/* Editable estimatedDays and dueDate in roadmap */}
                    {editingItem === item.id && (
                      <div className="mt-2 border-t border-gray-700 pt-2 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-gray-400 mb-1 block">
                              Estimated Days
                            </label>
                            <Input
                              type="number"
                              min="1"
                              value={editingEstimatedDays || ""}
                              onChange={(e) =>
                                setEditingEstimatedDays(
                                  e.target.value
                                    ? parseInt(e.target.value)
                                    : undefined
                                )
                              }
                              placeholder="e.g. 7"
                              className="text-xs"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-gray-400 mb-1 block">
                              Due Date
                            </label>
                            <Input
                              type="date"
                              value={editingDueDate}
                              onChange={(e) =>
                                setEditingDueDate(e.target.value)
                              }
                              className="text-xs"
                            />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleSaveItem(item.id)}
                            className="flex-1"
                          >
                            <Save className="h-3 w-3 mr-1" />
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingItem(null);
                              setEditingTitle("");
                              setEditingContent("");
                              setEditingEstimatedDays(undefined);
                              setEditingDueDate("");
                            }}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    )}
                    {editingItem !== item.id && (
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingItem(item.id);
                            setEditingTitle(item.title);
                            setEditingContent(item.content || "");
                            setEditingEstimatedDays(item.estimatedDays);
                            setEditingDueDate(
                              item.dueDate
                                ? new Date(item.dueDate)
                                    .toISOString()
                                    .split("T")[0] || ""
                                : ""
                            );
                          }}
                          className="text-xs text-purple-400 hover:text-purple-300"
                        >
                          Edit duration/deadline
                        </button>
                        {item.type === "issue" && item.issueId && (
                          <Link
                            href={`/${entity}/${repo}/issues/${item.issueId}`}
                            className="text-xs text-purple-400 hover:text-purple-300"
                            onClick={(e) => e.stopPropagation()}
                          >
                            View Issue →
                          </Link>
                        )}
                        {item.type === "pr" && item.prId && (
                          <Link
                            href={`/${entity}/${repo}/pulls/${item.prId}`}
                            className="text-xs text-purple-400 hover:text-purple-300"
                            onClick={(e) => e.stopPropagation()}
                          >
                            View PR →
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="text-center text-gray-500 py-8">
                <p>Add items to see timeline</p>
                <p className="text-xs mt-1">
                  Items auto-estimated based on type and content
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-4"
                  onClick={() => handleAddItem("note")}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Item
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Quick Add from Open Issues - Smart Suggestions */}
        {openIssues.length > 0 && (
          <div className="border border-[#383B42] rounded p-4 bg-[#171B21]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Quick Add from Open Issues</h3>
              <span className="text-xs text-gray-400">
                {openIssues.length} open
              </span>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {openIssues.map((issue: any) => {
                const alreadyAdded = project.items.some(
                  (item) => item.issueId === issue.id
                );
                // Smart priority detection
                const title = (issue.title || "").toLowerCase();
                const isHighPriority =
                  title.includes("urgent") ||
                  title.includes("critical") ||
                  title.includes("bug");
                const isLowPriority =
                  title.includes("enhancement") ||
                  title.includes("nice to have");

                return (
                  <div
                    key={issue.id}
                    className="flex items-center justify-between p-2 bg-gray-900 rounded border border-gray-700 hover:border-purple-500 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {issue.title}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-gray-400">
                          #{issue.id?.slice(0, 8) || "issue"}
                        </span>
                        {issue.bountyAmount && (
                          <span className="text-xs bg-yellow-900/50 text-yellow-300 px-1 rounded">
                            {issue.bountyAmount} sats
                          </span>
                        )}
                        {isHighPriority && (
                          <span className="text-xs bg-red-900/50 text-red-300 px-1 rounded">
                            High
                          </span>
                        )}
                        {isLowPriority && (
                          <span className="text-xs bg-gray-700 text-gray-400 px-1 rounded">
                            Low
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={alreadyAdded}
                      onClick={() => handleAddItem("issue", issue.id)}
                    >
                      {alreadyAdded ? "Added" : "Add"}
                    </Button>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-gray-500 mt-3">
              💡 Issues with bounties or high-priority keywords are highlighted
            </p>
          </div>
        )}

        {/* Auto-planning helper */}
        <div className="border border-purple-500/30 rounded p-4 bg-purple-900/10">
          <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Smart Planning Tips
          </h4>
          <ul className="text-xs text-gray-300 space-y-1 list-disc list-inside">
            <li>
              Items are auto-estimated: notes (1 day), bugs (2 days), features
              (7-10 days)
            </li>
            <li>Click "Set deadline" to auto-schedule based on estimate</li>
            <li>Mark high-priority items for urgent issues</li>
            <li>Roadmap shows timeline - overdue items highlighted in red</li>
            <li>Drag items in Kanban view to update status</li>
          </ul>
        </div>
      </div>
    );
  };

  return (
    <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Folder className="h-6 w-6" />
          Projects
        </h1>
        <div className="flex gap-2">
          {project && (
            <Button variant="outline" onClick={handleToggleView}>
              {project.view === "kanban" ? (
                <>
                  <TrendingUp className="mr-2 h-4 w-4" />
                  Roadmap
                </>
              ) : (
                <>
                  <Folder className="mr-2 h-4 w-4" />
                  Kanban
                </>
              )}
            </Button>
          )}
          <Button onClick={handleCreateProject}>
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Projects List */}
        <div className="lg:col-span-1">
          <h2 className="font-semibold mb-3">Projects</h2>
          {projects.length === 0 ? (
            <div className="border border-[#383B42] rounded p-6 text-center bg-[#171B21]">
              <Folder className="h-8 w-8 mx-auto mb-2 text-gray-500" />
              <p className="text-sm text-gray-400 mb-4">No projects yet</p>
              <Button size="sm" onClick={handleCreateProject}>
                <Plus className="mr-2 h-4 w-4" />
                Create Project
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {projects.map((p) => (
                <div
                  key={p.id}
                  className={`group relative w-full border rounded ${
                    selectedProject === p.id
                      ? "border-purple-500 bg-purple-900/20"
                      : "border-[#383B42]"
                  }`}
                >
                  {editingProjectName === p.id ? (
                    <div className="p-3 space-y-2">
                      <Input
                        value={editingProjectNameValue}
                        onChange={(e) =>
                          setEditingProjectNameValue(e.target.value)
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleSaveProjectName(p.id);
                          } else if (e.key === "Escape") {
                            handleCancelEditProjectName();
                          }
                        }}
                        className="text-sm font-semibold"
                        autoFocus
                      />
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          onClick={() => handleSaveProjectName(p.id)}
                          className="flex-1"
                        >
                          <Save className="h-3 w-3 mr-1" />
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleCancelEditProjectName}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => setSelectedProject(p.id)}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          handleStartEditProjectName(p.id);
                        }}
                        className="w-full text-left p-3 hover:bg-white/5"
                        title="Double-click to edit name"
                      >
                        <div className="font-semibold">{p.name}</div>
                        <div className="text-xs text-gray-400 mt-1">
                          {(p.items || []).length} items •{" "}
                          {p.view === "kanban" ? "Kanban" : "Roadmap"}
                        </div>
                      </button>
                      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartEditProjectName(p.id);
                          }}
                          className="p-1.5 hover:bg-purple-900/50 rounded text-purple-400 hover:text-purple-300"
                          title="Edit project name"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteProject(p.id);
                          }}
                          className="p-1.5 hover:bg-red-900/50 rounded text-red-400 hover:text-red-300"
                          title="Delete project"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Project Board/Roadmap */}
        <div className="lg:col-span-3">
          {project ? (
            <div>
              <div className="mb-4">
                <input
                  type="text"
                  value={project.name}
                  onChange={(e) => {
                    const updated = projects.map((p) =>
                      p.id === project.id ? { ...p, name: e.target.value } : p
                    );
                    saveProjects(updated);
                  }}
                  className="text-2xl font-bold bg-transparent border-none outline-none focus:border-b border-purple-500"
                />
                {project.description && (
                  <p className="text-gray-400 mt-2">{project.description}</p>
                )}
              </div>

              {project.view === "kanban" ? renderKanban() : renderRoadmap()}

              <div className="mt-4 text-sm text-gray-400 space-y-1">
                <p>💡 Drag items between columns to update status</p>
                <p>
                  💡 Click items to edit title and notes (markdown & links
                  supported)
                </p>
                <p>💡 Add notes for planning, links to docs, or task details</p>
              </div>
            </div>
          ) : (
            <div className="border border-[#383B42] rounded p-12 text-center bg-[#171B21]">
              <Folder className="h-12 w-12 mx-auto mb-4 text-gray-500" />
              <h3 className="text-xl font-semibold mb-2">
                No project selected
              </h3>
              <p className="text-gray-400 mb-4">
                Create a new project to start organizing your work
              </p>
              <Button onClick={handleCreateProject}>
                <Plus className="mr-2 h-4 w-4" />
                New Project
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
