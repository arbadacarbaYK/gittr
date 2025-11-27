"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ZapButton } from "@/components/ui/zap-button";
import useSession from "@/lib/nostr/useSession";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import {
  CheckCircle2,
  GitMerge,
  GitPullRequest,
  X,
  Zap,
  Users,
} from "lucide-react";
import { PRReviewSection } from "@/components/ui/pr-review-section";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import { Reactions } from "@/components/ui/reactions";
import { FileDiffViewer } from "@/components/ui/file-diff-viewer";
import { getRepoStorageKey, normalizeEntityForStorage } from "@/lib/utils/entity-normalizer";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";
import { loadStoredRepos, saveStoredRepos, loadRepoOverrides, saveRepoOverrides, saveRepoFiles, type StoredRepo, type StoredContributor, type RepoFileEntry } from "@/lib/repos/storage";
import { detectConflicts } from "@/lib/git/conflict-detection";
import { ConflictDetector } from "@/components/ui/conflict-detector";
import { nip19 } from "nostr-tools";
import { recordActivity } from "@/lib/activity-tracking";
import { formatDateTime24h } from "@/lib/utils/date-format";
import { hasWriteAccess, isOwner as checkIsOwner } from "@/lib/repo-permissions";
import { getRepoOwnerPubkey, resolveEntityToPubkey, getEntityDisplayName } from "@/lib/utils/entity-resolver";
import { getNostrPrivateKey, getSecureItem } from "@/lib/security/encryptedStorage";
import { sendNotification, formatNotificationMessage } from "@/lib/notifications";
import { createBountyEvent, KIND_BOUNTY, createPullRequestEvent, KIND_PULL_REQUEST } from "@/lib/nostr/events";
import { getEventHash, getPublicKey, signEvent } from "nostr-tools";

interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted";
  before?: string;
  after?: string;
  isBinary?: boolean;
  mimeType?: string;
}

interface PRData {
  id: string;
  title: string;
  body: string;
  path?: string;
  before?: string;
  after?: string;
  changedFiles?: ChangedFile[];
  author: string;
  createdAt: number;
  status: "open" | "merged" | "closed";
  contributors?: string[];
  linkedIssue?: string;
  mergeCommit?: string;
  mergedAt?: number;
  mergedBy?: string;
  baseBranch?: string;
  headBranch?: string;
}

export default function PRDetailPage({ params }: { params: { entity: string; repo: string; id: string } }) {
  const router = useRouter();
  const { pubkey: currentUserPubkey, publish, defaultRelays } = useNostrContext();
  const { picture: userPicture, name: userName } = useSession();
  const [pr, setPR] = useState<PRData | null>(null);
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState(false);
  const [mergeMessage, setMergeMessage] = useState("");
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [canMerge, setCanMerge] = useState(false); // Write access (owner or maintainer)
  const [linkedIssue, setLinkedIssue] = useState<any>(null);
  const [requiredApprovals, setRequiredApprovals] = useState<number>(1);
  const { subscribe } = useNostrContext();
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [checkingBalance, setCheckingBalance] = useState(false);
  const [bountyPaymentStatus, setBountyPaymentStatus] = useState<"pending" | "success" | "failed" | null>(null);
  const [bountyPaymentHash, setBountyPaymentHash] = useState<string | null>(null);
  
  // Fetch metadata for PR author, mergedBy, contributors, and bounty creator
  const allPubkeys = useMemo(() => {
    const pubkeys = new Set<string>();
    if (pr?.author) pubkeys.add(pr.author);
    if (pr?.mergedBy) pubkeys.add(pr.mergedBy);
    if (pr?.contributors) {
      pr.contributors.forEach((p: string) => pubkeys.add(p));
    }
    // Include bounty creator if available
    if (linkedIssue?.bountyCreator) {
      pubkeys.add(linkedIssue.bountyCreator);
    }
    return Array.from(pubkeys);
  }, [pr?.author, pr?.mergedBy, pr?.contributors, linkedIssue?.bountyCreator]);
  
  const recipientMetadata = useContributorMetadata(allPubkeys);
  const recipientMeta = pr?.author ? recipientMetadata[pr.author] : null;

  // Helper function to generate repo link for relative link resolution
  const getRepoLink = useCallback((subpath: string = "") => {
    // Try to resolve entity to pubkey for npub format
    let ownerPubkey: string | null = null;
    try {
      const repos = loadStoredRepos();
      const repo = findRepoByEntityAndName<StoredRepo>(repos, params.entity, params.repo);
      if (repo) {
        ownerPubkey = getRepoOwnerPubkey(repo, params.entity);
      }
    } catch (e) {
      // Fallback to decoding entity
      try {
        const decoded = nip19.decode(params.entity);
        if (decoded.type === "npub") {
          ownerPubkey = decoded.data as string;
        }
      } catch {}
    }
    
    const basePath = ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey)
      ? `/${nip19.npubEncode(ownerPubkey)}/${params.repo}${subpath ? `/${subpath}` : ""}`
      : `/${params.entity}/${params.repo}${subpath ? `/${subpath}` : ""}`;
    return basePath;
  }, [params.entity, params.repo]);

  // Load required approvals from repo settings
  useEffect(() => {
    try {
      const repos = loadStoredRepos();
      const repo = findRepoByEntityAndName<StoredRepo>(repos, params.entity, params.repo);
      // requiredApprovals is not in StoredRepo interface, default to 0
      setRequiredApprovals(0);
    } catch {}
  }, [params.entity, params.repo]);

  // Load PR data
  useEffect(() => {
    try {
      const key = getRepoStorageKey("gittr_prs", params.entity, params.repo);
      const prs = JSON.parse(localStorage.getItem(key) || "[]") as any[];
      const prData = prs.find((p: any) => p.id === params.id || String(prs.indexOf(p) + 1) === params.id);
      
      if (prData) {
        setPR({
          id: prData.id || params.id,
          title: prData.title || "",
          body: prData.body || "",
          path: prData.path,
          before: prData.before,
          after: prData.after,
          changedFiles: prData.changedFiles,
          author: prData.author || "unknown",
          createdAt: prData.createdAt || Date.now(),
          status: prData.status || "open",
          contributors: prData.contributors || [],
          linkedIssue: prData.linkedIssue || prData.issueId,
          mergeCommit: prData.mergeCommit,
          mergedAt: prData.mergedAt,
          mergedBy: prData.mergedBy,
          baseBranch: prData.baseBranch || "main",
          headBranch: prData.headBranch,
        });
        
        // Check if current user can merge (owner or maintainer - write access)
        const repos = loadStoredRepos();
        // Try multiple lookup strategies - repo might be stored with different field names
        let repo = repos.find((r: StoredRepo) => {
          const entityMatch = r.entity === params.entity;
          const repoMatch = r.repo === params.repo || r.slug === params.repo || r.name === params.repo;
          return entityMatch && repoMatch;
        });
        
        if (repo && currentUserPubkey) {
          // CRITICAL: Use proper role-based permission checks
          const repoOwnerPubkey = getRepoOwnerPubkey(repo, params.entity);
          const userIsOwnerValue = checkIsOwner(currentUserPubkey, repo.contributors, repoOwnerPubkey);
          const userCanMerge = hasWriteAccess(currentUserPubkey, repo.contributors, repoOwnerPubkey);
          
          setIsOwner(userIsOwnerValue);
          setCanMerge(userCanMerge);
        } else if (currentUserPubkey) {
          // FALLBACK: If repo not found, check if params.entity (npub) matches current user
          // Decode npub to compare with full pubkey
          const entityPubkey = resolveEntityToPubkey(params.entity);
          const entityMatches = entityPubkey && entityPubkey.toLowerCase() === currentUserPubkey.toLowerCase();
          
          if (entityMatches) {
            // User is viewing their own repo (not yet synced to localStorage)
            // Allow merge for demo/testing purposes
            setIsOwner(true);
            setCanMerge(true);
          } else {
            // Not the owner - can't merge
            setIsOwner(false);
            setCanMerge(false);
          }
        } else {
          // User not logged in - can't be owner or merge
          setIsOwner(false);
          setCanMerge(false);
        }
        
        // Load linked issue if present
        if (prData.linkedIssue || prData.issueId) {
          const issueKey = getRepoStorageKey("gittr_issues", params.entity, params.repo);
          const issues = JSON.parse(localStorage.getItem(issueKey) || "[]");
          const issue = issues.find((i: any) => 
            i.id === (prData.linkedIssue || prData.issueId) || 
            i.number === (prData.linkedIssue || prData.issueId)
          );
          if (issue) setLinkedIssue(issue);
        }
      }
      setLoading(false);
    } catch (error) {
      console.error("Failed to load PR:", error);
      setLoading(false);
    }
  }, [params.id, params.entity, params.repo, currentUserPubkey]);

  const changedFiles = useMemo(() => {
    if (pr?.changedFiles && pr.changedFiles.length > 0) {
      return pr.changedFiles;
    }
    if (pr?.path) {
      return [{
        path: pr.path,
        status: "modified" as const,
        before: pr.before,
        after: pr.after,
      }];
    }
    return [];
  }, [pr]);

  const hasChanges = changedFiles.length > 0;

  const handleMerge = useCallback(async () => {
    // Only owners and maintainers can merge (write access)
    if (!pr || !canMerge || merging) return;
    
    // CRITICAL: Require signature for merge (owner or maintainer must sign)
    if (!currentUserPubkey) {
      alert("Please log in to merge pull requests");
      return;
    }
    
    // Get private key for signing (required for merge)
    const privateKey = await getNostrPrivateKey();
    const hasNip07 = typeof window !== "undefined" && window.nostr;
    
    if (!privateKey && !hasNip07) {
      alert("Merge requires signature. Please configure NIP-07 extension or private key in settings.");
      return;
    }

    // Get repo data to check roles
    const repos = loadStoredRepos();
    // Try multiple lookup strategies
    const repo = repos.find((r: StoredRepo) => {
      const entityMatch = r.entity === params.entity;
      const repoMatch = r.repo === params.repo || r.slug === params.repo || r.name === params.repo;
      return entityMatch && repoMatch;
    });
    
    // CRITICAL: Use proper role-based permission checks (no sliced pubkeys!)
    // params.entity is in npub format, repo.entity should also be npub
    const repoOwnerPubkey = repo ? getRepoOwnerPubkey(repo, params.entity) : null;
    const isRepoOwner = repoOwnerPubkey && currentUserPubkey && 
      repoOwnerPubkey.toLowerCase() === currentUserPubkey.toLowerCase();
    
    // Check if user is maintainer (has write access but not owner)
    const isMaintainer = !isRepoOwner && repo && currentUserPubkey && 
      hasWriteAccess(currentUserPubkey, repo.contributors, repoOwnerPubkey);

    // Check if PR author is the owner/maintainer - can merge own PRs without approvals
    const isOwnerPR = isRepoOwner && pr.author === currentUserPubkey;
    const isMaintainerPR = isMaintainer && pr.author === currentUserPubkey;
    const canMergeOwnPR = isOwnerPR || isMaintainerPR;
    
    // Check reviews for required approvals (skip if owner/maintainer is merging their own PR)
    if (!canMergeOwnPR && requiredApprovals > 0) {
    try {
      const storageKey = `gittr_pr_reviews__${normalizeEntityForStorage(params.entity)}__${params.repo}__${pr.id}`;
      const reviews = JSON.parse(localStorage.getItem(storageKey) || "[]");
        
        // Only count approvals from users with merge rights (owners/maintainers), excluding the person doing the merge
        const approvalsFromMergeRightsHolders = reviews
          .filter((r: any) => {
            // Exclude the person doing the merge
            if (r.reviewer === currentUserPubkey) return false;
            
            // Check if reviewer has merge rights (owner or maintainer)
            if (!repo?.contributors) return false;
            
            const reviewer = repo.contributors.find((c: any) => c.pubkey === r.reviewer);
            if (!reviewer) return false;
            
            // Check if reviewer is owner or maintainer
            const reviewerIsOwner = reviewer.role === "owner" || 
              (reviewer.role === undefined && reviewer.weight === 100) ||
              repo.ownerPubkey === r.reviewer;
            const reviewerIsMaintainer = reviewer.role === "maintainer" || 
              (reviewer.role === undefined && reviewer.weight !== undefined && reviewer.weight >= 50 && reviewer.weight < 100);
            
            // Only count if reviewer has merge rights AND approved
            return (reviewerIsOwner || reviewerIsMaintainer) && r.state === "APPROVED";
          })
          .length;
        
      const changeRequests = reviews.filter((r: any) => r.state === "CHANGES_REQUESTED").length;

        if (approvalsFromMergeRightsHolders < requiredApprovals) {
          alert(`This PR requires ${requiredApprovals} approval(s) from owners/maintainers before merging. Currently has ${approvalsFromMergeRightsHolders}.`);
        return;
      }

      if (changeRequests > 0) {
        alert(`This PR has ${changeRequests} change request(s) that must be addressed before merging.`);
        return;
      }
    } catch (error) {
      console.error("Failed to check reviews:", error);
      }
    }

    setMerging(true);
    try {
      // 0. Detect conflicts before merging
      const repos = loadStoredRepos();
      const repo = findRepoByEntityAndName<StoredRepo>(repos, params.entity, params.repo);
      
      const overrides = loadRepoOverrides(params.entity, params.repo);
      
      const changedFiles: ChangedFile[] = pr.changedFiles || 
        (pr.path ? [{ 
          path: pr.path, 
          status: "modified" as const, 
          before: pr.before, 
          after: pr.after 
        }] : []);

      // Get current file state from overrides
      const baseFiles: Record<string, string> = {};
      
      for (const file of changedFiles) {
        const overrideValue = overrides[file.path];
        if (overrideValue !== undefined && overrideValue !== null && overrideValue !== "") {
          baseFiles[file.path] = overrideValue;
        } else if (repo?.sourceUrl && repo?.files) {
          baseFiles[file.path] = file.before || "";
        } else {
          baseFiles[file.path] = "";
        }
      }

      // Detect conflicts
      const conflictResult = detectConflicts(changedFiles, baseFiles, pr.baseBranch || "main");
      
      if (conflictResult.hasConflicts) {
        setMerging(false);
        setConflicts(conflictResult.conflicts);
        setShowConflictModal(true);
        return;
      }
      
      // Continue with merge (no conflicts)
      
      // 1. Apply all file changes
      let totalInsertions = 0;
      let totalDeletions = 0;
      
      changedFiles.forEach(file => {
        if (file.status === "deleted") {
          delete overrides[file.path];
          if (file.before) {
            totalDeletions += file.before.split("\n").length;
          }
        } else if (file.after !== undefined) {
          overrides[file.path] = file.after;
          if (file.before && file.after) {
            const beforeLines = file.before.split("\n");
            const afterLines = file.after.split("\n");
            const maxLines = Math.max(beforeLines.length, afterLines.length);
            
            for (let i = 0; i < maxLines; i++) {
              const beforeLine = beforeLines[i];
              const afterLine = afterLines[i];
              
              if (beforeLine === undefined && afterLine !== undefined) {
                totalInsertions++;
              } else if (beforeLine !== undefined && afterLine === undefined) {
                totalDeletions++;
              } else if (beforeLine !== undefined && afterLine !== undefined && beforeLine !== afterLine) {
                totalDeletions++;
                totalInsertions++;
              }
            }
          } else if (file.after) {
            totalInsertions += file.after.split("\n").length;
          }
        }
      });
      
      saveRepoOverrides(params.entity, params.repo, overrides);
      try {
        const storedRepos = loadStoredRepos();
        const repoIndex = storedRepos.findIndex((storedRepo: StoredRepo) => {
          const repoMatches = storedRepo.repo === params.repo || storedRepo.slug === params.repo || storedRepo.name === params.repo;
          const entityMatches =
            storedRepo.entity === params.entity ||
            storedRepo.entity?.toLowerCase() === params.entity.toLowerCase();
          return repoMatches && entityMatches;
        });

        if (repoIndex >= 0) {
          const repoRecord = { ...storedRepos[repoIndex] };
          // Ensure entity is set (required by StoredRepo type)
          if (!repoRecord.entity) {
            repoRecord.entity = params.entity;
          }
          const existingFiles: RepoFileEntry[] = Array.isArray(repoRecord.files) ? [...repoRecord.files] : [];
          const fileMap = new Map<string, RepoFileEntry>();
          existingFiles.forEach((fileEntry) => fileMap.set(fileEntry.path, fileEntry));

          changedFiles.forEach((file) => {
            if (file.status === "deleted") {
              fileMap.delete(file.path);
              return;
            }

            fileMap.set(file.path, {
              path: file.path,
              type: "file",
              isBinary: file.isBinary,
            });
          });

          const updatedFilesArray = Array.from(fileMap.values()).sort((a, b) => a.path.localeCompare(b.path));
          repoRecord.files = updatedFilesArray;
          storedRepos[repoIndex] = repoRecord as StoredRepo;
          saveStoredRepos(storedRepos);
          saveRepoFiles(params.entity, params.repo, updatedFilesArray);
          window.dispatchEvent(new Event("gittr:repo-updated"));
        }
      } catch (error) {
        console.error("Failed to sync repo files after merge:", error);
      }

      // 2. Create commit record
      const commitId = `commit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      // Get PR author name for commit message
      const authorMeta = pr.author ? recipientMetadata[pr.author] : null;
      const authorName = authorMeta?.display_name || authorMeta?.name || (pr.author && pr.author.length === 64 ? pr.author.slice(0, 8) + "..." : pr.author || "unknown");
      const commit: any = {
        id: commitId,
        message: mergeMessage.trim() || `Merge pull request #${params.id} from ${authorName}\n\n${pr.title}`,
        author: currentUserPubkey,
        timestamp: Date.now(),
        branch: pr.baseBranch || "main",
        filesChanged: changedFiles.length,
        insertions: totalInsertions,
        deletions: totalDeletions,
        prId: pr.id,
        changedFiles: changedFiles.map(f => ({ 
          path: f.path, 
          status: f.status 
        })),
      };

      const commitsKey = getRepoStorageKey("gittr_commits", params.entity, params.repo);
      const commits = JSON.parse(localStorage.getItem(commitsKey) || "[]");
      commits.unshift(commit);
      localStorage.setItem(commitsKey, JSON.stringify(commits));
      
      // Dispatch event to refresh commits page
      window.dispatchEvent(new CustomEvent("gittr:commit-created", { detail: commit }));
      
      // Record commit activity
      if (currentUserPubkey) {
        try {
          recordActivity({
            type: "commit_created",
            user: currentUserPubkey,
            repo: `${params.entity}/${params.repo}`,
            entity: params.entity,
            repoName: repo?.name || params.repo,
            metadata: {
              commitId: commitId,
              prId: pr.id,
              fileCount: changedFiles.length,
            },
          });
        } catch (error) {
          console.error("Failed to record commit activity:", error);
        }
      }

      // 3. Update PR status
      const prsKey = getRepoStorageKey("gittr_prs", params.entity, params.repo);
      const prs = JSON.parse(localStorage.getItem(prsKey) || "[]");
      const updatedPRs = prs.map((p: any) => 
        p.id === pr.id 
          ? { 
              ...p, 
              status: "merged",
              mergedAt: Date.now(),
              mergedBy: currentUserPubkey || "",
              mergeCommit: commitId,
            } 
          : p
      );
      localStorage.setItem(prsKey, JSON.stringify(updatedPRs));
      setPR({ ...pr, status: "merged", mergedAt: Date.now(), mergedBy: currentUserPubkey || "", mergeCommit: commitId });

      // 3a. Publish updated PR status to Nostr (merged)
      try {
        const hasNip07 = typeof window !== "undefined" && window.nostr;
        let prUpdateEvent: any;
        
        if (hasNip07 && window.nostr) {
          const authorPubkey = await window.nostr.getPublicKey();
          
          // Create updated PR event with merged status
          prUpdateEvent = {
            kind: KIND_PULL_REQUEST,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
              ["repo", params.entity, params.repo],
              ["branch", pr.baseBranch || "main", pr.headBranch || pr.baseBranch || "main"],
              ["status", "merged"],
              ["e", pr.id, "", "previous"], // Reference to original PR event
              ...(pr.linkedIssue ? [["e", pr.linkedIssue, "", "linked"]] : []),
            ],
            content: JSON.stringify({
              title: pr.title,
              description: pr.body || "",
              status: "merged",
              changedFiles: pr.changedFiles || [],
              mergedAt: Date.now(),
              mergedBy: currentUserPubkey || "",
              mergeCommit: commitId,
            }),
            pubkey: authorPubkey,
            id: "",
            sig: "",
          };
          
          prUpdateEvent.id = getEventHash(prUpdateEvent);
          prUpdateEvent = await window.nostr.signEvent(prUpdateEvent);
        } else if (privateKey) {
          // Use private key
          prUpdateEvent = createPullRequestEvent({
            repoEntity: params.entity,
            repoName: params.repo,
            title: pr.title,
            description: pr.body || "",
            baseBranch: pr.baseBranch || "main",
            headBranch: pr.headBranch,
            status: "merged",
            linkedIssue: pr.linkedIssue,
            changedFiles: pr.changedFiles || [],
          }, privateKey);
          
          // Add merged metadata to tags
          prUpdateEvent.tags.push(["e", pr.id, "", "previous"]); // Reference to original PR
          prUpdateEvent.tags.push(["status", "merged"]);
          prUpdateEvent.id = getEventHash(prUpdateEvent);
          prUpdateEvent.sig = signEvent(prUpdateEvent, privateKey);
        }
        
        if (publish && defaultRelays && defaultRelays.length > 0 && prUpdateEvent) {
          try {
            publish(prUpdateEvent, defaultRelays);
            console.log("✅ Published PR merge status to Nostr:", prUpdateEvent.id);
          } catch (error) {
            console.error("Failed to publish PR merge status to Nostr:", error);
            // Don't block merge if publishing fails
          }
        }
      } catch (error) {
        console.error("Failed to create PR merge event:", error);
        // Don't block merge if publishing fails
      }

      // 6. Add PR author to contributors if not already present
      if (pr.author && pr.author.length === 64) {
        try {
          const updatedRepos = loadStoredRepos();
          const repoIndex = updatedRepos.findIndex((r: StoredRepo) => 
            r.entity === params.entity && (r.repo === params.repo || r.slug === params.repo)
          );
          
          if (repoIndex >= 0) {
            const repo = updatedRepos[repoIndex];
            if (!repo) return;
            const contributors = repo.contributors || [];
            
            // Check if PR author is already a contributor
            const isContributor = contributors.some((c: StoredContributor) => 
              c.pubkey === pr.author || (c.pubkey && c.pubkey.toLowerCase() === pr.author.toLowerCase())
            );
            
            // Check if PR author is already an owner
            const isOwner = contributors.some((c: StoredContributor) => 
              c.pubkey === pr.author && c.weight === 100
            ) || repo.ownerPubkey === pr.author;
            
            if (!isContributor && !isOwner) {
              // Get PR author metadata for name
              const prAuthorMeta = recipientMetadata[pr.author];
              const prAuthorName = prAuthorMeta?.display_name || prAuthorMeta?.name || (pr.author && pr.author.length === 64 ? pr.author.slice(0, 8) + "..." : pr.author || "unknown");
              const authorNpub = pr.author && pr.author.length === 64 ? (() => {
                try {
                  return nip19.npubEncode(pr.author);
                } catch {
                  return null;
                }
              })() : null;
              
              // Add as contributor (cannot merge, only approve)
              // Role: "contributor" (not "maintainer" or "owner")
              contributors.push({
                pubkey: pr.author,
                name: prAuthorName,
                role: "contributor", // Cannot merge, can only approve
                weight: Math.max(...contributors.filter((c: any) => c.weight < 100).map((c: any) => c.weight || 0), 0) + 1 || 1,
              });
              
              updatedRepos[repoIndex] = {
                ...repo,
                contributors,
              };
              
              saveStoredRepos(updatedRepos);
              const logAuthorMeta = pr.author ? recipientMetadata[pr.author] : null;
              const logAuthorName = logAuthorMeta?.display_name || logAuthorMeta?.name || (pr.author && pr.author.length === 64 ? pr.author.slice(0, 8) + "..." : pr.author || "unknown");
              console.log(`✅ Added PR author ${logAuthorName} as contributor`);
            }
          }
        } catch (error) {
          console.error("Failed to add PR author as contributor:", error);
        }
      }

      // 4. Close linked issue if present
      if (linkedIssue) {
        const issueKey = getRepoStorageKey("gittr_issues", params.entity, params.repo);
        const issues = JSON.parse(localStorage.getItem(issueKey) || "[]");
        const updatedIssues = issues.map((i: any) => 
          (i.id === linkedIssue.id || i.number === linkedIssue.number)
            ? { ...i, status: "closed", closedAt: Date.now(), closedBy: currentUserPubkey }
            : i
        );
        localStorage.setItem(issueKey, JSON.stringify(updatedIssues));

        // 5. Release bounty if present - give PR author the withdraw link URL
        // The withdraw link was already created and funded when the bounty was created
        // We just need to give the PR author access to claim it
        // 
        // SECURITY NOTE: We trust the repo owner/maintainer to verify that the PR actually fixes the issue.
        // When a repo owner merges a PR linked to a bounty, they are attesting that the PR resolves the issue.
        // This is a reasonable trust model - the repo owner has the most context about whether a fix is valid.
        // If you don't trust a repo owner, don't create bounties on their repos.
        if (linkedIssue.bountyAmount && (linkedIssue.bountyWithdrawId || linkedIssue.bountyWithdrawUrl)) {
          try {
            // CRITICAL: Ensure we use full pubkey (64 chars), not prefix
            const recipientPubkey = pr.author && pr.author.length === 64 ? pr.author : null;
            if (!recipientPubkey) {
              console.error("Bounty release failed: PR author is not a valid full pubkey:", pr.author);
              alert(`Bounty release failed: Invalid recipient pubkey. Expected 64-char pubkey, got: ${pr.author?.length || 0} chars`);
              return;
            }
            
            // Store the withdraw link for the PR author (they earned the bounty)
            // This allows them to claim it via the shareable URL
            if (typeof window !== "undefined") {
              const earnedBountiesKey = "gittr_earned_bounties";
              const earnedBounties = JSON.parse(localStorage.getItem(earnedBountiesKey) || "[]");
              
              const bountyEntry = {
                withdrawUrl: linkedIssue.bountyWithdrawUrl,
                withdrawId: linkedIssue.bountyWithdrawId,
                amount: linkedIssue.bountyAmount,
                issueId: String(linkedIssue.id || linkedIssue.number),
                issueTitle: linkedIssue.title,
                repoId: `${params.entity}/${params.repo}`,
                repoName: params.repo,
                from: linkedIssue.bountyCreator || currentUserPubkey, // Bounty creator
                earnedAt: Date.now(),
                status: "released" as const, // Withdraw link released to PR author
              };
              
              // Check if already exists (don't duplicate) - compare both withdrawId and issueId
              const exists = earnedBounties.some((b: any) => 
                (b.withdrawId === linkedIssue.bountyWithdrawId && String(b.issueId) === String(bountyEntry.issueId)) ||
                (b.issueId === bountyEntry.issueId && b.repoId === bountyEntry.repoId)
              );
              
              if (!exists) {
                earnedBounties.push(bountyEntry);
                localStorage.setItem(earnedBountiesKey, JSON.stringify(earnedBounties));
                console.log("✅ Bounty withdraw link released successfully:", bountyEntry);
              } else {
                console.log("⚠️ Bounty already exists, skipping duplicate");
              }
            }
            
            // Update issue bounty status to "released"
            const issueKey = getRepoStorageKey("gittr_issues", params.entity, params.repo);
            const issues = JSON.parse(localStorage.getItem(issueKey) || "[]");
            const updatedIssues = issues.map((i: any) => 
              (i.id === linkedIssue.id || i.number === linkedIssue.number)
                ? { ...i, bountyStatus: "released" as const }
                : i
            );
            localStorage.setItem(issueKey, JSON.stringify(updatedIssues));
            
            console.log("Bounty withdraw link released - PR author can claim via:", linkedIssue.bountyWithdrawUrl);

            // Send notification to PR author about bounty being released
            try {
              if (recipientPubkey) {
                const notification = formatNotificationMessage("bounty_released", {
                  repoEntity: params.entity,
                  repoName: params.repo,
                  issueId: String(linkedIssue.id || linkedIssue.number),
                  issueTitle: linkedIssue.title,
                  url: typeof window !== "undefined" ? `${window.location.origin}/${params.entity}/${params.repo}/issues/${linkedIssue.id || linkedIssue.number}` : undefined,
                });

                await sendNotification({
                  eventType: "bounty_released",
                  title: notification.title,
                  message: `${notification.message}\n\nAmount: ${linkedIssue.bountyAmount} sats\n\nYou can claim the bounty using the withdraw link.`,
                  url: notification.url,
                  repoEntity: params.entity,
                  repoName: params.repo,
                  recipientPubkey: recipientPubkey,
                });
              }
            } catch (error) {
              console.error("Failed to send bounty_released notification:", error);
              // Don't block merge if notification fails
            }

            // Publish bounty status update to Nostr (released)
            try {
              const hasNip07 = typeof window !== "undefined" && window.nostr;
              const privateKey = await getNostrPrivateKey();
              
              if (!currentUserPubkey) {
                console.warn("Cannot publish bounty update: no user pubkey");
              } else {
                let bountyEvent: any;
                
                if (hasNip07 && window.nostr) {
                  const authorPubkey = await window.nostr.getPublicKey();
                  
                  bountyEvent = {
                    kind: KIND_BOUNTY,
                    created_at: Math.floor(Date.now() / 1000),
                    tags: [
                      ["e", linkedIssue.id, "", "issue"],
                      ["repo", params.entity, params.repo],
                      ["status", "released"],
                      ["p", linkedIssue.bountyCreator || authorPubkey, "creator"],
                      ["p", recipientPubkey, "claimed_by"],
                    ],
                    content: JSON.stringify({
                      amount: linkedIssue.bountyAmount,
                      status: "released",
                      withdrawId: linkedIssue.bountyWithdrawId,
                      lnurl: linkedIssue.bountyLnurl,
                      withdrawUrl: linkedIssue.bountyWithdrawUrl,
                      releasedAt: Date.now(),
                    }),
                    pubkey: authorPubkey,
                    id: "",
                    sig: "",
                  };
                  
                  bountyEvent.id = getEventHash(bountyEvent);
                  bountyEvent = await window.nostr.signEvent(bountyEvent);
                } else if (privateKey) {
                  bountyEvent = createBountyEvent({
                    issueId: linkedIssue.id,
                    repoEntity: params.entity,
                    repoName: params.repo,
                    amount: linkedIssue.bountyAmount || 0,
                    status: "released",
                    withdrawId: linkedIssue.bountyWithdrawId,
                    lnurl: linkedIssue.bountyLnurl,
                    withdrawUrl: linkedIssue.bountyWithdrawUrl,
                    creator: linkedIssue.bountyCreator || currentUserPubkey,
                    createdAt: Date.now(),
                    releasedAt: Date.now(),
                    claimedBy: recipientPubkey,
                  }, privateKey);
                }

                if (publish && defaultRelays && defaultRelays.length > 0 && bountyEvent) {
                  try {
                    publish(bountyEvent, defaultRelays);
                    console.log("Published bounty release event to Nostr:", bountyEvent.id);
                  } catch (error) {
                    console.error("Failed to publish bounty release to Nostr:", error);
                  }
                }
              }
            } catch (error) {
              console.error("Failed to publish bounty release event:", error);
              // Don't block merge if publishing fails
            }
          } catch (error: any) {
            console.error("Failed to release bounty:", error);
            alert(`Failed to release bounty: ${error.message || "Unknown error"}`);
          }
        }
      }

      setMerging(false);
      setShowMergeModal(false);
      alert("Pull request merged successfully!");
      
      // Record PR merge activity (PR author gets credit)
      if (pr.author) {
        try {
          recordActivity({
            type: "pr_merged",
            user: pr.author, // PR author gets credit for merge
            repo: `${params.entity}/${params.repo}`,
            entity: params.entity,
            repoName: repo?.name || params.repo,
            metadata: {
              prId: pr.id,
              commitId: commitId,
              mergedBy: currentUserPubkey || "",
            },
          });
          
          // Send notification to PR author about merge
          try {
            const notification = formatNotificationMessage("pr_merged", {
              repoEntity: params.entity,
              repoName: params.repo,
              prId: pr.id,
              prTitle: pr.title,
              url: typeof window !== "undefined" ? `${window.location.origin}/${params.entity}/${params.repo}/pulls/${pr.id}` : undefined,
            });

            await sendNotification({
              eventType: "pr_merged",
              title: notification.title,
              message: notification.message,
              url: notification.url,
              repoEntity: params.entity,
              repoName: params.repo,
              recipientPubkey: pr.author,
            });
          } catch (error) {
            console.error("Failed to send pr_merged notification:", error);
            // Don't block merge if notification fails
          }
        } catch (error) {
          console.error("Failed to record PR merge activity:", error);
        }
      }
      
      // Record bounty claimed activity if bounty was released
      if (linkedIssue?.bountyStatus === "released" && pr.author) {
        try {
          recordActivity({
            type: "bounty_claimed",
            user: pr.author,
            repo: `${params.entity}/${params.repo}`,
            entity: params.entity,
            repoName: repo?.name || params.repo,
            metadata: {
              issueId: linkedIssue.id,
              prId: pr.id,
              bountyAmount: linkedIssue.bountyAmount,
            },
          });
        } catch (error) {
          console.error("Failed to record bounty claimed activity:", error);
        }
      }
      
      // Dispatch event to update counts
      window.dispatchEvent(new CustomEvent("gittr:pr-updated"));
      window.dispatchEvent(new CustomEvent("gittr:activity-recorded", { detail: { type: "pr_merged" } }));
      
      router.refresh();
    } catch (error) {
      setMerging(false);
      console.error("Failed to merge PR:", error);
      alert("Failed to merge PR: " + (error as Error).message);
    }
  }, [pr, isOwner, merging, mergeMessage, params, currentUserPubkey, linkedIssue, recipientMetadata, router, requiredApprovals]);

  // Check wallet balance for bounty payout
  const checkWalletBalance = useCallback(async () => {
    if (!linkedIssue?.bountyAmount) return;
    
    setCheckingBalance(true);
    try {
      // Get LNbits config from secure storage
      let lnbitsUrl: string | null = null;
      let lnbitsAdminKey: string | null = null;
      
      try {
        lnbitsUrl = await getSecureItem("gittr_lnbits_url");
        lnbitsAdminKey = await getSecureItem("gittr_lnbits_admin_key");
      } catch {
        // Fallback to plaintext
        lnbitsUrl = localStorage.getItem("gittr_lnbits_url");
        lnbitsAdminKey = localStorage.getItem("gittr_lnbits_admin_key");
      }
      
      if (!lnbitsUrl || !lnbitsAdminKey) {
        setWalletBalance(null);
        setCheckingBalance(false);
        return;
      }
      
      // Check balance via API
      const response = await fetch("/api/balance/lnbits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lnbitsUrl, lnbitsAdminKey }),
      });
      
      if (response.ok) {
        const data = await response.json();
        setWalletBalance(data.balanceSats || 0);
      } else {
        setWalletBalance(null);
      }
    } catch (error) {
      console.error("Failed to check wallet balance:", error);
      setWalletBalance(null);
    } finally {
      setCheckingBalance(false);
    }
  }, [linkedIssue]);

  // Conflict resolution handler
  const handleConflictResolve = useCallback(async (
    resolvedConflicts: any[],
    resolutions: Record<string, "pr" | "base" | string>
  ) => {
    setShowConflictModal(false);
    
    try {
      const repos = loadStoredRepos();
      const repo = findRepoByEntityAndName<StoredRepo>(repos, params.entity, params.repo);
      const overrides = loadRepoOverrides(params.entity, params.repo);
      
      const changedFiles: ChangedFile[] = pr?.changedFiles || [];
      
      // Apply resolved conflicts to PR's changedFiles
      const updatedChangedFiles = changedFiles.map(file => {
        const conflict = resolvedConflicts.find(c => c.path === file.path);
        if (!conflict) return file;
        
        const resolution = resolutions[conflict.path];
        if (typeof resolution === "string" && resolution !== "pr" && resolution !== "base") {
          return { ...file, after: resolution };
        } else if (resolution === "pr") {
          return file; // Keep PR version
        } else if (resolution === "base") {
          return { ...file, after: conflict.baseContent }; // Use base version
        }
        return file;
      });
      
      // Update PR with resolved conflicts
      if (pr) {
        const prsKey = getRepoStorageKey("gittr_prs", params.entity, params.repo);
        const prs = JSON.parse(localStorage.getItem(prsKey) || "[]");
        const updatedPRs = prs.map((p: any) => 
          p.id === pr.id ? { ...p, changedFiles: updatedChangedFiles } : p
        );
        localStorage.setItem(prsKey, JSON.stringify(updatedPRs));
        
        // Update PR state with resolved conflicts
        const updatedPR = { ...pr, changedFiles: updatedChangedFiles };
        setPR(updatedPR);
        
        // Also update overrides to reflect resolved conflicts
        const overridesKey = `gittr_overrides__${normalizeEntityForStorage(params.entity)}__${params.repo}`;
        const currentOverrides = JSON.parse(localStorage.getItem(overridesKey) || "{}");
        updatedChangedFiles.forEach((file: ChangedFile) => {
          if (file.status === "modified" || file.status === "added") {
            currentOverrides[file.path] = file.after || "";
          } else if (file.status === "deleted") {
            delete currentOverrides[file.path];
          }
        });
        localStorage.setItem(overridesKey, JSON.stringify(currentOverrides));
      }
      
      // Retry merge with resolved conflicts (wait for state update)
      setMerging(false);
      // Use a longer timeout to ensure state is updated
      setTimeout(() => {
        setMerging(true);
        handleMerge();
      }, 200);
    } catch (error) {
      console.error("Failed to resolve conflicts:", error);
      setMerging(false);
      alert("Failed to resolve conflicts: " + (error as Error).message);
    }
  }, [pr, params, handleMerge]);

  if (loading) {
    return <div className="p-6">Loading PR...</div>;
  }

  if (!pr) {
    return <div className="p-6">Pull request not found</div>;
  }

  return (
    <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            {pr.status === "open" ? (
              <GitPullRequest className="h-6 w-6 text-green-500" />
            ) : pr.status === "merged" ? (
              <GitMerge className="h-6 w-6 text-purple-500" />
            ) : (
              <X className="h-6 w-6 text-gray-600" />
            )}
            <h1 className="text-2xl font-bold">{pr.title}</h1>
            <Badge className="bg-gray-700">#{params.id}</Badge>
            {pr.status === "merged" && <Badge className="bg-purple-600">Merged</Badge>}
          </div>
          <div className="text-sm text-gray-400">
            {pr.status === "merged" && pr.mergedAt
              ? `Merged ${formatDateTime24h(pr.mergedAt)}`
              : `${pr.status === "open" ? "Opened" : "Closed"} ${formatDateTime24h(pr.createdAt)}`}{" "}
            by{" "}
            <Link 
              href={`/${pr.status === "merged" && pr.mergedBy ? pr.mergedBy : pr.author}`} 
              className="hover:text-purple-400 flex items-center gap-1 group"
              title={(() => {
                const pubkey = pr.status === "merged" && pr.mergedBy ? pr.mergedBy : pr.author;
                if (pubkey && pubkey.length === 64) {
                  try {
                    const npub = nip19.npubEncode(pubkey);
                    return `npub: ${npub}`;
                  } catch {
                    return `pubkey: ${pubkey}`;
                  }
                }
                return `pubkey: ${pubkey}`;
              })()}
            >
              {(() => {
                const pubkey = pr.status === "merged" && pr.mergedBy ? pr.mergedBy : pr.author;
                const meta = recipientMetadata[pubkey];
                return meta?.display_name || meta?.name || pubkey.slice(0, 8) + "...";
              })()}
            </Link>
          </div>
        </div>
        {canMerge && pr.status === "open" && (
          <Button
            variant="default"
            onClick={async () => {
              setShowMergeModal(true);
              // Check wallet balance if there's a bounty
              if (linkedIssue?.bountyAmount && (linkedIssue?.bountyWithdrawId || linkedIssue?.bountyWithdrawUrl)) {
                await checkWalletBalance();
              }
            }}
            className="ml-4 bg-green-600 hover:bg-green-700"
          >
            <GitMerge className="mr-2 h-4 w-4" />
            Merge pull request
          </Button>
        )}
      </div>

      {/* Conflict Resolution Modal */}
      {showConflictModal && conflicts.length > 0 && (
        <ConflictDetector
          conflicts={conflicts}
          onResolve={handleConflictResolve}
          onCancel={() => {
            setShowConflictModal(false);
            setConflicts([]);
            setMerging(false);
          }}
        />
      )}

      {/* Merge Modal */}
      {showMergeModal && !showConflictModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Merge pull request</h2>
            <div className="space-y-4">
              {/* Bounty Warning - Prominent */}
              {linkedIssue?.bountyAmount && (linkedIssue?.bountyWithdrawId || linkedIssue?.bountyWithdrawUrl) && (() => {
                const authorMeta = pr.author ? recipientMetadata[pr.author] : null;
                const authorName = authorMeta?.display_name || authorMeta?.name || (pr.author && pr.author.length === 64 ? pr.author.slice(0, 8) + "..." : pr.author || "unknown");
                const authorLightningAddress = authorMeta?.lud16 || authorMeta?.lnurl || null;
                
                // Get bounty creator metadata
                const bountyCreatorMeta = linkedIssue?.bountyCreator ? recipientMetadata[linkedIssue.bountyCreator] : null;
                const bountyCreatorName = bountyCreatorMeta?.display_name || bountyCreatorMeta?.name || (linkedIssue?.bountyCreator && linkedIssue.bountyCreator.length === 64 ? linkedIssue.bountyCreator.slice(0, 8) + "..." : linkedIssue?.bountyCreator || "unknown");
                
                return (
                <div className="p-4 bg-yellow-900/30 border-2 border-yellow-600 rounded-lg">
                  <div className="flex items-start gap-2">
                      <div className="text-yellow-400 text-xl">💰</div>
                    <div className="flex-1">
                        <p className="font-semibold text-yellow-200 mb-2">Bounty Payment on Merge</p>
                        <div className="space-y-2 text-sm">
                          <div className="bg-yellow-900/20 border border-yellow-600/50 rounded p-2">
                            <p className="text-yellow-200 font-medium mb-1">Amount:</p>
                            <p className="text-yellow-100 text-lg font-bold">{linkedIssue.bountyAmount} sats</p>
                          </div>
                          <div className="bg-yellow-900/20 border border-yellow-600/50 rounded p-2">
                            <p className="text-yellow-200 font-medium mb-1">Paying to:</p>
                            <p className="text-yellow-100">{authorName}</p>
                            {authorLightningAddress ? (
                              <p className="text-yellow-300 text-xs mt-1 font-mono break-all">
                                {authorLightningAddress}
                              </p>
                            ) : (
                              <p className="text-yellow-400 text-xs mt-1 italic">
                                ⚠️ Lightning address not found in PR author's Nostr profile
                              </p>
                            )}
                    </div>
                          {linkedIssue?.bountyCreator && (
                            <div className="bg-yellow-900/20 border border-yellow-600/50 rounded p-2">
                              <p className="text-yellow-200 font-medium mb-1">Bounty created by:</p>
                              <p className="text-yellow-100">{bountyCreatorName}</p>
                </div>
              )}
                          <p className="text-yellow-300 text-xs mt-2">
                            When you merge this PR, the withdraw link will be released to the PR author. They can claim the bounty using the withdraw link. The funds are already reserved in the bounty creator's LNbits wallet and will be deducted when the PR author claims the withdraw link.
                          </p>
                          <p className="text-yellow-300 text-xs mt-1">
                            <Link href="/help#bounties" className="text-yellow-400 hover:text-yellow-300 underline" target="_blank">
                              Learn more about bounties →
                            </Link>
                          </p>
                          <p className="text-yellow-400 text-xs mt-2">
                            ⚠️ Make sure this PR actually fixes issue #{linkedIssue.number || linkedIssue.id} before merging.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
              
              <div>
                <label className="block text-sm font-medium mb-2">Merge commit message</label>
                <textarea
                  className="w-full border border-gray-600 bg-gray-800 text-white rounded p-2 h-24"
                  value={mergeMessage}
                  onChange={(e) => setMergeMessage(e.target.value)}
                  placeholder={`Merge pull request #${params.id} from ${(() => {
                    const authorMeta = pr?.author ? recipientMetadata[pr.author] : null;
                    return authorMeta?.display_name || authorMeta?.name || (pr?.author && pr.author.length === 64 ? pr.author.slice(0, 8) + "..." : pr?.author || "unknown");
                  })()}\n\n${pr?.title || ""}`}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowMergeModal(false)}
                  disabled={merging}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleMerge}
                  disabled={merging}
                  variant="default"
                  className={`flex-1 ${linkedIssue?.bountyAmount && (linkedIssue?.bountyWithdrawId || linkedIssue?.bountyWithdrawUrl) ? "bg-yellow-600 hover:bg-yellow-700 text-white border-yellow-500" : "bg-green-600 hover:bg-green-700 text-white border-green-500"}`}
                >
                  {merging ? "Merging..." : linkedIssue?.bountyAmount && (linkedIssue?.bountyWithdrawId || linkedIssue?.bountyWithdrawUrl) ? "Merge & Release Bounty Link" : "Confirm merge"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="md:col-span-2 space-y-4">
          {/* Description */}
          <div className="border border-gray-700 rounded p-4">
            <div className="prose prose-invert max-w-none mb-4">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw]}
                components={{
                  a: ({ node, ...props }: any) => {
                    // Resolve relative links relative to repo root, not current page
                    let href = props.href || '';
                    const isExternal = href.startsWith('http://') || href.startsWith('https://');
                    if (href && !isExternal && !href.startsWith('mailto:') && !href.startsWith('#')) {
                      // Relative link - resolve relative to repo root using query params format
                      const repoBasePath = getRepoLink('');
                      // Remove leading ./ or . if present
                      let cleanHref = href.replace(/^\.\//, '').replace(/^\.$/, '');
                      // Remove leading / if present (root-relative)
                      if (cleanHref.startsWith('/')) {
                        cleanHref = cleanHref.substring(1);
                      }
                      // Extract directory path and filename
                      const pathParts = cleanHref.split('/');
                      const fileName = pathParts[pathParts.length - 1];
                      const dirPath = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') : '';
                      // Construct URL with query parameters: ?path=dir&file=dir%2Ffile.md
                      const encodedFile = encodeURIComponent(cleanHref);
                      const encodedPath = dirPath ? encodeURIComponent(dirPath) : '';
                      if (encodedPath) {
                        href = `${repoBasePath}?path=${encodedPath}&file=${encodedFile}`;
                      } else {
                        href = `${repoBasePath}?file=${encodedFile}`;
                      }
                    }
                    return <a {...props} href={href} target={isExternal ? '_blank' : undefined} rel={isExternal ? 'noopener noreferrer' : undefined} className="text-purple-400 hover:text-purple-300" />;
                  },
                }}
              >
                {pr.body || "No description provided"}
              </ReactMarkdown>
            </div>
            <div className="mt-4 pt-4 border-t border-gray-700">
              <Reactions
                targetId={pr.id}
                targetType="pr"
                entity={params.entity}
                repo={params.repo}
              />
            </div>
          </div>

          {/* File Changes */}
          {hasChanges && changedFiles.length > 0 && (
            <div className="space-y-4">
              <div className="border border-gray-700 rounded p-4">
                <h3 className="font-semibold mb-3">
                  Changes ({changedFiles.length} file{changedFiles.length !== 1 ? "s" : ""})
                </h3>
                {changedFiles.map((file, idx) => {
                  const handleOwnerEdit = (newContent: string) => {
                    const key = getRepoStorageKey("gittr_prs", params.entity, params.repo);
                    const prs = JSON.parse(localStorage.getItem(key) || "[]");
                    const updatedPRs = prs.map((p: any) => {
                      if (p.id === pr.id) {
                        const updatedChangedFiles = (p.changedFiles || []).map((f: any) => {
                          if (f.path === file.path) {
                            return { ...f, after: newContent, ownerEdited: true };
                          }
                          return f;
                        });
                        return { ...p, changedFiles: updatedChangedFiles };
                      }
                      return p;
                    });
                    localStorage.setItem(key, JSON.stringify(updatedPRs));
                    
                    setPR((prev) => {
                      if (!prev) return prev;
                      const updated = prev.changedFiles?.map((f) => {
                        if (f.path === file.path) {
                          return { ...f, after: newContent };
                        }
                        return f;
                      });
                      return { ...prev, changedFiles: updated };
                    });
                  };
                  
                  return (
                    <div key={idx} className="mb-4 last:mb-0">
                      <FileDiffViewer
                        path={file.path}
                        status={file.status}
                        before={file.before}
                        after={file.after}
                        isBinary={file.isBinary}
                        mimeType={file.mimeType}
                        ownerEdit={isOwner && pr.status === "open"}
                        onEdit={handleOwnerEdit}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Review Section */}
          {pr.status === "open" && (
            <PRReviewSection
              prId={pr.id}
              entity={params.entity}
              repo={params.repo}
              requiredApprovals={requiredApprovals}
              prAuthor={pr.author}
              isOwner={isOwner}
            />
          )}

          {/* Contributors */}
          {pr.contributors && pr.contributors.length > 0 && (
            <div className="border border-gray-700 rounded p-4">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Users className="h-4 w-4" />
                Contributors
              </h3>
              <div className="space-y-2">
                {pr.contributors.map((pubkey, idx) => {
                  const meta = recipientMetadata[pubkey];
                  const displayName = meta?.display_name || meta?.name || pubkey.slice(0, 8) + "...";
                  const npub = pubkey && pubkey.length === 64 ? (() => {
                    try {
                      return nip19.npubEncode(pubkey);
                    } catch {
                      return null;
                    }
                  })() : null;
                  // Build tooltip with name, npub, and full pubkey for verification
                  const tooltipParts = [displayName];
                  if (npub) {
                    tooltipParts.push(`npub: ${npub}`);
                  }
                  if (pubkey && pubkey.length === 64) {
                    tooltipParts.push(`pubkey: ${pubkey}`);
                  }
                  const tooltip = tooltipParts.join('\n');
                  
                  return (
                    <Link 
                      key={idx} 
                      href={`/${pubkey}`} 
                      className="flex items-center gap-2 hover:text-purple-400 group"
                      title={tooltip}
                    >
                      <Avatar className="h-6 w-6 ring-1 ring-gray-500">
                        {meta?.picture && meta.picture.startsWith("http") ? (
                          <AvatarImage src={meta.picture} />
                        ) : null}
                        <AvatarFallback className="bg-gray-700 text-white text-xs">
                          {displayName.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                    </Avatar>
                      <span className="text-sm">{displayName}</span>
                      {npub && (
                        <span className="text-xs text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity font-mono">
                          ({npub.slice(0, 16)}...)
                        </span>
                      )}
                  </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* Zap PR Author */}
          {pr.status === "open" && pr.author && (() => {
            // Validate PR author is a valid Nostr pubkey (64-char hex or npub)
            // For imported PRs from GitHub (like Dependabot), author might be a GitHub username, not a Nostr pubkey
            let isValidAuthor = false;
            let authorPubkey: string | null = null;
            
            try {
              // Check if it's a 64-char hex pubkey
              if (/^[0-9a-f]{64}$/i.test(pr.author)) {
                isValidAuthor = true;
                authorPubkey = pr.author;
              } else if (pr.author.startsWith("npub")) {
                // Try to decode npub
                try {
                  const decoded = nip19.decode(pr.author);
                  if (decoded.type === "npub" && typeof decoded.data === "string") {
                    isValidAuthor = true;
                    authorPubkey = decoded.data;
                  }
                } catch {
                  // Invalid npub
                }
              }
            } catch {
              // Not a valid pubkey
            }
            
            // Only show zap button if author is a valid Nostr pubkey
            if (!isValidAuthor || !authorPubkey) {
              return null;
            }
            
            return (
            <div className="border border-gray-700 rounded p-4">
                <h3 className="text-sm font-semibold mb-2">Zap PR author</h3>
          <ZapButton
                  recipient={authorPubkey}
            amount={10}
            comment={`Zap for PR: ${pr.title}`}
          />
                <p className="text-xs text-gray-400 mt-2">
                  This zap goes to the PR author. If this PR is merged and linked to an issue with a bounty, the bounty will be released to the PR author.
                </p>
                {/* Show bounty info if PR is linked to an issue with a bounty withdraw link created */}
                {linkedIssue?.bountyAmount && (linkedIssue?.bountyWithdrawId || linkedIssue?.bountyWithdrawUrl) && (
                  <div className="mt-3 p-3 bg-yellow-900/20 border border-yellow-600/50 rounded">
                    <p className="text-xs font-semibold text-yellow-300 mb-1">💰 Bounty on linked issue</p>
                    <p className="text-xs text-yellow-200">
                      Issue #{linkedIssue.number || linkedIssue.id} has a <strong>{linkedIssue.bountyAmount} sats</strong> bounty withdraw link created.
                    </p>
                    <p className="text-xs text-yellow-300/80 mt-1">
                      Merging this PR will automatically release the withdraw link to the PR author. Funds will be deducted when they claim it.
                    </p>
            </div>
          )}
              </div>
            );
          })()}
          
          {/* Bounty Info (if PR is linked to an issue with a bounty but author is not a valid Nostr pubkey) */}
          {pr.status === "open" && linkedIssue?.bountyAmount && (linkedIssue?.bountyWithdrawId || linkedIssue?.bountyWithdrawUrl) && (() => {
            // Check if PR author is a valid Nostr pubkey
            let isValidAuthor = false;
            try {
              if (/^[0-9a-f]{64}$/i.test(pr.author || "")) {
                isValidAuthor = true;
              } else if (pr.author?.startsWith("npub")) {
                try {
                  const decoded = nip19.decode(pr.author);
                  if (decoded.type === "npub" && typeof decoded.data === "string") {
                    isValidAuthor = true;
                  }
                } catch {}
              }
            } catch {}
            
            // Only show this if author is NOT a valid Nostr pubkey (so bounty can't be released)
            if (isValidAuthor) {
              return null; // Bounty info is already shown in the zap section above
            }
            
            return (
              <div className="border border-gray-700 rounded p-4">
                <div className="p-3 bg-yellow-900/20 border border-yellow-600/50 rounded">
                  <p className="text-xs font-semibold text-yellow-300 mb-1">⚠️ Bounty withdraw link cannot be released</p>
                  <p className="text-xs text-yellow-200">
                    Issue #{linkedIssue.number || linkedIssue.id} has a <strong>{linkedIssue.bountyAmount} sats</strong> bounty withdraw link, but the PR author ({pr.author || "unknown"}) is not a valid Nostr user.
                  </p>
                  <p className="text-xs text-yellow-300/80 mt-1">
                    The PR author needs to claim their GitHub profile and link it to a Nostr account to receive the withdraw link.
                  </p>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
