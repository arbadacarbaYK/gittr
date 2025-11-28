"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NostrUserSearch } from "@/components/ui/nostr-user-search";
import { BountyButton } from "@/components/ui/bounty-button";
import { getRepoStorageKey } from "@/lib/utils/entity-normalizer";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";
import useSession from "@/lib/nostr/useSession";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import {
  CheckCircle2,
  CircleDot,
  Settings,
  User,
  X,
  Plus,
  Coins,
  GitBranch,
} from "lucide-react";
import { nip19 } from "nostr-tools";
import { Reactions } from "@/components/ui/reactions";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import { formatDateTime24h, formatDate24h, formatTime24h } from "@/lib/utils/date-format";
import { sendNotification, formatNotificationMessage } from "@/lib/notifications";
import { getRepoOwnerPubkey, resolveEntityToPubkey, getEntityDisplayName } from "@/lib/utils/entity-resolver";
import { createBountyEvent, KIND_BOUNTY, createCommentEvent, KIND_COMMENT, createIssueEvent, KIND_ISSUE } from "@/lib/nostr/events";
import { getNostrPrivateKey } from "@/lib/security/encryptedStorage";
import { getEventHash, getPublicKey, signEvent } from "nostr-tools";
import { Textarea } from "@/components/ui/textarea";
import { Reply } from "lucide-react";
import { extractMentionedPubkeys } from "@/lib/utils/mention-detection";
import { loadStoredRepos, type StoredRepo, type StoredContributor } from "@/lib/repos/storage";

interface Issue {
  id: string;
  title: string;
  description: string;
  author: string;
  createdAt: number;
  status: "open" | "closed";
  labels: string[];
  assignees: string[];
  linkedPR?: string; // PR id if linked
  bountyAmount?: number;
  bountyWithdrawId?: string; // Withdraw link ID (needed to claim the link)
  bountyLnurl?: string; // LNURL-withdraw link (replaces bountyInvoice/bountyPaymentHash)
  bountyWithdrawUrl?: string; // Shareable URL for claiming the bounty (e.g., https://bitcoindelta.club/withdraw/{id})
  bountyStatus?: "pending" | "paid" | "released";
  bountyCreator?: string; // Pubkey of the user who created the bounty
  bountyInvoice?: string; // Legacy invoice field (for backwards compatibility with old Nostr events)
}

interface Comment {
  id: string;
  author: string;
  content: string;
  createdAt: number;
  parentId?: string; // For threading (NIP-10)
  edited?: boolean;
  editedAt?: number;
  nostrEventId?: string; // Nostr event ID if published
}

export default function IssueDetailPage({ params }: { params: { entity: string; repo: string; id: string } }) {
  const router = useRouter();
  const { pubkey: currentUserPubkey, publish, defaultRelays } = useNostrContext();
  const { picture: userPicture, name: userName } = useSession();
  const [issue, setIssue] = useState<Issue | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [assigneeInput, setAssigneeInput] = useState("");
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [labelSearch, setLabelSearch] = useState("");
  const [availableLabels, setAvailableLabels] = useState<string[]>([]);
  const [bountyAmount, setBountyAmount] = useState(0);
  const [isOwner, setIsOwner] = useState(false);
  const [repoContributors, setRepoContributors] = useState<Array<{pubkey: string; name?: string; picture?: string; weight?: number; role?: string}>>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentContent, setCommentContent] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyParentId, setReplyParentId] = useState<string | null>(null);
  const [issueEventId, setIssueEventId] = useState<string | null>(null);
  const commentTextareaRef = useRef<HTMLTextAreaElement>(null);

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

  // Fetch metadata for issue author (only full 64-char pubkeys for metadata lookup)
  const authorPubkeys = useMemo(() => {
    if (!issue?.author) return [];
    // Only include if it's a full 64-char pubkey
    return /^[a-f0-9]{64}$/i.test(issue.author) ? [issue.author] : [];
  }, [issue?.author]);
  const authorMetadata = useContributorMetadata(authorPubkeys);

  // Fetch metadata for assignees (only full 64-char pubkeys for metadata lookup)
  const assigneePubkeys = useMemo(() => {
    if (!issue?.assignees || issue.assignees.length === 0) return [];
    return issue.assignees.filter(assignee => /^[a-f0-9]{64}$/i.test(assignee));
  }, [issue?.assignees]);
  const assigneeMetadata = useContributorMetadata(assigneePubkeys);

  // Get repo owner metadata for bounty title and display purposes (not breadcrumbs)
  const [repoOwnerPubkey, setRepoOwnerPubkey] = useState<string | null>(null);
  const repoOwnerPubkeys = useMemo(() => {
    return repoOwnerPubkey && /^[a-f0-9]{64}$/i.test(repoOwnerPubkey) ? [repoOwnerPubkey] : [];
  }, [repoOwnerPubkey]);
  const repoOwnerMetadata = useContributorMetadata(repoOwnerPubkeys);

  // Get pubkeys from repo contributors for metadata lookup
  const repoContributorPubkeys = useMemo(() => {
    return repoContributors
      .map(c => c.pubkey)
      .filter(pubkey => pubkey && /^[a-f0-9]{64}$/i.test(pubkey));
  }, [repoContributors]);
  const repoContributorMetadata = useContributorMetadata(repoContributorPubkeys);

  // Load issue data
  useEffect(() => {
    try {
      const key = getRepoStorageKey("gittr_issues", params.entity, params.repo);
      const issuesRaw = localStorage.getItem(key);
      const issues: Issue[] = issuesRaw ? (JSON.parse(issuesRaw) as Issue[]) : [];
      // Match by: full ID, number, or index
      const issueData = issues.find((i) => 
        i.id === params.id || 
        i.number === params.id || 
        String(issues.indexOf(i) + 1) === params.id
      );
      
      if (issueData) {
        setIssue({
          id: issueData.id || params.id,
          title: issueData.title || "",
          description: issueData.description || "",
          author: issueData.author || "unknown",
          createdAt: issueData.createdAt || Date.now(),
          status: issueData.status || "open",
          labels: issueData.labels || [],
          assignees: issueData.assignees || [],
          linkedPR: issueData.linkedPR,
          bountyAmount: issueData.bountyAmount,
          bountyWithdrawId: issueData.bountyWithdrawId,
          bountyLnurl: issueData.bountyLnurl,
          bountyWithdrawUrl: issueData.bountyWithdrawUrl,
          bountyStatus: issueData.bountyStatus,
        });
        
        // Check if current user is owner and get repo owner pubkey for display
        const repos = loadStoredRepos();
        const repo = findRepoByEntityAndName<StoredRepo>(repos, params.entity, params.repo);
        setIsOwner(repo?.entity === currentUserPubkey || repo?.ownerPubkey === currentUserPubkey);
        
        // Get owner pubkey for display name
        if (repo?.ownerPubkey && /^[a-f0-9]{64}$/i.test(repo.ownerPubkey)) {
          setRepoOwnerPubkey(repo.ownerPubkey);
        } else if (repo?.contributors && repo.contributors.length > 0) {
          const owner = repo.contributors.find((c): c is StoredContributor => (c.weight === 100 || !c.weight)) || repo.contributors[0];
          if (owner?.pubkey && /^[a-f0-9]{64}$/i.test(owner.pubkey)) {
            setRepoOwnerPubkey(owner.pubkey);
          }
        }

        // Load repo contributors for assignee dropdown
        if (repo && repo.contributors && Array.isArray(repo.contributors)) {
          // Filter to only contributors with valid 64-char pubkeys
          const validContributors = repo.contributors
            .filter((c): c is StoredContributor & { pubkey: string } => c.pubkey !== undefined && typeof c.pubkey === "string" && c.pubkey.length === 64 && /^[0-9a-f]{64}$/i.test(c.pubkey))
            .map((c) => ({
              pubkey: c.pubkey.toLowerCase(),
              name: c.name,
              picture: c.picture,
              weight: c.weight || 0,
              role: c.role,
            }));
          setRepoContributors(validContributors);
        } else {
          setRepoContributors([]);
        }

        // Get issue event ID for NIP-10 threading (if available)
        if (issueData.id && /^[0-9a-f]{64}$/i.test(issueData.id)) {
          setIssueEventId(issueData.id);
        }

        // Load comments from localStorage
        const commentsKey = `gittr_issue_comments_${params.entity}_${params.repo}_${issueData.id}`;
        const storedComments = JSON.parse(localStorage.getItem(commentsKey) || "[]") as Comment[];
        setComments(storedComments);
      }
    } catch (error) {
      console.error("Failed to load issue:", error);
    } finally {
      setLoading(false);
    }
  }, [params, currentUserPubkey]);

  // Load available labels from repo topics
  useEffect(() => {
    try {
      const repos = loadStoredRepos();
      const repo = findRepoByEntityAndName<StoredRepo>(repos, params.entity, params.repo);
      if (repo?.topics) {
        const labels = repo.topics
          .map(t => typeof t === "string" ? t : (typeof t === "object" && t !== null && "name" in t && typeof (t as { name: string }).name === "string" ? (t as { name: string }).name : null))
          .filter((t): t is string => typeof t === "string" && t.length > 0);
        setAvailableLabels(labels);
      }
    } catch {}
  }, [params]);

  // Subscribe to comments from Nostr relays
  const { subscribe } = useNostrContext();
  useEffect(() => {
    if (!subscribe || !defaultRelays || !issue?.id || !issueEventId) return;

    // Subscribe to comments (kind 1) that reference this issue
    const unsub = subscribe(
      [
        {
          kinds: [KIND_COMMENT],
          "#e": [issueEventId], // Comments that reference the issue event ID
        },
      ],
      defaultRelays,
      (event, isAfterEose, relayURL) => {
        if (event.kind === KIND_COMMENT) {
          try {
            // Parse comment from event
            const eTags = event.tags.filter((t): t is string[] => Array.isArray(t) && t[0] === "e");
            const repoTag = event.tags.find((t): t is string[] => Array.isArray(t) && t[0] === "repo");
            
            // Verify this comment is for our issue and repo
            const isForThisIssue = eTags.some((t) => t[1] === issueEventId);
            const isForThisRepo = repoTag && repoTag[1] === params.entity && repoTag[2] === params.repo;
            
            if (isForThisIssue && isForThisRepo) {
              // Find parent comment ID (NIP-10 reply tag)
              const replyTag = eTags.find((t) => t[3] === "reply");
              const rootTag = eTags.find((t) => t[3] === "root");
              const parentId = replyTag?.[1] !== issueEventId ? replyTag?.[1] : undefined;
              
              const comment: Comment = {
                id: event.id,
                author: event.pubkey,
                content: event.content,
                createdAt: event.created_at * 1000, // Convert to milliseconds
                parentId: parentId,
                nostrEventId: event.id,
              };

              // Merge with existing comments (avoid duplicates)
              setComments((prev) => {
                const exists = prev.some((c) => c.id === comment.id || c.nostrEventId === comment.id);
                if (exists) return prev;
                return [...prev, comment].sort((a, b) => a.createdAt - b.createdAt);
              });

              // Also save to localStorage
              const commentsKey = `gittr_issue_comments_${params.entity}_${params.repo}_${issue.id}`;
              const storedComments = JSON.parse(localStorage.getItem(commentsKey) || "[]") as Comment[];
              const exists = storedComments.some((c) => c.id === comment.id || c.nostrEventId === comment.id);
              if (!exists) {
                storedComments.push(comment);
                localStorage.setItem(commentsKey, JSON.stringify(storedComments));
              }
            }
          } catch (error) {
            console.error("Failed to process comment event:", error);
          }
        }
      }
    );

    return () => {
      unsub();
    };
  }, [subscribe, defaultRelays, issue?.id, issueEventId, params.entity, params.repo]);

  const handleToggleStatus = useCallback(async () => {
    if (!issue || !isOwner) return;
    
    try {
      const key = getRepoStorageKey("gittr_issues", params.entity, params.repo);
      const issuesRaw = localStorage.getItem(key);
      const issues: Issue[] = issuesRaw ? (JSON.parse(issuesRaw) as Issue[]) : [];
      const newStatus = issue.status === "open" ? "closed" : "open";
      const updated = issues.map((i) => 
        i.id === issue.id ? { ...i, status: newStatus } : i
      );
      localStorage.setItem(key, JSON.stringify(updated));
      
      // If closing issue (not reopening) and there's a bounty without a linked PR, delete the bounty
      if (newStatus === "closed" && issue.bountyWithdrawId && !issue.linkedPR) {
        try {
          // Get LNbits config
          const { getSecureItem } = await import("@/lib/security/encryptedStorage");
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

          if (lnbitsUrl && lnbitsAdminKey && issue.bountyWithdrawId) {
            // Delete the withdraw link
            const deleteResponse = await fetch("/api/bounty/delete-withdraw", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                withdrawId: issue.bountyWithdrawId,
                lnbitsUrl,
                lnbitsAdminKey,
              }),
            });

            if (deleteResponse.ok) {
              console.log("Bounty withdraw link deleted successfully");
              
              // Remove bounty data from issue
              const updatedWithoutBounty = updated.map((i) => 
                i.id === issue.id 
                  ? { 
                      ...i, 
                      bountyAmount: undefined,
                      bountyWithdrawId: undefined,
                      bountyLnurl: undefined,
                      bountyWithdrawUrl: undefined,
                      bountyStatus: undefined,
                      bountyCreator: undefined,
                    } 
                  : i
              );
              localStorage.setItem(key, JSON.stringify(updatedWithoutBounty));
              
              // Publish bounty cancellation event to Nostr
              try {
                const privateKey = await getNostrPrivateKey();
                
                if (publish && defaultRelays && defaultRelays.length > 0 && privateKey) {
                  const bountyEvent = createBountyEvent({
                    issueId: issue.id,
                    repoEntity: params.entity,
                    repoName: params.repo,
                    amount: issue.bountyAmount || 0,
                    status: "pending", // Cancelled bounties are marked as pending (not released)
                    withdrawId: issue.bountyWithdrawId,
                    lnurl: issue.bountyLnurl,
                    withdrawUrl: issue.bountyWithdrawUrl,
                    creator: issue.bountyCreator || currentUserPubkey || "",
                    createdAt: issue.createdAt,
                  }, privateKey);
                  
                  publish(bountyEvent, defaultRelays);
                  console.log("Published bounty cancellation event to Nostr");
                }
              } catch (nostrError) {
                console.error("Failed to publish bounty cancellation to Nostr:", nostrError);
                // Don't block issue closure if Nostr publish fails
              }
              
              // Notify bounty creator if different from current user
              if (issue.bountyCreator && issue.bountyCreator !== currentUserPubkey) {
                try {
                  const { title, message, url } = formatNotificationMessage("bounty_cancelled", {
                    repoEntity: params.entity,
                    repoName: params.repo,
                    issueId: issue.id,
                    issueTitle: issue.title,
                    url: `/${params.entity}/${params.repo}/issues/${issue.id}`,
                  });
                  
                  await sendNotification({
                    recipientPubkey: issue.bountyCreator,
                    eventType: "bounty_cancelled",
                    title,
                    message,
                    url,
                    repoEntity: params.entity,
                    repoName: params.repo,
                  });
                } catch (notifError) {
                  console.error("Failed to send bounty cancellation notification:", notifError);
                }
              }
            } else {
              const errorData = await deleteResponse.json();
              console.error("Failed to delete bounty withdraw link:", errorData);
              // Continue with issue closure even if delete fails (user can manually delete later)
            }
          }
        } catch (bountyError) {
          console.error("Error handling bounty deletion:", bountyError);
          // Continue with issue closure even if bounty deletion fails
        }
      }
      
      setIssue({ ...issue, status: newStatus });
      
      // Publish updated issue status to Nostr (closed/reopened)
      try {
        const hasNip07 = typeof window !== "undefined" && window.nostr;
        const privateKey = await getNostrPrivateKey();
        let issueUpdateEvent: any;
        
        if (hasNip07 && window.nostr) {
          const authorPubkey = await window.nostr.getPublicKey();
          
          // Create updated issue event with new status
          issueUpdateEvent = {
            kind: KIND_ISSUE,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
              ["repo", params.entity, params.repo],
              ["status", newStatus],
              ["e", issue.id, "", "previous"], // Reference to original issue event
              ...(issue.labels || []).map((label: string) => ["t", label]),
              ...(issue.assignees || []).map((assignee: string) => ["p", assignee]),
            ],
            content: JSON.stringify({
              title: issue.title,
              description: issue.description || "",
              status: newStatus,
              bountyAmount: issue.bountyAmount,
              bountyInvoice: issue.bountyInvoice, // Preserve legacy invoice if exists
            }),
            pubkey: authorPubkey,
            id: "",
            sig: "",
          };
          
          issueUpdateEvent.id = getEventHash(issueUpdateEvent);
          issueUpdateEvent = await window.nostr.signEvent(issueUpdateEvent);
        } else if (privateKey) {
          // Use private key
          issueUpdateEvent = createIssueEvent({
            repoEntity: params.entity,
            repoName: params.repo,
            title: issue.title,
            description: issue.description || "",
            status: newStatus,
            labels: issue.labels || [],
            assignees: issue.assignees || [],
            bountyAmount: issue.bountyAmount,
            bountyInvoice: issue.bountyInvoice, // Preserve legacy invoice if exists
          }, privateKey);
          
          // Add reference to original issue
          issueUpdateEvent.tags.push(["e", issue.id, "", "previous"]);
          issueUpdateEvent.id = getEventHash(issueUpdateEvent);
          issueUpdateEvent.sig = signEvent(issueUpdateEvent, privateKey);
        }
        
        if (publish && defaultRelays && defaultRelays.length > 0 && issueUpdateEvent) {
          try {
            publish(issueUpdateEvent, defaultRelays);
            console.log(`✅ Published issue ${newStatus} status to Nostr:`, issueUpdateEvent.id);
          } catch (error) {
            console.error("Failed to publish issue status update to Nostr:", error);
            // Don't block issue status change if publishing fails
          }
        }
      } catch (error) {
        console.error("Failed to create issue status update event:", error);
        // Don't block issue status change if publishing fails
      }
      
      // Dispatch event to update counts
      window.dispatchEvent(new CustomEvent("gittr:issue-updated"));
      window.dispatchEvent(new CustomEvent("gittr:activity-recorded", { 
        detail: { 
          type: newStatus === "closed" ? "issue_closed" : "issue_reopened",
          repo: `${params.entity}/${params.repo}`,
          entity: params.entity,
          repoName: params.repo
        } 
      }));
    } catch (error) {
      console.error("Failed to update issue status:", error);
    }
  }, [issue, isOwner, params, currentUserPubkey, publish, defaultRelays]);

  const handleAddAssignee = useCallback((input: string) => {
    if (!issue || !isOwner || !input.trim()) return;
    
    try {
      let pubkey = input.trim();
      
      // If it's an npub, decode it
      if (pubkey.startsWith("npub")) {
        const decoded = nip19.decode(pubkey);
        if (decoded.type === "npub") {
          pubkey = decoded.data as string;
        }
      }
      
      // Validate pubkey (should be 64 hex chars)
      if (!/^[a-f0-9]{64}$/i.test(pubkey)) {
        alert("Invalid npub or pubkey format");
        return;
      }
      
      if (issue.assignees.includes(pubkey)) {
        return; // Already assigned
      }
      
      const key = getRepoStorageKey("gittr_issues", params.entity, params.repo);
      const issuesRaw = localStorage.getItem(key);
      const issues: Issue[] = issuesRaw ? (JSON.parse(issuesRaw) as Issue[]) : [];
      const updated = issues.map((i) => 
        i.id === issue.id ? { ...i, assignees: [...(i.assignees || []), pubkey] } : i
      );
      localStorage.setItem(key, JSON.stringify(updated));
      setIssue({ ...issue, assignees: [...issue.assignees, pubkey] });
      setAssigneeInput("");
      setAssigneeSearch("");
    } catch (error) {
      alert(`Failed to add assignee: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }, [issue, isOwner, params]);

  const handleRemoveAssignee = useCallback((pubkey: string) => {
    if (!issue || !isOwner) return;
    
    try {
      const key = getRepoStorageKey("gittr_issues", params.entity, params.repo);
      const issuesRaw = localStorage.getItem(key);
      const issues: Issue[] = issuesRaw ? (JSON.parse(issuesRaw) as Issue[]) : [];
      const updated = issues.map((i) => 
        i.id === issue.id ? { ...i, assignees: (i.assignees || []).filter((a) => a !== pubkey) } : i
      );
      localStorage.setItem(key, JSON.stringify(updated));
      setIssue({ ...issue, assignees: issue.assignees.filter(a => a !== pubkey) });
    } catch (error) {
      console.error("Failed to remove assignee:", error);
    }
  }, [issue, isOwner, params]);

  const handleToggleLabel = useCallback((label: string) => {
    if (!issue || !isOwner) return;
    
    try {
      const key = getRepoStorageKey("gittr_issues", params.entity, params.repo);
      const issuesRaw = localStorage.getItem(key);
      const issues: Issue[] = issuesRaw ? (JSON.parse(issuesRaw) as Issue[]) : [];
      const updated = issues.map((i) => {
        const labels = i.labels || [];
        const newLabels = labels.includes(label)
          ? labels.filter((l) => l !== label)
          : [...labels, label];
        return i.id === issue.id ? { ...i, labels: newLabels } : i;
      });
      localStorage.setItem(key, JSON.stringify(updated));
      setIssue({ ...issue, labels: issue.labels.includes(label) ? issue.labels.filter(l => l !== label) : [...issue.labels, label] });
    } catch (error) {
      console.error("Failed to toggle label:", error);
    }
  }, [issue, isOwner, params]);

  const handleBountyCreated = useCallback(async (withdrawId: string, lnurl: string, withdrawUrl: string, amount: number) => {
    // Store bounty info in issue
    // Note: Withdraw link is already funded when created, so status is "paid"
    if (!issue) return;
    
    try {
      const key = getRepoStorageKey("gittr_issues", params.entity, params.repo);
      const issuesRaw = localStorage.getItem(key);
      const issues: Issue[] = issuesRaw ? (JSON.parse(issuesRaw) as Issue[]) : [];
      const updated = issues.map((i) => 
        i.id === issue.id 
          ? { 
              ...i, 
              bountyWithdrawId: withdrawId,
              bountyLnurl: lnurl,
              bountyWithdrawUrl: withdrawUrl,
              bountyAmount: amount,
              bountyStatus: "paid" as const, // Already funded when created
              bountyCreator: currentUserPubkey || undefined, // Store bounty creator's pubkey
            } 
          : i
      );
      localStorage.setItem(key, JSON.stringify(updated));
      setBountyAmount(amount);
      
      // Update issue state
      setIssue({ ...issue, bountyWithdrawId: withdrawId, bountyLnurl: lnurl, bountyWithdrawUrl: withdrawUrl, bountyAmount: amount, bountyStatus: "paid", bountyCreator: currentUserPubkey || undefined });
      
      // Store in user's bounty tracking (bounties they created)
      if (typeof window !== "undefined") {
        const bounties = JSON.parse(localStorage.getItem("gittr_user_bounties") || "[]");
        const existingIndex = bounties.findIndex((b: any) => b.issueId === issue.id);
        const bountyEntry = {
          issueId: issue.id,
          issueTitle: issue.title,
          repoId: `${params.entity}/${params.repo}`,
          amount: amount,
          withdrawId: withdrawId,
          lnurl: lnurl,
          withdrawUrl: withdrawUrl,
          status: "paid",
          createdAt: Date.now(),
        };
        if (existingIndex >= 0) {
          bounties[existingIndex] = bountyEntry;
        } else {
          bounties.push(bountyEntry);
        }
        localStorage.setItem("gittr_user_bounties", JSON.stringify(bounties));
      }

      // Send notification to issue owner about bounty being funded
      try {
        // Get issue owner pubkey (issue author)
        let issueOwnerPubkey: string | null = null;
        
        if (issue.author && /^[0-9a-f]{64}$/i.test(issue.author)) {
          issueOwnerPubkey = issue.author;
        } else {
          // Try to resolve if it's an npub or entity
          try {
            issueOwnerPubkey = resolveEntityToPubkey(issue.author);
          } catch {
            console.warn("Could not resolve issue author to pubkey:", issue.author);
          }
        }
        
        if (issueOwnerPubkey) {
          const notification = formatNotificationMessage("bounty_funded", {
            repoEntity: params.entity,
            repoName: params.repo,
            issueId: issue.id,
            issueTitle: issue.title,
            url: typeof window !== "undefined" ? `${window.location.origin}/${params.entity}/${params.repo}/issues/${issue.id}` : undefined,
          });

          await sendNotification({
            eventType: "bounty_funded",
            title: notification.title,
            message: `${notification.message}\n\nAmount: ${amount} sats`,
            url: notification.url,
            repoEntity: params.entity,
            repoName: params.repo,
            recipientPubkey: issueOwnerPubkey,
          });
        }
      } catch (error) {
        console.error("Failed to send bounty_funded notification:", error);
        // Don't block bounty creation if notification fails
      }

      // Publish bounty event to Nostr
      try {
        const hasNip07 = typeof window !== "undefined" && window.nostr;
        const privateKey = await getNostrPrivateKey();
        
        if (!currentUserPubkey) {
          console.warn("Cannot publish bounty: no user pubkey");
          return;
        }

        let bountyEvent: any;
        
        if (hasNip07 && window.nostr) {
          // Use NIP-07
          const authorPubkey = await window.nostr.getPublicKey();
          
          bountyEvent = {
            kind: KIND_BOUNTY,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
              ["e", issue.id, "", "issue"],
              ["repo", params.entity, params.repo],
              ["status", "paid"],
              ["p", authorPubkey, "creator"],
            ],
            content: JSON.stringify({
              amount: amount,
              status: "paid",
              withdrawId: withdrawId,
              lnurl: lnurl,
              withdrawUrl: withdrawUrl,
            }),
            pubkey: authorPubkey,
            id: "",
            sig: "",
          };
          
          bountyEvent.id = getEventHash(bountyEvent);
          bountyEvent = await window.nostr.signEvent(bountyEvent);
        } else if (privateKey) {
          // Use private key
          bountyEvent = createBountyEvent({
            issueId: issue.id,
            repoEntity: params.entity,
            repoName: params.repo,
            amount: amount,
            status: "paid",
            withdrawId: withdrawId,
            lnurl: lnurl,
            withdrawUrl: withdrawUrl,
            creator: currentUserPubkey,
            createdAt: Date.now(),
          }, privateKey);
        } else {
          console.warn("Cannot publish bounty: no signing method available");
          return;
        }

        // Publish to Nostr relays
        if (publish && defaultRelays && defaultRelays.length > 0 && bountyEvent) {
          try {
            publish(bountyEvent, defaultRelays);
            console.log("Published bounty event to Nostr:", bountyEvent.id);
          } catch (error) {
            console.error("Failed to publish bounty to Nostr:", error);
            // Don't block bounty creation if publishing fails
          }
        }
      } catch (error) {
        console.error("Failed to publish bounty event:", error);
        // Don't block bounty creation if publishing fails
      }
    } catch (error) {
      console.error("Failed to store bounty:", error);
    }
  }, [issue, params, currentUserPubkey, publish, defaultRelays]);

  // Handle comment creation
  const handleAddComment = useCallback(async () => {
    if (!commentContent.trim() || !issue || !currentUserPubkey) return;

    try {
      const hasNip07 = typeof window !== "undefined" && window.nostr;
      const privateKey = !hasNip07 ? await getNostrPrivateKey() : null;

      if (!hasNip07 && !privateKey) {
        alert("Please sign in to add comments.");
        return;
      }

      const commentId = `comment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const now = Date.now();
      
      const newComment: Comment = {
        id: commentId,
        author: currentUserPubkey,
        content: commentContent.trim(),
        createdAt: now,
        parentId: replyParentId || undefined,
      };

      // Save to localStorage first
      const commentsKey = `gittr_issue_comments_${params.entity}_${params.repo}_${issue.id}`;
      const storedComments = JSON.parse(localStorage.getItem(commentsKey) || "[]") as Comment[];
      storedComments.push(newComment);
      localStorage.setItem(commentsKey, JSON.stringify(storedComments));
      setComments(storedComments);

      // Clear comment form
      setCommentContent("");
      setReplyingTo(null);
      setReplyParentId(null);

      // Publish to Nostr
      let commentEvent: any;
      if (hasNip07 && window.nostr) {
        const authorPubkey = await window.nostr.getPublicKey();
        
        const tags: string[][] = [
          ["repo", params.entity, params.repo],
        ];

        // NIP-10 threading: root is the issue event ID, reply is parent comment ID
        if (issueEventId) {
          tags.push(["e", issueEventId, "", "root"]);
        }
        
        if (replyParentId) {
          tags.push(["e", replyParentId, "", "reply"]);
        } else if (issueEventId) {
          // If no parent, reply directly to issue
          tags.push(["e", issueEventId, "", "reply"]);
        }

        commentEvent = {
          kind: KIND_COMMENT,
          created_at: Math.floor(now / 1000),
          tags,
          content: commentContent.trim(),
          pubkey: authorPubkey,
          id: "",
          sig: "",
        };

        commentEvent.id = getEventHash(commentEvent);
        commentEvent = await window.nostr.signEvent(commentEvent);
        newComment.nostrEventId = commentEvent.id;
      } else if (privateKey) {
        commentEvent = createCommentEvent(
          {
            replyTo: replyParentId || issueEventId || undefined,
            repoEntity: params.entity,
            repoName: params.repo,
            issueId: issue.id,
            content: commentContent.trim(),
          },
          privateKey
        );
        newComment.nostrEventId = commentEvent.id;
      }

      // Update comment with Nostr event ID
      if (commentEvent) {
        const updatedComments = storedComments.map((c) =>
          c.id === newComment.id ? { ...c, nostrEventId: commentEvent.id } : c
        );
        localStorage.setItem(commentsKey, JSON.stringify(updatedComments));
        setComments(updatedComments);
      }

      // Publish to Nostr relays
      if (publish && defaultRelays && defaultRelays.length > 0 && commentEvent) {
        try {
          publish(commentEvent, defaultRelays);
          console.log("Published comment to Nostr:", commentEvent.id);
        } catch (error) {
          console.error("Failed to publish comment to Nostr:", error);
        }
      }

      // Send notifications
      try {
        // Notify issue author (if not the commenter)
        if (issue.author && issue.author.toLowerCase() !== currentUserPubkey.toLowerCase()) {
          const notification = formatNotificationMessage("issue_commented", {
            repoEntity: params.entity,
            repoName: params.repo,
            issueId: issue.id,
            issueTitle: issue.title,
            authorName: userName || "Someone",
            url: typeof window !== "undefined" ? `${window.location.origin}/${params.entity}/${params.repo}/issues/${issue.id}` : undefined,
          });

          await sendNotification({
            eventType: "issue_commented",
            title: notification.title,
            message: notification.message,
            url: notification.url,
            repoEntity: params.entity,
            repoName: params.repo,
            recipientPubkey: issue.author,
          });
        }

        // Detect @mentions and send notifications
        const mentionedPubkeys = extractMentionedPubkeys(commentContent);
        const uniqueMentions = Array.from(new Set(mentionedPubkeys));
        const mentionsToNotify = uniqueMentions.filter(
          (pubkey) =>
            pubkey.toLowerCase() !== currentUserPubkey.toLowerCase() &&
            pubkey.toLowerCase() !== issue.author.toLowerCase() // Don't notify twice
        );

        if (mentionsToNotify.length > 0) {
          const notification = formatNotificationMessage("mention", {
            repoEntity: params.entity,
            repoName: params.repo,
            issueId: issue.id,
            issueTitle: issue.title,
            authorName: userName || "Someone",
            url: typeof window !== "undefined" ? `${window.location.origin}/${params.entity}/${params.repo}/issues/${issue.id}` : undefined,
          });

          await Promise.all(
            mentionsToNotify.map((pubkey) =>
              sendNotification({
                eventType: "mention",
                title: notification.title,
                message: notification.message,
                url: notification.url,
                repoEntity: params.entity,
                repoName: params.repo,
                recipientPubkey: pubkey,
              }).catch((err) => {
                console.error(`Failed to send mention notification to ${pubkey.slice(0, 8)}...:`, err);
              })
            )
          );
        }
      } catch (error) {
        console.error("Failed to send comment notifications:", error);
      }
    } catch (error) {
      console.error("Failed to add comment:", error);
      alert("Failed to add comment: " + (error as Error).message);
    }
  }, [commentContent, issue, currentUserPubkey, replyParentId, issueEventId, params, publish, defaultRelays, userName]);

  const startReply = useCallback((parentId?: string, authorPubkey?: string) => {
    setReplyParentId(parentId || null);
    setReplyingTo(authorPubkey || null);
    setCommentContent(parentId ? `@${authorPubkey?.slice(0, 8)}... ` : "");
    setTimeout(() => commentTextareaRef.current?.focus(), 100);
  }, []);

  // Build threaded comment tree
  const buildCommentTree = useCallback((comments: Comment[]): Array<Comment & { depth: number; children: any[] }> => {
    const commentMap = new Map<string, Comment & { depth: number; children: any[] }>();
    const rootComments: Array<Comment & { depth: number; children: any[] }> = [];

    // First pass: create all comment nodes
    comments.forEach((comment) => {
      commentMap.set(comment.id, {
        ...comment,
        depth: 0,
        children: [],
      });
    });

    // Second pass: build tree
    comments.forEach((comment) => {
      const node = commentMap.get(comment.id)!;
      if (comment.parentId) {
        const parent = commentMap.get(comment.parentId);
        if (parent) {
          parent.children.push(node);
          node.depth = parent.depth + 1;
        } else {
          // Orphan comment - treat as root
          rootComments.push(node);
        }
      } else {
        rootComments.push(node);
      }
    });

    // Sort each level by creation time
    const sortTree = (nodes: Array<Comment & { depth: number; children: any[] }>) => {
      nodes.sort((a, b) => a.createdAt - b.createdAt);
      nodes.forEach((node) => {
        if (node.children.length > 0) {
          sortTree(node.children);
        }
      });
    };

    sortTree(rootComments);
    return rootComments;
  }, []);

  // Get all comment author pubkeys for metadata
  const commentAuthorPubkeys = useMemo(() => {
    return comments.map((c) => c.author).filter((pubkey) => /^[0-9a-f]{64}$/i.test(pubkey));
  }, [comments]);
  const commentAuthorMetadata = useContributorMetadata(commentAuthorPubkeys);

  const filteredLabels = useMemo(() => {
    if (!labelSearch) return availableLabels;
    return availableLabels.filter(l => l.toLowerCase().includes(labelSearch.toLowerCase()));
  }, [availableLabels, labelSearch]);

  if (loading) {
    return <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">Loading issue...</div>;
  }

  if (!issue) {
    return (
      <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
        <p className="text-gray-400">Issue not found</p>
        <Link href={`/${params.entity}/${params.repo}/issues`} className="text-purple-500 hover:underline">
          Back to issues
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
      {/* Breadcrumbs - Match URL format for consistency */}
      <nav className="mb-4 text-sm text-gray-400">
        <Link href={`/${params.entity}/${params.repo}`} className="hover:text-purple-400">
          {repoOwnerPubkey ? getEntityDisplayName(repoOwnerPubkey, repoOwnerMetadata, params.entity) : (params.entity.startsWith('npub') ? params.entity.slice(0, 16) + '...' : params.entity)}/{params.repo}
        </Link>
        {" / "}
        <Link href={`/${params.entity}/${params.repo}/issues`} className="hover:text-purple-400">
          Issues
        </Link>
        {" / #"}
        {params.id}
      </nav>

      {/* Issue Header */}
      <div className="mb-4 flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            {issue.status === "open" ? (
              <CircleDot className="h-5 w-5 text-green-600" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-purple-600" />
            )}
            <h1 className="text-2xl font-bold">{issue.title}</h1>
            <Badge className="bg-gray-700">#{params.id}</Badge>
          </div>
          <div className="text-sm text-gray-400">
            {issue.status === "open" ? "Opened" : "Closed"} {formatDateTime24h(issue.createdAt)} by{" "}
            <Link href={`/${issue.author}`} className="hover:text-purple-400 flex items-center gap-1">
              {(() => {
                const meta = authorMetadata[issue.author];
                return meta?.display_name || meta?.name || issue.author.slice(0, 8) + "...";
              })()}
            </Link>
          </div>
        </div>
        {isOwner && (
          <Button
            variant="outline"
            onClick={handleToggleStatus}
            className="ml-4"
          >
            {issue.status === "open" ? "Close issue" : "Reopen issue"}
          </Button>
        )}
      </div>

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
                {issue.description}
              </ReactMarkdown>
            </div>
            {/* Reactions */}
            <div className="mt-4 pt-4 border-t border-gray-700">
              <Reactions
                targetId={issue.id}
                targetType="issue"
                entity={params.entity}
                repo={params.repo}
              />
            </div>
          </div>

          {/* Take Bounty / Propose Fix Button */}
          {issue.bountyAmount && issue.bountyAmount > 0 && issue.bountyStatus === "paid" && issue.status === "open" && (
            <div className="border border-gray-700 rounded p-4 bg-gradient-to-r from-purple-900/20 to-orange-900/20">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <h3 className="font-semibold mb-1 flex items-center gap-2">
                    <Coins className="h-5 w-5 text-yellow-400" />
                    {issue.bountyAmount} sats bounty available
                  </h3>
                  <p className="text-sm text-gray-400 mb-3">
                    {issue.linkedPR 
                      ? "A PR is already linked to this issue. Work on the existing PR to claim the bounty."
                      : "Create a pull request fixing this issue to claim the bounty. The bounty will be released when your PR is merged."}
                  </p>
                </div>
                {!issue.linkedPR && (
                  <Link href={`/${params.entity}/${params.repo}/pulls/new?issue=${issue.id}`}>
                    <Button className="bg-gradient-to-r from-purple-600 to-orange-600 hover:from-purple-700 hover:to-orange-700">
                      <GitBranch className="mr-2 h-4 w-4" />
                      Propose a Fix
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* Comments Section */}
          <div className="border border-gray-700 rounded p-4">
            <h3 className="font-semibold mb-4">
              {comments.length} {comments.length === 1 ? "Comment" : "Comments"}
            </h3>

            {/* Threaded Comments */}
            <div className="space-y-4 mb-6">
              {comments.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No comments yet. Be the first to comment!
                </div>
              ) : (
                buildCommentTree(comments).map((comment) => {
                  const renderComment = (
                    comment: Comment & { depth: number; children: any[] },
                    allComments: Comment[]
                  ) => {
                    const authorMeta = commentAuthorMetadata[comment.author];
                    const indent = comment.depth * 32; // 32px per level

                    return (
                      <div key={comment.id} className="mb-4" style={{ marginLeft: `${indent}px` }}>
                        <div className="border border-gray-700 rounded p-4 bg-gray-900/50">
                          <div className="flex items-start gap-3">
                            <Avatar className="h-8 w-8 flex-shrink-0">
                              {authorMeta?.picture && authorMeta.picture.startsWith("http") ? (
                                <AvatarImage src={authorMeta.picture} />
                              ) : null}
                              <AvatarFallback className="bg-gray-700 text-white text-xs">
                                {authorMeta?.display_name || authorMeta?.name || comment.author.slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2">
                                <Link
                                  href={`/${comment.author}`}
                                  className="font-semibold hover:text-purple-400"
                                >
                                  {authorMeta?.display_name || authorMeta?.name || comment.author.slice(0, 8) + "..."}
                                </Link>
                                <span className="text-xs text-gray-500">
                                  {formatDateTime24h(comment.createdAt)}
                                </span>
                                {comment.edited && (
                                  <span className="text-xs text-gray-500 italic">(edited)</span>
                                )}
                              </div>
                              <div className="prose prose-invert max-w-none text-sm mb-3">
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm]}
                                  rehypePlugins={[rehypeRaw]}
                                  components={{
                                    a: ({ node, ...props }: any) => {
                                      // Resolve relative links relative to repo root, not current page
                                      let href = props.href || '';
                                      if (href && !href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('mailto:') && !href.startsWith('#')) {
                                        // Relative link - resolve relative to repo root
                                        const repoBasePath = getRepoLink('');
                                        // Remove leading ./ or . if present
                                        const cleanHref = href.replace(/^\.\//, '').replace(/^\.$/, '');
                                        // If it starts with /, it's root-relative to repo
                                        if (cleanHref.startsWith('/')) {
                                          href = `${repoBasePath}${cleanHref}`;
                                        } else {
                                          // Relative path - resolve from repo root
                                          href = `${repoBasePath}/${cleanHref}`;
                                        }
                                      }
                                      return <a {...props} href={href} target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300" />;
                                    },
                                  }}
                                >
                                  {comment.content}
                                </ReactMarkdown>
                              </div>
                              <div className="flex items-center gap-4">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => startReply(comment.id, comment.author)}
                                  className="text-xs h-7"
                                >
                                  <Reply className="h-3 w-3 mr-1" />
                                  Reply
                                </Button>
                                <Reactions
                                  targetId={comment.id}
                                  targetType="comment"
                                  entity={params.entity}
                                  repo={params.repo}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                        
                        {/* Render nested replies */}
                        {comment.children.length > 0 && (
                          <div className="mt-2">
                            {comment.children.map((child) => renderComment(child, allComments))}
                          </div>
                        )}
                      </div>
                    );
                  };
                  return renderComment(comment, comments);
                })
              )}
            </div>

            {/* Comment Form */}
            {currentUserPubkey ? (
              <div className="border border-gray-700 rounded p-4 bg-gray-900/50">
                {replyingTo && (
                  <div className="mb-2 text-sm text-gray-400">
                    Replying to <span className="text-purple-400">{replyingTo.slice(0, 8)}...</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setReplyingTo(null);
                        setReplyParentId(null);
                        setCommentContent("");
                      }}
                      className="ml-2 h-5 text-xs"
                    >
                      Cancel
                    </Button>
                  </div>
                )}
                <Textarea
                  ref={commentTextareaRef}
                  value={commentContent}
                  onChange={(e) => setCommentContent(e.target.value)}
                  placeholder={replyingTo ? "Write a reply..." : "Write a comment..."}
                  className="min-h-24 mb-3"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      handleAddComment();
                    }
                  }}
                />
                <div className="flex justify-end">
                  <Button
                    onClick={handleAddComment}
                    disabled={!commentContent.trim()}
                    className="bg-purple-600 hover:bg-purple-700"
                  >
                    {replyingTo ? "Post Reply" : "Post Comment"}
                  </Button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Press Ctrl+Enter or Cmd+Enter to submit
                </p>
              </div>
            ) : (
              <div className="border border-gray-700 rounded p-4 text-center text-gray-400">
                <Link href="/login" className="text-purple-400 hover:underline">
                  Sign in
                </Link>{" "}
                to comment
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Assignees */}
          <div className="border border-gray-700 rounded p-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold">Assignees</label>
              {isOwner && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                      <Plus className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent 
                    className="w-80"
                    onInteractOutside={(e) => {
                      // Don't close when clicking inside the input
                      const target = e.target as HTMLElement;
                      if (target.closest('input') || target.closest('button[type="button"]')) {
                        e.preventDefault();
                      }
                    }}
                  >
                    <DropdownMenuLabel>Assign to</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <div className="p-2 space-y-2">
                      <NostrUserSearch
                        value={assigneeSearch}
                        onChange={setAssigneeSearch}
                        onSelect={(user) => {
                          // Add user by pubkey (handleAddAssignee will decode npub if needed)
                          handleAddAssignee(user.pubkey);
                        }}
                        placeholder="Search by name, npub, or pubkey..."
                        disabled={issue.assignees.length >= 10}
                        maxResults={10}
                      />
                      {assigneeSearch.trim() && (
                        <Button
                          type="button"
                          size="sm"
                          className="w-full"
                          onClick={() => {
                            if (assigneeSearch.trim()) {
                              handleAddAssignee(assigneeSearch);
                            }
                          }}
                          disabled={issue.assignees.length >= 10}
                        >
                          Add
                        </Button>
                      )}
                      {currentUserPubkey && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => handleAddAssignee(currentUserPubkey)}
                          disabled={issue.assignees.includes(currentUserPubkey)}
                        >
                          <User className="mr-2 h-4 w-4" />
                          Assign yourself
                        </Button>
                      )}
                      {repoContributors.length > 0 && (
                        <>
                          <DropdownMenuSeparator />
                          <div className="p-2 space-y-2">
                            <p className="text-xs text-gray-400 mb-2">Repository Contributors:</p>
                            <div className="space-y-1 max-h-40 overflow-y-auto">
                              {repoContributors
                                .filter(c => !issue.assignees.includes(c.pubkey))
                                .map((contributor) => {
                                  const meta = repoContributorMetadata[contributor.pubkey];
                                  const displayName = meta?.display_name || meta?.name || contributor.name || contributor.pubkey.slice(0, 8) + "...";
                                  const npub = (() => {
                                    try {
                                      return nip19.npubEncode(contributor.pubkey);
                                    } catch {
                                      return null;
                                    }
                                  })();
                                  
                                  return (
                                    <button
                                      key={contributor.pubkey}
                                      type="button"
                                      onClick={() => handleAddAssignee(contributor.pubkey)}
                                      className="w-full flex items-center gap-2 text-xs bg-gray-800 hover:bg-gray-700 p-2 rounded transition-colors group"
                                      disabled={issue.assignees.length >= 10}
                                      title={npub ? `npub: ${npub}` : `pubkey: ${contributor.pubkey}`}
                                    >
                                      <Avatar className="h-5 w-5 flex-shrink-0">
                                        {(meta?.picture || contributor.picture) && (meta?.picture || contributor.picture)?.startsWith("http") ? (
                                          <AvatarImage src={meta?.picture || contributor.picture} />
                                        ) : null}
                                        <AvatarFallback className="bg-gray-700 text-white text-[8px]">
                                          {displayName.slice(0, 2).toUpperCase()}
                                        </AvatarFallback>
                                      </Avatar>
                                      <span className="text-purple-300 flex-1 text-left truncate">{displayName}</span>
                                      {contributor.role && (
                                        <span className="text-[10px] text-gray-500 capitalize">{contributor.role}</span>
                                      )}
                                      {npub && (
                                        <span className="text-[10px] text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity font-mono truncate max-w-[60px]">
                                          ({npub.slice(0, 8)}...)
                                        </span>
                                      )}
                                    </button>
                                  );
                                })}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            {issue.assignees.length > 0 ? (
              <div className="space-y-2">
                {issue.assignees.map((pubkey) => {
                  const meta = assigneeMetadata[pubkey];
                  const displayName = meta?.display_name || meta?.name || pubkey.slice(0, 8) + "...";
                  const npub = pubkey.length === 64 ? (() => {
                    try {
                      return nip19.npubEncode(pubkey);
                    } catch {
                      return null;
                    }
                  })() : null;
                  
                  return (
                  <div key={pubkey} className="flex items-center justify-between">
                      <Link 
                        href={`/${pubkey}`} 
                        className="flex items-center gap-2 text-sm hover:text-purple-400 group"
                        title={npub ? `npub: ${npub}` : `pubkey: ${pubkey}`}
                      >
                        <Avatar className="h-6 w-6 ring-1 ring-gray-500">
                          {meta?.picture && meta.picture.startsWith("http") ? (
                            <AvatarImage src={meta.picture} />
                          ) : null}
                          <AvatarFallback className="bg-gray-700 text-white text-xs">
                            {displayName.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span>{displayName}</span>
                        {npub && (
                          <span className="text-xs text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity font-mono">
                            ({npub.slice(0, 16)}...)
                          </span>
                        )}
                    </Link>
                    {isOwner && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveAssignee(pubkey)}
                        className="h-6 w-6 p-0"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No one yet {isOwner && "– assign yourself"}</p>
            )}
          </div>

          {/* Labels */}
          <div className="border border-gray-700 rounded p-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold">Labels</label>
              {isOwner && availableLabels.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                      <Plus className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuLabel>Apply labels</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <div className="p-2">
                      <Input
                        placeholder="Filter labels..."
                        value={labelSearch}
                        onChange={(e) => setLabelSearch(e.target.value)}
                        className="mb-2"
                      />
                      <div className="max-h-48 overflow-y-auto">
                        {filteredLabels.map((label) => (
                          <DropdownMenuItem
                            key={label}
                            onClick={() => handleToggleLabel(label)}
                            className={issue.labels.includes(label) ? "bg-purple-900/50" : ""}
                          >
                            {issue.labels.includes(label) && <CheckCircle2 className="mr-2 h-4 w-4" />}
                            {label}
                          </DropdownMenuItem>
                        ))}
                      </div>
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            {issue.labels.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {issue.labels.map((label) => (
                  <Badge key={label} variant="outline" className="text-xs">
                    {label}
                    {isOwner && (
                      <button
                        onClick={() => handleToggleLabel(label)}
                        className="ml-1 hover:text-red-400"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">None yet</p>
            )}
          </div>

          {/* Projects */}
          <div className="border border-gray-700 rounded p-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold">Projects</label>
              <Settings className="h-4 w-4 text-gray-400" />
            </div>
            <p className="text-sm text-gray-400">None yet</p>
          </div>

          {/* Milestones */}
          <div className="border border-gray-700 rounded p-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold">Milestones</label>
              <Settings className="h-4 w-4 text-gray-400" />
            </div>
            <p className="text-sm text-gray-400">No milestone</p>
          </div>

          {/* Bounty Section */}
          <div className="border border-gray-700 rounded p-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold flex items-center gap-2">
                <Coins className="h-4 w-4" />
                Bounty
              </label>
            </div>
            {issue.bountyStatus === "paid" && issue.bountyAmount ? (
              <div className="space-y-2">
                <div className="text-sm text-green-400">
                  {issue.bountyAmount} sats available
                </div>
                <p className="text-xs text-gray-500">
                  Bounty withdraw link created. When a PR fixing this issue is merged, the PR author can claim the bounty using the withdraw link.
                </p>
              </div>
            ) : issue.bountyStatus === "released" && issue.bountyAmount ? (
              <div className="text-sm text-green-400">
                {issue.bountyAmount} sats (released)
              </div>
            ) : issue.bountyStatus === "pending" && issue.bountyAmount ? (
              <div className="space-y-2">
                <div className="text-sm text-yellow-400">
                  {issue.bountyAmount} sats
                </div>
                <p className="text-xs text-gray-500">
                  Bounty withdraw link creation in progress...
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-gray-400 mb-2">No bounty yet</p>
                <p className="text-xs text-gray-500 mb-2">
                  Add a bounty to incentivize contributors. The bounty amount will be deducted from your LNbits wallet and a withdraw link will be created. Make sure you have sufficient balance. When a PR fixing this issue is merged, the PR author can claim the bounty.
                </p>
                {/* Any logged-in user can add a bounty to any issue */}
                <BountyButton
                  issueId={issue.id}
                  issueTitle={issue.title}
                  repoEntity={params.entity}
                  repoName={params.repo}
                  repoOwnerDisplayName={repoOwnerPubkey && repoOwnerMetadata[repoOwnerPubkey] 
                    ? (repoOwnerMetadata[repoOwnerPubkey]?.display_name || repoOwnerMetadata[repoOwnerPubkey]?.name)
                    : undefined}
                  onBountyCreated={handleBountyCreated}
                  size="sm"
                />
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}

