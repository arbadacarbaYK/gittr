"use client";

import { useEffect, useMemo, useState, use } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { X, Plus, FileDiff, GitBranch } from "lucide-react";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import useSession from "@/lib/nostr/useSession";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import { getRepoStorageKey } from "@/lib/utils/entity-normalizer";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";
import { loadStoredRepos, type StoredRepo, type StoredContributor } from "@/lib/repos/storage";
import {
  clearAllPendingChanges,
  removePendingEdit,
  removePendingUpload,
  getAllPendingChanges,
} from "@/lib/pending-changes";
import { showToast } from "@/components/ui/toast";
import { createPullRequestEvent, KIND_PULL_REQUEST } from "@/lib/nostr/events";
import { getRepoOwnerPubkey, resolveEntityToPubkey } from "@/lib/utils/entity-resolver";
import { getNostrPrivateKey } from "@/lib/security/encryptedStorage";
import { getEventHash, getPublicKey } from "nostr-tools";
import { sendNotification, formatNotificationMessage } from "@/lib/notifications";
import { extractMentionedPubkeys } from "@/lib/utils/mention-detection";

interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted";
  before?: string;
  after?: string;
  isBinary?: boolean;
  mimeType?: string;
}

export default function NewPullRequestPage({ params }: { params: Promise<{ entity: string; repo: string }> }) {
  const resolvedParams = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { pubkey: currentUserPubkey, publish, defaultRelays } = useNostrContext();
  const { isLoggedIn } = useSession();

  // URL params for compare page integration
  const baseBranchParam = searchParams?.get("base") || null;
  const compareBranchParam = searchParams?.get("compare") || null;

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [baseBranch, setBaseBranch] = useState(baseBranchParam || "main");
  const [headBranch, setHeadBranch] = useState(compareBranchParam || "");
  const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [linkedIssue, setLinkedIssue] = useState<string>("");
  const [repoOwnerPubkey, setRepoOwnerPubkey] = useState<string | null>(null);

  // Get repo owner metadata for display
  const repoOwnerPubkeys = useMemo(() => {
    return repoOwnerPubkey && /^[a-f0-9]{64}$/i.test(repoOwnerPubkey) ? [repoOwnerPubkey] : [];
  }, [repoOwnerPubkey]);
  const repoOwnerMetadata = useContributorMetadata(repoOwnerPubkeys);

  // Load pending changes on mount
  useEffect(() => {
    if (!isLoggedIn || !currentUserPubkey) {
      setLoading(false);
      return;
    }

    const loadPendingChanges = async () => {
      try {
        // Load branches and get repo owner
        const repos = loadStoredRepos();
        const repo = findRepoByEntityAndName<StoredRepo>(repos, resolvedParams.entity, resolvedParams.repo);
        if (repo?.branches && Array.isArray(repo.branches)) {
          setBranches(repo.branches as string[]);
          if (!baseBranchParam) {
            setBaseBranch(repo.defaultBranch || "main");
          }
        }
        
        // Get repo owner pubkey for display
        if (repo?.ownerPubkey && /^[a-f0-9]{64}$/i.test(repo.ownerPubkey)) {
          setRepoOwnerPubkey(repo.ownerPubkey);
        } else if (repo?.contributors && repo.contributors.length > 0) {
          const owner = repo.contributors.find((c: StoredContributor) => c.weight === 100 || !c.weight) || repo.contributors[0];
          if (owner?.pubkey && /^[a-f0-9]{64}$/i.test(owner.pubkey)) {
            setRepoOwnerPubkey(owner.pubkey);
          }
        }

        // Load pending edits and uploads
        const { edits, uploads } = getAllPendingChanges(resolvedParams.entity, resolvedParams.repo, currentUserPubkey);
        
        // Convert to changedFiles format
        const files: ChangedFile[] = [];
        
        // Add edits
        edits.forEach(edit => {
          files.push({
            path: edit.path,
            status: edit.type === "delete" ? "deleted" : "modified",
            before: edit.before,
            after: edit.after,
          });
        });

        // Add uploads (new files)
        uploads.forEach(upload => {
          // Check if file already exists (would be a modification)
          const existingEdit = edits.find(e => e.path === upload.path);
          if (!existingEdit) {
            files.push({
              path: upload.path,
              status: "added",
              after: upload.content,
              isBinary: upload.isBinary,
              mimeType: upload.mimeType,
            });
          }
        });

        setChangedFiles(files);

        // Auto-generate title if multiple files
        if (files.length > 0 && !title) {
          if (files.length === 1 && files[0]) {
            const file = files[0];
            const fileName = file?.path ? file.path.split('/').pop() || file.path : 'file';
            setTitle(`Update ${fileName}`);
          } else {
            setTitle(`Update ${files.length} files`);
          }
        }

        // Load from compare page params if present
        if (baseBranchParam && compareBranchParam) {
          // TODO: Load diff files from compare
          // For now, show message that compare integration is in progress
        }

      } catch (error) {
        console.error("Failed to load pending changes:", error);
        showToast("Failed to load pending changes", "error");
      } finally {
        setLoading(false);
      }
    };

    loadPendingChanges();
  }, [resolvedParams.entity, resolvedParams.repo, currentUserPubkey, isLoggedIn, baseBranchParam, compareBranchParam, title]);

  // Load issues for linking
  const [issues, setIssues] = useState<Array<{ id: string; title: string; status: string }>>([]);
  useEffect(() => {
    try {
      const issuesKey = getRepoStorageKey("gittr_issues", resolvedParams.entity, resolvedParams.repo);
      const allIssues = JSON.parse(localStorage.getItem(issuesKey) || "[]");
      setIssues(allIssues.filter((i: any) => i.status === "open"));
      
      // Pre-select issue if linked from URL params
      const issueParam = searchParams?.get("issue");
      if (issueParam && !linkedIssue) {
        // Check if issue exists in the list - match by id or by numeric index
        const issueExists = allIssues.find((i: any, index: number) => 
          i.id === issueParam || 
          String(i.id) === issueParam ||
          String(index + 1) === issueParam
        );
        if (issueExists) {
          // Use the actual issue ID from the found issue, not the param (handles both numeric and string IDs)
          setLinkedIssue(issueExists.id || issueParam);
        }
      }
    } catch {}
  }, [resolvedParams.entity, resolvedParams.repo, searchParams, linkedIssue]);

  const canSubmit = useMemo(() => {
    return title.trim().length > 0 && changedFiles.length > 0 && baseBranch;
  }, [title, changedFiles.length, baseBranch]);

  const handleRemoveFile = (path: string) => {
    if (!currentUserPubkey) return;
    
    const file = changedFiles.find(f => f.path === path);
    if (!file) return;

    // Remove from pending changes
    if (file.status === "added") {
      removePendingUpload(resolvedParams.entity, resolvedParams.repo, currentUserPubkey, path);
    } else {
      removePendingEdit(resolvedParams.entity, resolvedParams.repo, currentUserPubkey, path);
    }

    // Update UI
    setChangedFiles(changedFiles.filter(f => f.path !== path));
  };

  const handleCreatePR = async () => {
    if (!canSubmit || !currentUserPubkey || creating) return;

    setCreating(true);
    try {
      const entity = resolvedParams.entity;
      const repo = resolvedParams.repo;
      
      if (!entity || !repo) {
        showToast("Invalid repository context", "error");
        setCreating(false);
        return;
      }

      // Check for NIP-07 or private key
      const hasNip07 = typeof window !== "undefined" && window.nostr;
      const privateKey = hasNip07 ? null : await getNostrPrivateKey();
      
      if (!hasNip07 && !privateKey) {
        showToast("No signing method available. Please configure NIP-07 or private key.", "error");
        setCreating(false);
        return;
      }

      // Get repo data for NIP-34 required fields
      const repos = loadStoredRepos();
      const repoData = findRepoByEntityAndName(repos, entity, repo);
      if (!repoData) {
        showToast("Repository not found. Please ensure the repository exists.", "error");
        setCreating(false);
        return;
      }
      
      // Get owner pubkey (required for NIP-34 "a" and "p" tags)
      let finalOwnerPubkey = getRepoOwnerPubkey(repoData, entity);
      if (!finalOwnerPubkey || !/^[0-9a-f]{64}$/i.test(finalOwnerPubkey)) {
        const resolved = resolveEntityToPubkey(entity, repoData);
        if (!resolved || !/^[0-9a-f]{64}$/i.test(resolved)) {
          showToast("Cannot determine repository owner. Please ensure the repository is properly configured.", "error");
          setCreating(false);
          return;
        }
        finalOwnerPubkey = resolved;
      }
      
      // Get earliest unique commit (optional but recommended for NIP-34 "r" tag)
      const earliestUniqueCommit = (repoData as any).earliestUniqueCommit || 
                                  (repoData.commits && Array.isArray(repoData.commits) && repoData.commits.length > 0 
                                    ? (repoData.commits[0] as any)?.id 
                                    : undefined);
      
      // Get clone URLs from repo data (required for NIP-34 "clone" tag)
      const cloneUrls: string[] = [];
      if (repoData.clone && Array.isArray(repoData.clone)) {
        cloneUrls.push(...repoData.clone.filter((url: string) => 
          url && typeof url === "string" && 
          (url.startsWith("http://") || url.startsWith("https://")) &&
          !url.includes("localhost") && !url.includes("127.0.0.1")
        ));
      }
      
      // If no clone URLs, try to construct from git server URL
      if (cloneUrls.length === 0) {
        const gitServerUrl = process.env.NEXT_PUBLIC_GIT_SERVER_URL;
        if (gitServerUrl && finalOwnerPubkey) {
          const cleanUrl = gitServerUrl.trim().replace(/^["']|["']$/g, '');
          cloneUrls.push(`${cleanUrl}/${finalOwnerPubkey}/${repo}.git`);
        }
      }
      
      // Generate a commit ID for the PR branch tip (required for NIP-34 "c" tag)
      // For now, we'll use a placeholder - in a real implementation, this would be the actual commit ID
      // from the PR branch. Since we're creating a PR from pending changes, we need to either:
      // 1. Push the branch first and get the commit ID, or
      // 2. Generate a temporary commit ID that will be updated when the PR is actually pushed
      // For NIP-34 compliance, we'll generate a deterministic ID based on the PR content
      const currentCommitId = `pr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // If we have actual commit info from the branch, use that instead
      // TODO: Fetch actual commit ID from the PR branch if it exists

      let prEvent: any;
      let authorPubkey: string;

      if (hasNip07 && window.nostr) {
        // Use NIP-07 extension
        authorPubkey = await window.nostr.getPublicKey();
        
        // Create NIP-34 compliant event
        const tags: string[][] = [
          // ["a", "30617:<base-repo-owner-pubkey>:<base-repo-id>"] - REQUIRED
          ["a", `30617:${finalOwnerPubkey}:${repo}`],
          // ["r", "<earliest-unique-commit-id-of-repo>"] - REQUIRED (helps clients subscribe)
          ...(earliestUniqueCommit ? [["r", earliestUniqueCommit]] : []),
          // ["p", "<repository-owner>"] - REQUIRED
          ["p", finalOwnerPubkey],
          // ["subject", "<PR-subject>"] - REQUIRED
          ["subject", title.trim()],
          // ["c", "<current-commit-id>"] - REQUIRED (tip of PR branch)
          ["c", currentCommitId],
          // ["clone", "<clone-url>", ...] - REQUIRED (at least one git clone URL)
          ...cloneUrls.map(url => ["clone", url]),
        ];
        
        // Optional tags
        if (headBranch || baseBranch) {
          tags.push(["branch-name", headBranch || baseBranch]);
        }
        
        if (linkedIssue) {
          tags.push(["e", linkedIssue, "", "linked"]);
        }
        
        // Custom extensions (not in NIP-34 but we keep for backward compatibility)
        // Labels, assignees, etc. would go here if we had them
        
        prEvent = {
          kind: KIND_PULL_REQUEST, // NIP-34: kind 1618
          created_at: Math.floor(Date.now() / 1000),
          tags,
          content: body.trim(), // Markdown text per NIP-34 (not JSON)
          pubkey: authorPubkey,
          id: "",
          sig: "",
        };

        // Hash event
        prEvent.id = getEventHash(prEvent);
        
        // Sign with NIP-07
        const signedEvent = await window.nostr.signEvent(prEvent);
        prEvent = signedEvent;
      } else if (privateKey) {
        // Use private key
        authorPubkey = getPublicKey(privateKey);
        
        prEvent = createPullRequestEvent(
          {
            repoEntity: entity,
            repoName: repo,
            ownerPubkey: finalOwnerPubkey,
            earliestUniqueCommit,
            title: title.trim(),
            description: body.trim(),
            status: "open",
            baseBranch,
            headBranch: headBranch || baseBranch,
            currentCommitId,
            cloneUrls: cloneUrls.length > 0 ? cloneUrls : undefined,
            branchName: headBranch || baseBranch,
            linkedIssue: linkedIssue || undefined,
          },
          privateKey
        );
        authorPubkey = prEvent.pubkey;
      } else {
        throw new Error("No signing method available");
      }

      // Store locally
      const prsKey = `gittr_prs__${entity}__${repo}`;
      const prs = JSON.parse(localStorage.getItem(prsKey) || "[]");
      
      const prId = prEvent.id || `pr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      const newPR = {
        id: prId,
        title: title.trim(),
        body: body.trim(),
        status: "open" as const,
        author: authorPubkey,
        contributors: [authorPubkey],
        baseBranch,
        headBranch: headBranch || undefined,
        changedFiles,
        createdAt: Date.now(),
        linkedIssue: linkedIssue || undefined,
      };

      prs.unshift(newPR);
      localStorage.setItem(prsKey, JSON.stringify(prs));

      // Clear pending changes
      clearAllPendingChanges(entity, repo, authorPubkey);

      // Send notification to repo watchers about new PR
      try {
        // Get repo owner pubkey for notification
        const repos = loadStoredRepos();
        const repoData = repos.find((r: StoredRepo) => r.entity === entity && r.repo === repo);
        const ownerPubkey = getRepoOwnerPubkey(repoData, entity);
        
        if (ownerPubkey) {
          const notification = formatNotificationMessage("pr_opened", {
            repoEntity: entity,
            repoName: repo,
            prId: prId,
            prTitle: newPR.title,
            url: typeof window !== "undefined" ? `${window.location.origin}/${entity}/${repo}/pulls/${prId}` : undefined,
          });

          await sendNotification({
            eventType: "pr_opened",
            title: notification.title,
            message: notification.message,
            url: notification.url,
            repoEntity: entity,
            repoName: repo,
            recipientPubkey: ownerPubkey,
          });
        }
      } catch (error) {
        console.error("Failed to send pr_opened notification:", error);
        // Don't block PR creation if notification fails
      }

      // Detect @mentions in PR body and send notifications
      try {
        const mentionedPubkeys = extractMentionedPubkeys(body);
        const uniqueMentions = Array.from(new Set(mentionedPubkeys));
        
        // Filter out the PR author (don't notify yourself)
        const mentionsToNotify = uniqueMentions.filter(pubkey => 
          pubkey.toLowerCase() !== authorPubkey.toLowerCase()
        );
        
        if (mentionsToNotify.length > 0) {
          const notification = formatNotificationMessage("mention", {
            repoEntity: entity,
            repoName: repo,
            prId: prId,
            prTitle: newPR.title,
            authorName: "Someone",
            url: typeof window !== "undefined" ? `${window.location.origin}/${entity}/${repo}/pulls/${prId}` : undefined,
          });
          
          // Send notification to each mentioned user
          await Promise.all(
            mentionsToNotify.map(pubkey =>
              sendNotification({
                eventType: "mention",
                title: notification.title,
                message: notification.message,
                url: notification.url,
                repoEntity: entity,
                repoName: repo,
                recipientPubkey: pubkey,
              }).catch(err => {
                console.error(`Failed to send mention notification to ${pubkey.slice(0, 8)}...:`, err);
              })
            )
          );
        }
      } catch (error) {
        console.error("Failed to send mention notifications:", error);
        // Don't block PR creation if mention notifications fail
      }

      // Publish to Nostr relays
      if (publish && defaultRelays && defaultRelays.length > 0) {
        try {
          publish(prEvent, defaultRelays);
          console.log("Published PR to Nostr:", prEvent.id);
        } catch (error: any) {
          console.error("Failed to publish PR to Nostr:", error);
          // Don't fail the PR creation if publishing fails - it's already saved locally
        }
      } else {
        console.warn("Publish function not available - PR saved locally only");
      }

      showToast("Pull request created!", "success");
      router.push(`/${entity}/${repo}/pulls/${prId}`);
    } catch (error: any) {
      console.error("Failed to create PR:", error);
      showToast(`Failed to create pull request: ${error.message || "Unknown error"}`, "error");
    } finally {
      setCreating(false);
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
        <p className="text-gray-400">Please log in to create a pull request.</p>
        <Link href="/login" className="text-purple-500 hover:underline mt-2 inline-block">
          Go to login
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  if (changedFiles.length === 0 && !baseBranchParam) {
    return (
      <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
        <h1 className="text-2xl font-bold mb-4">Open a pull request</h1>
        <div className="border border-gray-700 rounded p-8 text-center">
          <FileDiff className="h-12 w-12 mx-auto mb-4 text-gray-600" />
          <p className="text-gray-400 mb-2">No changes detected</p>
          <p className="text-sm text-gray-500 mb-4">
            You need to edit files or upload files before creating a pull request.
          </p>
          <Link 
            href={`/${resolvedParams.entity}/${resolvedParams.repo}`}
            className="text-purple-500 hover:underline"
          >
            Go to repository
          </Link>
        </div>
      </div>
    );
  }

  const totalAdditions = changedFiles.reduce((sum, f) => {
    if (f.after && f.before) {
      return sum + Math.max(0, f.after.length - f.before.length);
    }
    return sum + (f.after?.length || 0);
  }, 0);

  const totalDeletions = changedFiles.reduce((sum, f) => {
    if (f.after && f.before) {
      return sum + Math.max(0, f.before.length - f.after.length);
    }
    return sum + (f.before?.length || 0);
  }, 0);

  return (
    <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
      <h1 className="text-2xl font-bold mb-4">Open a pull request</h1>
      
      <div className="mb-4 text-sm text-gray-400">
        Repository: <Link href={`/${resolvedParams.entity}/${resolvedParams.repo}`} className="text-purple-500 hover:underline">
          {(() => {
            // Show owner name if available, otherwise fallback to entity
            if (repoOwnerPubkey && repoOwnerMetadata[repoOwnerPubkey]) {
              const meta = repoOwnerMetadata[repoOwnerPubkey];
              return (meta?.display_name || meta?.name || resolvedParams.entity) + "/" + resolvedParams.repo;
            }
            return `${resolvedParams.entity}/${resolvedParams.repo}`;
          })()}
        </Link>
      </div>

      {/* Branch Selection */}
      <div className="mb-6 flex items-center gap-4">
        <div className="flex-1">
          <label className="block text-sm font-medium mb-2">Base branch</label>
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-gray-400" />
            <select
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              className="flex-1 px-3 py-2 bg-[#171B21] border border-gray-700 rounded text-white"
            >
              {branches.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
              {branches.length === 0 && <option value="main">main</option>}
            </select>
          </div>
        </div>
        {headBranch && (
          <>
            <span className="text-gray-400 mt-6">←</span>
            <div className="flex-1">
              <label className="block text-sm font-medium mb-2">Compare branch</label>
              <select
                value={headBranch}
                onChange={(e) => setHeadBranch(e.target.value)}
                className="flex-1 px-3 py-2 bg-[#171B21] border border-gray-700 rounded text-white"
              >
                {branches.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      {/* Changed Files Summary */}
      {changedFiles.length > 0 && (
        <div className="mb-6 p-4 bg-[#171B21] border border-gray-700 rounded">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FileDiff className="h-5 w-5 text-gray-400" />
              <span className="font-semibold">
                {changedFiles.length} file{changedFiles.length !== 1 ? "s" : ""} changed
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href={`/${resolvedParams.entity}/${resolvedParams.repo}/new-file`}
                className="text-sm text-purple-500 hover:text-purple-400 hover:underline flex items-center gap-1"
              >
                <Plus className="h-4 w-4" />
                Add file
              </Link>
              <Link
                href={`/${resolvedParams.entity}/${resolvedParams.repo}`}
                className="text-sm text-purple-500 hover:text-purple-400 hover:underline flex items-center gap-1"
              >
                <Plus className="h-4 w-4" />
                Edit file
              </Link>
            </div>
            {totalAdditions > 0 && (
              <span className="text-green-400 text-sm">+{totalAdditions}</span>
            )}
            {totalDeletions > 0 && (
              <span className="text-red-400 text-sm">-{totalDeletions}</span>
            )}
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {changedFiles.map((file, idx) => (
              <div key={idx} className="flex items-center justify-between p-2 bg-[#0E1116] rounded">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Badge
                    className={
                      file.status === "added"
                        ? "bg-green-600"
                        : file.status === "deleted"
                        ? "bg-red-600"
                        : "bg-yellow-600"
                    }
                  >
                    {file.status}
                  </Badge>
                  <span className="text-sm font-mono text-gray-300 truncate">{file.path}</span>
                </div>
                <button
                  onClick={() => handleRemoveFile(file.path)}
                  className="ml-2 text-gray-400 hover:text-red-400"
                  title="Remove from PR"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PR Form */}
      <div className="space-y-4 mb-6">
        <div>
          <label className="block text-sm font-medium mb-2">Title</label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add a title for your pull request"
            className="w-full"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Description</label>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Describe your changes (markdown supported)"
            className="w-full h-32"
          />
        </div>
        {issues.length > 0 && (
          <div>
            <label className="block text-sm font-medium mb-2">Link issue (optional)</label>
            <select
              value={linkedIssue}
              onChange={(e) => setLinkedIssue(e.target.value)}
              className="w-full px-3 py-2 bg-[#171B21] border border-gray-700 rounded text-white"
            >
              <option value="">None</option>
              {issues.map(issue => (
                <option key={issue.id} value={issue.id}>
                  #{issue.id} - {issue.title}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button
          onClick={handleCreatePR}
          disabled={!canSubmit || creating}
          variant="default"
        >
          {creating ? "Creating..." : "Create pull request"}
        </Button>
        <Link 
          href={`/${resolvedParams.entity}/${resolvedParams.repo}`}
          className="text-sm text-gray-400 hover:text-white"
        >
          Cancel
        </Link>
      </div>
    </div>
  );
}
