"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeSnippetRenderer } from "@/components/ui/code-snippet-renderer";
import { ConflictDetector } from "@/components/ui/conflict-detector";
import { FileDiffViewer } from "@/components/ui/file-diff-viewer";
import { PaymentQR } from "@/components/ui/payment-qr";
import { PRReviewSection } from "@/components/ui/pr-review-section";
import { Reactions } from "@/components/ui/reactions";
import { Textarea } from "@/components/ui/textarea";
import { ZapButton } from "@/components/ui/zap-button";
import { recordActivity } from "@/lib/activity-tracking";
import { detectConflicts } from "@/lib/git/conflict-detection";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import {
  KIND_BOUNTY,
  KIND_CODE_SNIPPET,
  KIND_COMMENT,
  KIND_PR_UPDATE,
  KIND_PULL_REQUEST,
  KIND_STATUS_APPLIED,
  KIND_STATUS_CLOSED,
  KIND_STATUS_OPEN,
  buildUnsignedCommentEvent,
  createBountyEvent,
  createCommentEvent,
  createPullRequestUpdateEvent,
  createStatusEvent,
} from "@/lib/nostr/events";
import { parseKind1618PrGitHints } from "@/lib/nostr/kind1618-pr-git-hints";
import {
  type Nip22Comment,
  commentEventBelongsToThread,
  parseNip22Comment,
  prCommentsStorageKey,
  repoTagMatchesRoute,
} from "@/lib/nostr/nip22-comment-thread";
import { pushRepoToNostr } from "@/lib/nostr/push-repo-to-nostr";
import {
  NO_SIGNING_METHOD_MESSAGE,
  resolveSigningCredentials,
} from "@/lib/nostr/signer";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import useSession from "@/lib/nostr/useSession";
import {
  formatNotificationMessage,
  sendNotification,
} from "@/lib/notifications";
import { ensurePushPaymentAuthorization } from "@/lib/payments/push-paywall";
import {
  isOwner as checkIsOwner,
  hasWriteAccess,
} from "@/lib/repo-permissions";
import {
  type RepoFileEntry,
  type StoredContributor,
  type StoredRepo,
  loadRepoFiles,
  loadRepoOverrides,
  loadRepoOverridesResolved,
  loadStoredRepos,
  saveRepoFiles,
  saveRepoOverrides,
  saveStoredRepos,
} from "@/lib/repos/storage";
import { resolveGithubUpstreamForTabs } from "@/lib/repos/upstream-precedence";
import {
  getNostrPrivateKey,
  getSecureItem,
} from "@/lib/security/encryptedStorage";
import { markdownRehypePlugins } from "@/lib/security/markdown-rehype-plugins";
import { formatDateTime24h } from "@/lib/utils/date-format";
import {
  getRepoStorageKey,
  normalizeEntityForStorage,
} from "@/lib/utils/entity-normalizer";
import {
  getEntityDisplayName,
  getRepoOwnerPubkey,
  resolveEntityToPubkey,
} from "@/lib/utils/entity-resolver";
import {
  fetchPrFileDiffs,
  prDiffLooksLikeUnifiedPatch,
} from "@/lib/utils/fetch-pr-file-diffs";
import {
  findPullRequestRowIndexByRouteParam,
  isGithubStylePrId,
} from "@/lib/utils/issue-pr-status";
import { MarkdownCode } from "@/lib/utils/markdown-code";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";

import {
  CheckCircle2,
  GitMerge,
  GitPullRequest,
  Users,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getEventHash } from "nostr-tools";
import { nip19 } from "nostr-tools";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted";
  before?: string;
  after?: string;
  isBinary?: boolean;
  mimeType?: string;
  diffPreview?: boolean;
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
  cloneUrls?: string[];
  currentCommitId?: string;
  mergeBase?: string;
  headSha?: string;
  baseSha?: string;
  html_url?: string;
  number?: string;
  /** Merged in gittr while GitHub (or other source) may still list this PR open. */
  sourcePrStillOpen?: boolean;
}

function isHexEventId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function persistPrComments(
  entity: string,
  repo: string,
  rootId: string,
  comments: Nip22Comment[]
) {
  try {
    localStorage.setItem(
      prCommentsStorageKey(entity, repo, rootId),
      JSON.stringify(comments)
    );
  } catch {
    /* ignore quota */
  }
}

export default function PRDetailPage({
  params,
}: {
  params: Promise<{ entity: string; repo: string; id: string }>;
}) {
  const resolvedParams = use(params);
  const router = useRouter();
  const {
    pubkey: currentUserPubkey,
    publish,
    defaultRelays,
    remoteSigner,
  } = useNostrContext();
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
  /** After conflict resolve: use these files and skip re-detect (avoids sticky loop). */
  const mergeFilesOverrideRef = useRef<ChangedFile[] | null>(null);
  const skipConflictCheckRef = useRef(false);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [checkingBalance, setCheckingBalance] = useState(false);
  const [bountyPaymentStatus, setBountyPaymentStatus] = useState<
    "pending" | "success" | "failed" | null
  >(null);
  const [bountyPaymentHash, setBountyPaymentHash] = useState<string | null>(
    null
  );
  const [snippetEvents, setSnippetEvents] = useState<Map<string, any>>(
    new Map()
  );
  const [comments, setComments] = useState<Nip22Comment[]>([]);
  const [commentContent, setCommentContent] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [prEventId, setPrEventId] = useState<string | null>(null);
  const [loadingRemoteDiffs, setLoadingRemoteDiffs] = useState(false);
  const [remoteDiffError, setRemoteDiffError] = useState<string | null>(null);
  const lastRemoteDiffKey = useRef("");
  const [prStorageRev, setPrStorageRev] = useState(0);
  const [mergePublishReady, setMergePublishReady] = useState<boolean>(false);
  const [mergePublishReason, setMergePublishReason] = useState<string>("");
  const [mergePushPayment, setMergePushPayment] = useState<{
    invoice: string;
    pushCostSats: number;
    ownerPubkey: string;
    repoName: string;
    ownerLnbitsUrl?: string;
    ownerLnbitsReadKey?: string;
    ownerBlinkApiKey?: string;
  } | null>(null);

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
    comments.forEach((c) => {
      if (c.author) pubkeys.add(c.author);
    });
    return Array.from(pubkeys);
  }, [
    pr?.author,
    pr?.mergedBy,
    pr?.contributors,
    linkedIssue?.bountyCreator,
    comments,
  ]);

  const recipientMetadata = useContributorMetadata(allPubkeys);
  const recipientMeta = pr?.author ? recipientMetadata[pr.author] : null;

  // Load required approvals from repo settings
  useEffect(() => {
    try {
      const repos = loadStoredRepos();
      const repo = findRepoByEntityAndName<StoredRepo>(
        repos,
        resolvedParams.entity,
        resolvedParams.repo
      );
      // requiredApprovals is not in StoredRepo interface, default to 0
      setRequiredApprovals(0);
    } catch {}
  }, [resolvedParams.entity, resolvedParams.repo]);

  useEffect(() => {
    const bump = () => setPrStorageRev((n) => n + 1);
    window.addEventListener("gittr:pr-updated", bump);
    return () => window.removeEventListener("gittr:pr-updated", bump);
  }, []);

  // Subscribe to snippets referenced in PR description and snippets that reference this PR
  useEffect(() => {
    if (!subscribe || !defaultRelays) return;

    const filters: any[] = [];

    // Filter 1: Snippets that reference this PR via #e tag
    if (prEventId) {
      filters.push({
        kinds: [KIND_CODE_SNIPPET],
        "#e": [prEventId],
      });
    }

    // Filter 2: Snippets referenced by ID in PR description
    if (pr?.body) {
      const snippetIdPattern = /(?:nostr:)?(note1[a-z0-9]{58}|[0-9a-f]{64})/gi;
      const matches = pr.body.matchAll(snippetIdPattern);
      const snippetIds: string[] = [];
      for (const match of matches) {
        const id = match[1];
        if (!id) continue; // Skip if no match
        if (id.startsWith("note1")) {
          try {
            const decoded = nip19.decode(id);
            if (decoded.type === "note") {
              snippetIds.push(decoded.data as string);
            }
          } catch {
            // Invalid bech32, skip
          }
        } else if (/^[0-9a-f]{64}$/i.test(id)) {
          snippetIds.push(id);
        }
      }

      if (snippetIds.length > 0) {
        filters.push({
          kinds: [KIND_CODE_SNIPPET],
          ids: snippetIds,
        });
      }
    }

    if (filters.length === 0) return;

    // Subscribe to snippet events
    const unsub = subscribe(
      filters,
      defaultRelays,
      (event, isAfterEose, relayURL) => {
        if (event.kind === KIND_CODE_SNIPPET) {
          // Verify snippet is for this PR/repo
          const eTags = event.tags.filter(
            (t): t is string[] => Array.isArray(t) && t[0] === "e"
          );
          const repoTag = event.tags.find(
            (t): t is string[] => Array.isArray(t) && t[0] === "repo"
          );

          // Check if snippet references this PR or is in PR description
          const referencesThisPR =
            prEventId && eTags.some((t) => t[1] === prEventId);
          const isInDescription = pr?.body && pr.body.includes(event.id);
          const isForThisRepo = repoTagMatchesRoute(
            repoTag,
            resolvedParams.entity,
            resolvedParams.repo
          );

          if (
            (referencesThisPR || isInDescription) &&
            (isForThisRepo || !repoTag)
          ) {
            setSnippetEvents((prev) => {
              const newMap = new Map(prev);
              newMap.set(event.id, event);
              return newMap;
            });
          }
        }
      }
    );

    return () => {
      unsub();
    };
  }, [
    subscribe,
    defaultRelays,
    pr?.body,
    prEventId,
    resolvedParams.entity,
    resolvedParams.repo,
  ]);

  useEffect(() => {
    if (!prEventId) {
      setComments([]);
      return;
    }
    try {
      const raw = localStorage.getItem(
        prCommentsStorageKey(
          resolvedParams.entity,
          resolvedParams.repo,
          prEventId
        )
      );
      const stored = raw ? (JSON.parse(raw) as Nip22Comment[]) : [];
      setComments(Array.isArray(stored) ? stored : []);
    } catch {
      setComments([]);
    }
  }, [prEventId, resolvedParams.entity, resolvedParams.repo]);

  // NIP-22 comments on this PR (kind 1111). Issues already did this; PRs did not.
  useEffect(() => {
    if (!subscribe || !defaultRelays || !prEventId) return;
    const unsub = subscribe(
      [
        {
          kinds: [KIND_COMMENT, 1],
          "#E": [prEventId],
          "#e": [prEventId],
        },
      ],
      defaultRelays,
      (event) => {
        if (event.kind !== KIND_COMMENT && event.kind !== 1) return;
        if (
          !commentEventBelongsToThread(event, {
            rootEventId: prEventId,
            entity: resolvedParams.entity,
            repo: resolvedParams.repo,
          })
        ) {
          return;
        }
        const parsed = parseNip22Comment(event, prEventId);
        if (!parsed) return;
        setComments((prev) => {
          const exists = prev.some(
            (c) => c.id === parsed.id || c.nostrEventId === parsed.id
          );
          if (exists) return prev;
          const next = [...prev, parsed].sort(
            (a, b) => a.createdAt - b.createdAt
          );
          persistPrComments(
            resolvedParams.entity,
            resolvedParams.repo,
            prEventId,
            next
          );
          return next;
        });
      }
    );
    return () => {
      unsub();
    };
  }, [
    subscribe,
    defaultRelays,
    prEventId,
    resolvedParams.entity,
    resolvedParams.repo,
  ]);

  // Load PR data
  useEffect(() => {
    try {
      const key = getRepoStorageKey(
        "gittr_prs",
        resolvedParams.entity,
        resolvedParams.repo
      );
      const prs = JSON.parse(localStorage.getItem(key) || "[]") as any[];
      const prIdx = findPullRequestRowIndexByRouteParam(prs, resolvedParams.id);
      const prData = prIdx >= 0 ? prs[prIdx] : undefined;

      if (prData) {
        setPR({
          id: prData.id || resolvedParams.id,
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
          baseBranch: prData.baseBranch || prData.base || "main",
          headBranch: prData.headBranch || prData.head,
          cloneUrls: Array.isArray(prData.cloneUrls)
            ? prData.cloneUrls
            : undefined,
          currentCommitId: prData.currentCommitId,
          mergeBase: prData.mergeBase,
          headSha: prData.headSha,
          baseSha: prData.baseSha,
          html_url: prData.html_url,
          number: prData.number != null ? String(prData.number) : undefined,
          sourcePrStillOpen: Boolean(prData.sourcePrStillOpen),
        });
        // Store PR event ID if available
        const resolvedPrEventId =
          prData.nostrEventId ||
          prData.lastNostrEventId ||
          (isHexEventId(prData.id) ? prData.id : null) ||
          (isHexEventId(resolvedParams.id) ? resolvedParams.id : null);
        if (resolvedPrEventId) {
          setPrEventId(resolvedPrEventId);
        }

        // Check if current user can merge (owner or maintainer - write access)
        const repos = loadStoredRepos();
        // Try multiple lookup strategies - repo might be stored with different field names
        const repo = repos.find((r: StoredRepo) => {
          const entityMatch = r.entity === resolvedParams.entity;
          const repoMatch =
            r.repo === resolvedParams.repo ||
            r.slug === resolvedParams.repo ||
            r.name === resolvedParams.repo;
          return entityMatch && repoMatch;
        });

        if (repo && currentUserPubkey) {
          // CRITICAL: Use proper role-based permission checks
          const repoOwnerPubkey = getRepoOwnerPubkey(
            repo,
            resolvedParams.entity
          );
          const userIsOwnerValue = checkIsOwner(
            currentUserPubkey,
            repo.contributors,
            repoOwnerPubkey
          );
          const userCanMerge = hasWriteAccess(
            currentUserPubkey,
            repo.contributors,
            repoOwnerPubkey
          );

          setIsOwner(userIsOwnerValue);
          setCanMerge(userCanMerge);
        } else if (currentUserPubkey) {
          // FALLBACK: If repo not found, check if resolvedParams.entity (npub) matches current user
          // Decode npub to compare with full pubkey
          const entityPubkey = resolveEntityToPubkey(resolvedParams.entity);
          const entityMatches =
            entityPubkey &&
            entityPubkey.toLowerCase() === currentUserPubkey.toLowerCase();

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
          const issueKey = getRepoStorageKey(
            "gittr_issues",
            resolvedParams.entity,
            resolvedParams.repo
          );
          const issues = JSON.parse(localStorage.getItem(issueKey) || "[]");
          const issue = issues.find(
            (i: any) =>
              i.id === (prData.linkedIssue || prData.issueId) ||
              i.number === (prData.linkedIssue || prData.issueId)
          );
          if (issue) setLinkedIssue(issue);
        }
      } else if (isHexEventId(resolvedParams.id)) {
        setPrEventId(resolvedParams.id);
      }
      setLoading(false);
    } catch (error) {
      console.error("Failed to load PR:", error);
      setLoading(false);
    }
  }, [
    resolvedParams.id,
    resolvedParams.entity,
    resolvedParams.repo,
    currentUserPubkey,
    prStorageRev,
  ]);

  // Fill clone / commit tags if the list row was a thin warm upsert.
  useEffect(() => {
    if (!subscribe || !defaultRelays || !prEventId) return;
    const unsub = subscribe(
      [{ kinds: [KIND_PULL_REQUEST], ids: [prEventId] }],
      defaultRelays,
      (event) => {
        if (event.kind !== KIND_PULL_REQUEST || event.id !== prEventId) return;
        const hints = parseKind1618PrGitHints(event.tags);
        setPR((prev) => {
          if (!prev) return prev;
          const cloneUrls =
            hints.cloneUrls.length > 0 ? hints.cloneUrls : prev.cloneUrls;
          const currentCommitId = hints.currentCommitId || prev.currentCommitId;
          const mergeBase = hints.mergeBase || prev.mergeBase;
          const headBranch = hints.branchName || prev.headBranch;
          const body = prev.body || event.content || "";
          if (
            body === prev.body &&
            currentCommitId === prev.currentCommitId &&
            mergeBase === prev.mergeBase &&
            headBranch === prev.headBranch &&
            JSON.stringify(cloneUrls || []) ===
              JSON.stringify(prev.cloneUrls || [])
          ) {
            return prev;
          }
          return {
            ...prev,
            body,
            cloneUrls,
            currentCommitId,
            mergeBase,
            headBranch,
          };
        });
        try {
          const storageKey = getRepoStorageKey(
            "gittr_prs",
            resolvedParams.entity,
            resolvedParams.repo
          );
          const prs = JSON.parse(localStorage.getItem(storageKey) || "[]");
          const next = prs.map((row: { id?: string }) =>
            row.id === prEventId || row.id === event.id
              ? {
                  ...row,
                  cloneUrls:
                    hints.cloneUrls.length > 0
                      ? hints.cloneUrls
                      : (row as { cloneUrls?: string[] }).cloneUrls,
                  currentCommitId:
                    hints.currentCommitId ||
                    (row as { currentCommitId?: string }).currentCommitId,
                  mergeBase:
                    hints.mergeBase ||
                    (row as { mergeBase?: string }).mergeBase,
                }
              : row
          );
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* quota */
        }
      }
    );
    return () => {
      unsub();
    };
  }, [subscribe, defaultRelays, prEventId]);

  // Description is markdown; file list comes from git (clone/c) or GitHub files API.
  useEffect(() => {
    if (!pr) return;
    if ((pr.changedFiles && pr.changedFiles.length > 0) || pr.path) {
      setLoadingRemoteDiffs(false);
      return;
    }
    const rec =
      findRepoByEntityAndName<StoredRepo>(
        loadStoredRepos(),
        resolvedParams.entity,
        resolvedParams.repo
      ) ?? null;
    const ghUrl = rec
      ? resolveGithubUpstreamForTabs(
          resolvedParams.entity,
          resolvedParams.repo,
          rec
        )
      : "";
    const repoClones = Array.isArray(rec?.clone)
      ? rec.clone.filter((u): u is string => typeof u === "string")
      : [];
    const cloneUrls = [...new Set([...(pr.cloneUrls || []), ...repoClones])];
    const currentCommitId = pr.currentCommitId || pr.headSha;
    const mergeBase = pr.mergeBase || pr.baseSha;
    const canFetch = Boolean(
      currentCommitId || pr.html_url || isGithubStylePrId(pr.id)
    );
    const waitingHints = Boolean(
      (prEventId || isHexEventId(pr.id)) && !canFetch
    );
    if (!canFetch) {
      if (!waitingHints) return;
      setLoadingRemoteDiffs(true);
      const t = window.setTimeout(() => {
        setLoadingRemoteDiffs(false);
        setRemoteDiffError(
          "Could not load file changes from git or GitHub yet."
        );
      }, 15000);
      return () => clearTimeout(t);
    }
    const key = [
      pr.id,
      currentCommitId || "",
      mergeBase || "",
      pr.html_url || "",
      cloneUrls.join(","),
      ghUrl,
    ].join("|");
    if (key === lastRemoteDiffKey.current) return;
    lastRemoteDiffKey.current = key;
    let cancelled = false;
    let finished = false;
    (async () => {
      setLoadingRemoteDiffs(true);
      setRemoteDiffError(null);
      try {
        const files = await fetchPrFileDiffs({
          id: pr.id,
          number: pr.number,
          html_url: pr.html_url,
          cloneUrls,
          currentCommitId,
          mergeBase,
          nostrEventId: prEventId || (isHexEventId(pr.id) ? pr.id : undefined),
          githubSourceUrl: ghUrl || undefined,
        });
        if (cancelled) return;
        if (!files.length) {
          setRemoteDiffError(
            "Could not load file changes from git or GitHub yet."
          );
          return;
        }
        setPR((prev) => (prev ? { ...prev, changedFiles: files } : prev));
        try {
          const storageKey = getRepoStorageKey(
            "gittr_prs",
            resolvedParams.entity,
            resolvedParams.repo
          );
          const prs = JSON.parse(localStorage.getItem(storageKey) || "[]");
          const next = prs.map((row: { id?: string }) =>
            row.id === pr.id ? { ...row, changedFiles: files } : row
          );
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* quota */
        }
      } catch {
        if (!cancelled) {
          setRemoteDiffError(
            "Could not load file changes from git or GitHub yet."
          );
        }
      } finally {
        finished = true;
        if (!cancelled) setLoadingRemoteDiffs(false);
      }
    })();
    return () => {
      cancelled = true;
      if (!finished) lastRemoteDiffKey.current = "";
    };
  }, [pr, prEventId, resolvedParams.entity, resolvedParams.repo]);

  const changedFiles = useMemo(() => {
    if (pr?.changedFiles && pr.changedFiles.length > 0) {
      return pr.changedFiles;
    }
    if (pr?.path) {
      return [
        {
          path: pr.path,
          status: "modified" as const,
          before: pr.before,
          after: pr.after,
        },
      ];
    }
    return [];
  }, [pr]);

  const hasChanges = changedFiles.length > 0;

  const checkMergePublishPreflight = useCallback(async () => {
    if (!currentUserPubkey) {
      setMergePublishReady(false);
      setMergePublishReason("Not logged in");
      return;
    }

    const rootEventId = prEventId || (pr && isHexEventId(pr.id) ? pr.id : null);
    if (!rootEventId) {
      setMergePublishReady(false);
      setMergePublishReason("PR root event ID missing");
      return;
    }

    const signingCreds = await resolveSigningCredentials({ remoteSigner });
    if (signingCreds) {
      const { hasNip07, privateKey, signer } = signingCreds;
      setMergePublishReady(true);
      setMergePublishReason(
        signer.source === "remote"
          ? "Remote signer available"
          : hasNip07
          ? "NIP-07 signer available"
          : privateKey
          ? "Local private key signer available"
          : "Signer available"
      );
      return;
    }

    setMergePublishReady(false);
    setMergePublishReason("No signer available (NIP-07/private key)");
  }, [currentUserPubkey, prEventId, pr, remoteSigner]);

  const pushMergedRepoAfterPayment = useCallback(async () => {
    if (
      !mergePushPayment ||
      !publish ||
      !subscribe ||
      !defaultRelays?.length ||
      !currentUserPubkey
    ) {
      return;
    }
    try {
      const signingCreds = await resolveSigningCredentials({ remoteSigner });
      const pushResult = await pushRepoToNostr({
        repoSlug: resolvedParams.repo,
        entity: resolvedParams.entity,
        publish,
        subscribe,
        defaultRelays,
        privateKey: signingCreds?.privateKey || undefined,
        pubkey: currentUserPubkey,
        remoteSigner,
        onProgress: (message) => {
          console.log(`[Merge Push Retry ${resolvedParams.repo}] ${message}`);
        },
      });
      if (pushResult.success) {
        alert(
          "Push payment authorized and merged repository state was pushed."
        );
        window.dispatchEvent(new Event("gittr:repo-updated"));
        router.refresh();
      } else {
        alert(
          `Payment was confirmed, but push still failed: ${
            pushResult.error || "unknown push failure"
          }`
        );
      }
    } catch (error) {
      alert(
        `Payment was confirmed, but push retry failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      setMergePushPayment(null);
    }
  }, [
    mergePushPayment,
    publish,
    subscribe,
    defaultRelays,
    currentUserPubkey,
    resolvedParams.repo,
    resolvedParams.entity,
    router,
  ]);

  const handleMerge = useCallback(async () => {
    // Only owners and maintainers can merge (write access)
    if (!pr || !canMerge || merging) return;

    // CRITICAL: Require signature for merge (owner or maintainer must sign)
    if (!currentUserPubkey) {
      alert("Please log in to merge pull requests");
      return;
    }

    // Get private key for signing (required for merge)
    const signingCreds = await resolveSigningCredentials({ remoteSigner });
    if (!signingCreds) {
      alert(NO_SIGNING_METHOD_MESSAGE);
      return;
    }
    const { hasNip07, privateKey } = signingCreds;

    if (!privateKey && !hasNip07) {
      alert(
        "Merge requires signature. Please configure NIP-07 extension or private key in settings."
      );
      return;
    }

    // Get repo data to check roles
    const repos = loadStoredRepos();
    // Try multiple lookup strategies
    const repo = repos.find((r: StoredRepo) => {
      const entityMatch = r.entity === resolvedParams.entity;
      const repoMatch =
        r.repo === resolvedParams.repo ||
        r.slug === resolvedParams.repo ||
        r.name === resolvedParams.repo;
      return entityMatch && repoMatch;
    });

    // CRITICAL: Use proper role-based permission checks (no sliced pubkeys!)
    // resolvedParams.entity is in npub format, repo.entity should also be npub
    const repoOwnerPubkey = repo
      ? getRepoOwnerPubkey(repo, resolvedParams.entity)
      : null;
    const isRepoOwner =
      repoOwnerPubkey &&
      currentUserPubkey &&
      repoOwnerPubkey.toLowerCase() === currentUserPubkey.toLowerCase();

    // Check if user is maintainer (has write access but not owner)
    const isMaintainer =
      !isRepoOwner &&
      repo &&
      currentUserPubkey &&
      hasWriteAccess(currentUserPubkey, repo.contributors, repoOwnerPubkey);

    // Check if PR author is the owner/maintainer - can merge own PRs without approvals
    const isOwnerPR = isRepoOwner && pr.author === currentUserPubkey;
    const isMaintainerPR = isMaintainer && pr.author === currentUserPubkey;
    const canMergeOwnPR = isOwnerPR || isMaintainerPR;

    // Check reviews for required approvals (skip if owner/maintainer is merging their own PR)
    if (!canMergeOwnPR && requiredApprovals > 0) {
      try {
        const storageKey = `gittr_pr_reviews__${normalizeEntityForStorage(
          resolvedParams.entity
        )}__${resolvedParams.repo}__${pr.id}`;
        const reviews = JSON.parse(localStorage.getItem(storageKey) || "[]");

        // Only count approvals from users with merge rights (owners/maintainers), excluding the person doing the merge
        const approvalsFromMergeRightsHolders = reviews.filter((r: any) => {
          // Exclude the person doing the merge
          if (r.reviewer === currentUserPubkey) return false;

          // Check if reviewer has merge rights (owner or maintainer)
          if (!repo?.contributors) return false;

          const reviewer = repo.contributors.find(
            (c: any) => c.pubkey === r.reviewer
          );
          if (!reviewer) return false;

          // Check if reviewer is owner or maintainer
          const reviewerIsOwner =
            reviewer.role === "owner" ||
            (reviewer.role === undefined && reviewer.weight === 100) ||
            repo.ownerPubkey === r.reviewer;
          const reviewerIsMaintainer =
            reviewer.role === "maintainer" ||
            (reviewer.role === undefined &&
              reviewer.weight !== undefined &&
              reviewer.weight >= 50 &&
              reviewer.weight < 100);

          // Only count if reviewer has merge rights AND approved
          return (
            (reviewerIsOwner || reviewerIsMaintainer) && r.state === "APPROVED"
          );
        }).length;

        const changeRequests = reviews.filter(
          (r: any) => r.state === "CHANGES_REQUESTED"
        ).length;

        if (approvalsFromMergeRightsHolders < requiredApprovals) {
          alert(
            `This PR requires ${requiredApprovals} approval(s) from owners/maintainers before merging. Currently has ${approvalsFromMergeRightsHolders}.`
          );
          return;
        }

        if (changeRequests > 0) {
          alert(
            `This PR has ${changeRequests} change request(s) that must be addressed before merging.`
          );
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
      const repo = findRepoByEntityAndName<StoredRepo>(
        repos,
        resolvedParams.entity,
        resolvedParams.repo
      );

      const overrides = loadRepoOverrides(
        resolvedParams.entity,
        resolvedParams.repo
      );
      const resolvedOverrides = await loadRepoOverridesResolved(
        resolvedParams.entity,
        resolvedParams.repo
      );

      const initialChangedFiles: ChangedFile[] =
        pr.changedFiles ||
        (pr.path
          ? [
              {
                path: pr.path,
                status: "modified" as const,
                before: pr.before,
                after: pr.after,
              },
            ]
          : []);

      // Prefer files from a just-resolved conflict pass (React state may lag).
      const changedFiles: ChangedFile[] =
        mergeFilesOverrideRef.current &&
        mergeFilesOverrideRef.current.length > 0
          ? mergeFilesOverrideRef.current
          : initialChangedFiles;
      mergeFilesOverrideRef.current = null;

      const patchOnlyPreview =
        changedFiles.length > 0 &&
        changedFiles.every(
          (file) =>
            (file.diffPreview || prDiffLooksLikeUnifiedPatch(file.after)) &&
            !file.before
        );
      if (patchOnlyPreview) {
        setMerging(false);
        setMergeMessage(
          "This PR shows a remote diff preview. Merge it with git (the PR branch or refs/nostr/…) — in-app merge needs full file bodies."
        );
        return;
      }

      // Get current file state from overrides (expand IndexedDB pointers)
      const baseFiles: Record<string, string> = {};

      for (const file of changedFiles) {
        const overrideValue = resolvedOverrides[file.path];
        if (
          overrideValue !== undefined &&
          overrideValue !== null &&
          overrideValue !== ""
        ) {
          baseFiles[file.path] = overrideValue;
        } else {
          // Forge and Nostr-only: use PR "before" as tip baseline when we have
          // no local override. Empty "" made every Nostr-only edit look conflicting.
          baseFiles[file.path] = file.before || "";
        }
      }

      // Detect conflicts (skip once after user already resolved in the modal)
      if (!skipConflictCheckRef.current) {
        const conflictResult = detectConflicts(
          changedFiles,
          baseFiles,
          pr.baseBranch || "main"
        );

        if (conflictResult.hasConflicts) {
          setMerging(false);
          setConflicts(conflictResult.conflicts);
          setShowConflictModal(true);
          return;
        }
      }
      skipConflictCheckRef.current = false;

      // Continue with merge (no conflicts)

      // 1. Apply all file changes
      let totalInsertions = 0;
      let totalDeletions = 0;

      changedFiles.forEach((file) => {
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
              } else if (
                beforeLine !== undefined &&
                afterLine !== undefined &&
                beforeLine !== afterLine
              ) {
                totalDeletions++;
                totalInsertions++;
              }
            }
          } else if (file.after) {
            totalInsertions += file.after.split("\n").length;
          }
        }
      });

      saveRepoOverrides(resolvedParams.entity, resolvedParams.repo, overrides);
      try {
        const storedRepos = loadStoredRepos();
        const repoIndex = storedRepos.findIndex((storedRepo: StoredRepo) => {
          const repoMatches =
            storedRepo.repo === resolvedParams.repo ||
            storedRepo.slug === resolvedParams.repo ||
            storedRepo.name === resolvedParams.repo;
          const entityMatches =
            storedRepo.entity === resolvedParams.entity ||
            storedRepo.entity?.toLowerCase() ===
              resolvedParams.entity.toLowerCase();
          return repoMatches && entityMatches;
        });

        if (repoIndex >= 0) {
          const repoRecord = { ...storedRepos[repoIndex] };
          // Ensure entity is set (required by StoredRepo type)
          if (!repoRecord.entity) {
            repoRecord.entity = resolvedParams.entity;
          }
          const indexedFiles = loadRepoFiles(
            resolvedParams.entity,
            resolvedParams.repo
          );
          const existingFiles: RepoFileEntry[] =
            indexedFiles.length > 0
              ? [...indexedFiles]
              : Array.isArray(repoRecord.files)
              ? [...repoRecord.files]
              : [];
          const fileMap = new Map<string, RepoFileEntry>();
          existingFiles.forEach((fileEntry) =>
            fileMap.set(fileEntry.path, fileEntry)
          );

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

          const updatedFilesArray = Array.from(fileMap.values()).sort((a, b) =>
            a.path.localeCompare(b.path)
          );
          repoRecord.files = updatedFilesArray;
          storedRepos[repoIndex] = repoRecord as StoredRepo;
          saveStoredRepos(storedRepos);
          saveRepoFiles(
            resolvedParams.entity,
            resolvedParams.repo,
            updatedFilesArray
          );
          window.dispatchEvent(new Event("gittr:repo-updated"));
        }
      } catch (error) {
        console.error("Failed to sync repo files after merge:", error);
      }

      // 2. Create commit record
      const commitId = `commit-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      // Get PR author name for commit message
      const authorMeta = pr.author ? recipientMetadata[pr.author] : null;
      const authorName =
        authorMeta?.display_name ||
        authorMeta?.name ||
        (pr.author && pr.author.length === 64
          ? pr.author.slice(0, 8) + "..."
          : pr.author || "unknown");
      const commit: any = {
        id: commitId,
        message:
          mergeMessage.trim() ||
          `Merge pull request #${resolvedParams.id} from ${authorName}\n\n${pr.title}`,
        author: currentUserPubkey,
        timestamp: Date.now(),
        branch: pr.baseBranch || "main",
        filesChanged: changedFiles.length,
        insertions: totalInsertions,
        deletions: totalDeletions,
        prId: pr.id,
        changedFiles: changedFiles.map((f) => ({
          path: f.path,
          status: f.status,
        })),
      };

      const commitsKey = getRepoStorageKey(
        "gittr_commits",
        resolvedParams.entity,
        resolvedParams.repo
      );
      const commits = JSON.parse(localStorage.getItem(commitsKey) || "[]");
      commits.unshift(commit);
      localStorage.setItem(commitsKey, JSON.stringify(commits));

      // Dispatch event to refresh commits page
      window.dispatchEvent(
        new CustomEvent("gittr:commit-created", { detail: commit })
      );

      // Record commit activity
      if (currentUserPubkey) {
        try {
          recordActivity({
            type: "commit_created",
            user: currentUserPubkey,
            repo: `${resolvedParams.entity}/${resolvedParams.repo}`,
            entity: resolvedParams.entity,
            repoName: repo?.name || resolvedParams.repo,
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
      const prsKey = getRepoStorageKey(
        "gittr_prs",
        resolvedParams.entity,
        resolvedParams.repo
      );
      const prs = JSON.parse(localStorage.getItem(prsKey) || "[]");
      const prRowIdx = findPullRequestRowIndexByRouteParam(
        prs,
        resolvedParams.id
      );
      const mergeMeta = {
        status: "merged" as const,
        mergedAt: Date.now(),
        mergedBy: currentUserPubkey || "",
        mergeCommit: commitId,
        ...(isGithubStylePrId(pr.id)
          ? { sourcePrStillOpen: true as const }
          : {}),
      };
      let updatedPRs: any[];
      if (prRowIdx >= 0) {
        updatedPRs = [...prs];
        updatedPRs[prRowIdx] = { ...prs[prRowIdx], ...mergeMeta };
      } else {
        updatedPRs = prs.map((p: any) =>
          pr.id != null && p.id === pr.id ? { ...p, ...mergeMeta } : p
        );
      }
      localStorage.setItem(prsKey, JSON.stringify(updatedPRs));
      setPR({
        ...pr,
        ...mergeMeta,
      });
      window.dispatchEvent(new CustomEvent("gittr:pr-updated"));

      // 3a. Create and publish NIP-34 status event (kind 1631: Applied/Merged)
      // Fall back to PR id when it is itself a valid event id.
      const rootEventId = prEventId || (isHexEventId(pr.id) ? pr.id : null);
      let mergeStatusPublished = false;
      let mergeStatusSkippedReason = "";
      if (rootEventId && currentUserPubkey) {
        try {
          const repos = loadStoredRepos();
          const repo = findRepoByEntityAndName<StoredRepo>(
            repos,
            resolvedParams.entity,
            resolvedParams.repo
          );
          const repoOwnerPubkey = repo
            ? getRepoOwnerPubkey(repo, resolvedParams.entity)
            : resolveEntityToPubkey(resolvedParams.entity);

          if (repoOwnerPubkey) {
            const signingCreds = await resolveSigningCredentials({
              remoteSigner,
            });
            if (!signingCreds) {
              console.warn("Cannot publish merge status: no signing method");
            } else {
              const { hasNip07, privateKey } = signingCreds;

              if (privateKey || hasNip07) {
                const ownerPubkeyHex =
                  repoOwnerPubkey.length === 64
                    ? repoOwnerPubkey
                    : resolveEntityToPubkey(resolvedParams.entity) || "";

                if (ownerPubkeyHex) {
                  let statusEvent: any;

                  if (hasNip07 && window.nostr) {
                    const authorPubkey = await window.nostr.getPublicKey();
                    statusEvent = {
                      kind: KIND_STATUS_APPLIED,
                      created_at: Math.floor(Date.now() / 1000),
                      tags: [
                        ["e", rootEventId, "", "root"],
                        ["p", ownerPubkeyHex],
                        ["p", pr.author],
                        ["a", `30617:${ownerPubkeyHex}:${resolvedParams.repo}`],
                        ["k", "1618"],
                        ["merge-commit", commitId],
                        ["r", commitId],
                      ],
                      content: `Merged PR #${pr.id}`,
                      pubkey: authorPubkey,
                      id: "",
                      sig: "",
                    };
                    statusEvent.id = getEventHash(statusEvent);
                    statusEvent = await window.nostr.signEvent(statusEvent);
                  } else if (privateKey) {
                    statusEvent = createStatusEvent(
                      {
                        statusKind: KIND_STATUS_APPLIED,
                        rootEventId,
                        ownerPubkey: ownerPubkeyHex,
                        rootEventAuthor: pr.author,
                        repoName: resolvedParams.repo,
                        rootKind: 1618,
                        mergeCommitId: commitId,
                        content: `Merged PR #${pr.id}`,
                      },
                      privateKey
                    );
                  }

                  if (
                    publish &&
                    defaultRelays &&
                    defaultRelays.length > 0 &&
                    statusEvent
                  ) {
                    publish(statusEvent, defaultRelays);
                    mergeStatusPublished = true;
                    console.log(
                      "✅ Published NIP-34 status event (merged):",
                      statusEvent.id
                    );
                  }
                }
              }
            }
          }
        } catch (error) {
          mergeStatusSkippedReason =
            error instanceof Error ? error.message : String(error);
          console.error("Failed to publish status event:", error);
          // Don't block merge if status event publishing fails
        }
      } else {
        mergeStatusSkippedReason = !rootEventId
          ? "missing PR root event id"
          : "missing current user pubkey";
      }

      // 6. Add PR author to contributors if not already present
      if (pr.author && pr.author.length === 64) {
        try {
          const updatedRepos = loadStoredRepos();
          const repoIndex = updatedRepos.findIndex(
            (r: StoredRepo) =>
              r.entity === resolvedParams.entity &&
              (r.repo === resolvedParams.repo || r.slug === resolvedParams.repo)
          );

          if (repoIndex >= 0) {
            const repo = updatedRepos[repoIndex];
            if (!repo) return;
            const contributors = repo.contributors || [];

            // Check if PR author is already a contributor
            const isContributor = contributors.some(
              (c: StoredContributor) =>
                c.pubkey === pr.author ||
                (c.pubkey && c.pubkey.toLowerCase() === pr.author.toLowerCase())
            );

            // Check if PR author is already an owner
            const isOwner =
              contributors.some(
                (c: StoredContributor) =>
                  c.pubkey === pr.author && c.weight === 100
              ) || repo.ownerPubkey === pr.author;

            if (!isContributor && !isOwner) {
              // Get PR author metadata for name
              const prAuthorMeta = recipientMetadata[pr.author];
              const prAuthorName =
                prAuthorMeta?.display_name ||
                prAuthorMeta?.name ||
                (pr.author && pr.author.length === 64
                  ? pr.author.slice(0, 8) + "..."
                  : pr.author || "unknown");
              const authorNpub =
                pr.author && pr.author.length === 64
                  ? (() => {
                      try {
                        return nip19.npubEncode(pr.author);
                      } catch {
                        return null;
                      }
                    })()
                  : null;

              // Add as contributor (cannot merge, only approve)
              // Role: "contributor" (not "maintainer" or "owner")
              contributors.push({
                pubkey: pr.author,
                name: prAuthorName,
                role: "contributor", // Cannot merge, can only approve
                weight:
                  Math.max(
                    ...contributors
                      .filter((c: any) => c.weight < 100)
                      .map((c: any) => c.weight || 0),
                    0
                  ) + 1 || 1,
              });

              updatedRepos[repoIndex] = {
                ...repo,
                contributors,
              };

              saveStoredRepos(updatedRepos);
              const logAuthorMeta = pr.author
                ? recipientMetadata[pr.author]
                : null;
              const logAuthorName =
                logAuthorMeta?.display_name ||
                logAuthorMeta?.name ||
                (pr.author && pr.author.length === 64
                  ? pr.author.slice(0, 8) + "..."
                  : pr.author || "unknown");
              console.log(`✅ Added PR author ${logAuthorName} as contributor`);
            }
          }
        } catch (error) {
          console.error("Failed to add PR author as contributor:", error);
        }
      }

      // 4. Close linked issue if present
      if (linkedIssue) {
        const issueKey = getRepoStorageKey(
          "gittr_issues",
          resolvedParams.entity,
          resolvedParams.repo
        );
        const issues = JSON.parse(localStorage.getItem(issueKey) || "[]");
        const updatedIssues = issues.map((i: any) =>
          i.id === linkedIssue.id || i.number === linkedIssue.number
            ? {
                ...i,
                status: "closed",
                closedAt: Date.now(),
                closedBy: currentUserPubkey,
              }
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
        if (
          linkedIssue.bountyAmount &&
          (linkedIssue.bountyWithdrawId || linkedIssue.bountyWithdrawUrl)
        ) {
          try {
            // CRITICAL: Ensure we use full pubkey (64 chars), not prefix
            const recipientPubkey =
              pr.author && pr.author.length === 64 ? pr.author : null;
            if (!recipientPubkey) {
              console.error(
                "Bounty release failed: PR author is not a valid full pubkey:",
                pr.author
              );
              alert(
                `Bounty release failed: Invalid recipient pubkey. Expected 64-char pubkey, got: ${
                  pr.author?.length || 0
                } chars`
              );
              return;
            }

            // Store the withdraw link for the PR author (they earned the bounty)
            // This allows them to claim it via the shareable URL
            if (typeof window !== "undefined") {
              const earnedBountiesKey = "gittr_earned_bounties";
              const earnedBounties = JSON.parse(
                localStorage.getItem(earnedBountiesKey) || "[]"
              );

              const bountyEntry = {
                withdrawUrl: linkedIssue.bountyWithdrawUrl,
                withdrawId: linkedIssue.bountyWithdrawId,
                amount: linkedIssue.bountyAmount,
                issueId: String(linkedIssue.id || linkedIssue.number),
                issueTitle: linkedIssue.title,
                repoId: `${resolvedParams.entity}/${resolvedParams.repo}`,
                repoName: resolvedParams.repo,
                from: linkedIssue.bountyCreator || currentUserPubkey, // Bounty creator
                earnedAt: Date.now(),
                status: "released" as const, // Withdraw link released to PR author
              };

              // Check if already exists (don't duplicate) - compare both withdrawId and issueId
              const exists = earnedBounties.some(
                (b: any) =>
                  (b.withdrawId === linkedIssue.bountyWithdrawId &&
                    String(b.issueId) === String(bountyEntry.issueId)) ||
                  (b.issueId === bountyEntry.issueId &&
                    b.repoId === bountyEntry.repoId)
              );

              if (!exists) {
                earnedBounties.push(bountyEntry);
                localStorage.setItem(
                  earnedBountiesKey,
                  JSON.stringify(earnedBounties)
                );
                console.log(
                  "✅ Bounty withdraw link released successfully:",
                  bountyEntry
                );
              } else {
                console.log("⚠️ Bounty already exists, skipping duplicate");
              }
            }

            // Update issue bounty status to "released"
            const issueKey = getRepoStorageKey(
              "gittr_issues",
              resolvedParams.entity,
              resolvedParams.repo
            );
            const issues = JSON.parse(localStorage.getItem(issueKey) || "[]");
            const updatedIssues = issues.map((i: any) =>
              i.id === linkedIssue.id || i.number === linkedIssue.number
                ? { ...i, bountyStatus: "released" as const }
                : i
            );
            localStorage.setItem(issueKey, JSON.stringify(updatedIssues));

            console.log(
              "Bounty withdraw link released - PR author can claim via:",
              linkedIssue.bountyWithdrawUrl
            );

            // Send notification to PR author about bounty being released
            try {
              if (recipientPubkey) {
                const notification = formatNotificationMessage(
                  "bounty_released",
                  {
                    repoEntity: resolvedParams.entity,
                    repoName: resolvedParams.repo,
                    issueId: String(linkedIssue.id || linkedIssue.number),
                    issueTitle: linkedIssue.title,
                    url:
                      typeof window !== "undefined"
                        ? `${window.location.origin}/${resolvedParams.entity}/${
                            resolvedParams.repo
                          }/issues/${linkedIssue.id || linkedIssue.number}`
                        : undefined,
                  }
                );

                await sendNotification({
                  eventType: "bounty_released",
                  title: notification.title,
                  message: `${notification.message}\n\nAmount: ${linkedIssue.bountyAmount} sats\n\nYou can claim the bounty using the withdraw link.`,
                  url: notification.url,
                  repoEntity: resolvedParams.entity,
                  repoName: resolvedParams.repo,
                  recipientPubkey: recipientPubkey,
                });
              }
            } catch (error) {
              console.error(
                "Failed to send bounty_released notification:",
                error
              );
              // Don't block merge if notification fails
            }

            // Publish bounty status update to Nostr (released)
            try {
              const signingCreds = await resolveSigningCredentials({
                remoteSigner,
              });
              if (!signingCreds) {
                console.warn("Cannot publish bounty update: no signing method");
              } else {
                const { hasNip07, privateKey } = signingCreds;

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
                        ["repo", resolvedParams.entity, resolvedParams.repo],
                        ["status", "released"],
                        [
                          "p",
                          linkedIssue.bountyCreator || authorPubkey,
                          "creator",
                        ],
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
                    bountyEvent = createBountyEvent(
                      {
                        issueId: linkedIssue.id,
                        repoEntity: resolvedParams.entity,
                        repoName: resolvedParams.repo,
                        amount: linkedIssue.bountyAmount || 0,
                        status: "released",
                        withdrawId: linkedIssue.bountyWithdrawId,
                        lnurl: linkedIssue.bountyLnurl,
                        withdrawUrl: linkedIssue.bountyWithdrawUrl,
                        creator: linkedIssue.bountyCreator || currentUserPubkey,
                        createdAt: Date.now(),
                        releasedAt: Date.now(),
                        claimedBy: recipientPubkey,
                      },
                      privateKey
                    );
                  }

                  if (
                    publish &&
                    defaultRelays &&
                    defaultRelays.length > 0 &&
                    bountyEvent
                  ) {
                    try {
                      publish(bountyEvent, defaultRelays);
                      console.log(
                        "Published bounty release event to Nostr:",
                        bountyEvent.id
                      );
                    } catch (error) {
                      console.error(
                        "Failed to publish bounty release to Nostr:",
                        error
                      );
                    }
                  }
                }
              }
            } catch (error) {
              console.error("Failed to publish bounty release event:", error);
              // Don't block merge if publishing fails
            }
          } catch (error: any) {
            console.error("Failed to release bounty:", error);
            alert(
              `Failed to release bounty: ${error.message || "Unknown error"}`
            );
          }
        }
      }

      setMerging(false);
      setShowMergeModal(false);

      // Record PR merge activity (PR author gets credit)
      if (pr.author) {
        try {
          recordActivity({
            type: "pr_merged",
            user: pr.author, // PR author gets credit for merge
            repo: `${resolvedParams.entity}/${resolvedParams.repo}`,
            entity: resolvedParams.entity,
            repoName: repo?.name || resolvedParams.repo,
            metadata: {
              prId: pr.id,
              commitId: commitId,
              mergedBy: currentUserPubkey || "",
            },
          });

          // Send notification to PR author about merge
          try {
            const notification = formatNotificationMessage("pr_merged", {
              repoEntity: resolvedParams.entity,
              repoName: resolvedParams.repo,
              prId: pr.id,
              prTitle: pr.title,
              url:
                typeof window !== "undefined"
                  ? `${window.location.origin}/${resolvedParams.entity}/${resolvedParams.repo}/pulls/${pr.id}`
                  : undefined,
            });

            await sendNotification({
              eventType: "pr_merged",
              title: notification.title,
              message: notification.message,
              url: notification.url,
              repoEntity: resolvedParams.entity,
              repoName: resolvedParams.repo,
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
            repo: `${resolvedParams.entity}/${resolvedParams.repo}`,
            entity: resolvedParams.entity,
            repoName: repo?.name || resolvedParams.repo,
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

      // 7. Push updated repository state so other clients can immediately
      // reconstruct the post-merge codebase without relying on local-only data.
      let repoStatePushed = false;
      let repoStatePushError = "";
      /** If true, we opened the push-invoice modal — must not router.refresh() yet or the page remount wipes modal state. */
      let deferRefreshForMergePushInvoice = false;
      /** Show one explicit transition message so users expect follow-up signature prompts. */
      let notifiedMergeRepushStart = false;
      if (
        publish &&
        subscribe &&
        defaultRelays?.length > 0 &&
        currentUserPubkey
      ) {
        try {
          const resolvedOwnerPubkey =
            (repo ? getRepoOwnerPubkey(repo, resolvedParams.entity) : null) ||
            resolveEntityToPubkey(resolvedParams.entity) ||
            "";
          if (!resolvedOwnerPubkey) {
            repoStatePushError =
              "missing owner pubkey for push payment authorization";
          } else {
            const paymentAuth = await ensurePushPaymentAuthorization({
              entity: resolvedParams.entity,
              repo: resolvedParams.repo,
              ownerPubkey: resolvedOwnerPubkey.toLowerCase(),
              payerPubkey: currentUserPubkey,
              signer:
                typeof window !== "undefined" && window.nostr
                  ? window.nostr.signEvent
                  : undefined,
            });

            if (!paymentAuth.ok) {
              repoStatePushError =
                paymentAuth.error || "payment authorization failed";
              if (
                paymentAuth.needsExternalPayment &&
                paymentAuth.invoice &&
                paymentAuth.pushCostSats
              ) {
                deferRefreshForMergePushInvoice = true;
                setMergePushPayment({
                  invoice: paymentAuth.invoice,
                  pushCostSats: paymentAuth.pushCostSats,
                  ownerPubkey: resolvedOwnerPubkey.toLowerCase(),
                  repoName: resolvedParams.repo,
                  ownerLnbitsUrl: paymentAuth.ownerLnbitsUrl,
                  ownerLnbitsReadKey: paymentAuth.ownerLnbitsReadKey,
                  ownerBlinkApiKey: paymentAuth.ownerBlinkApiKey,
                });
                repoStatePushError =
                  "push payment required - invoice opened for authorization";
              }
            } else {
              if (!notifiedMergeRepushStart) {
                notifiedMergeRepushStart = true;
                alert(
                  "Pull request merged.\n\nNext step: pushing merged repo state to Nostr now.\nPlease stay on this page and complete all signature prompts."
                );
              }
              const pushResult = await pushRepoToNostr({
                repoSlug: resolvedParams.repo,
                entity: resolvedParams.entity,
                publish,
                subscribe,
                defaultRelays,
                privateKey: privateKey || undefined,
                pubkey: currentUserPubkey,
                onProgress: (message) => {
                  console.log(`[Merge Push ${resolvedParams.repo}] ${message}`);
                },
              });
              repoStatePushed = !!pushResult.success;
              if (!pushResult.success) {
                repoStatePushError = pushResult.error || "unknown push failure";
              } else {
                // Code tab README/tree read bridge first; merged bytes also live in overrides.
                // Re-notify repo page so files + override state reload after Nostr push completes.
                window.dispatchEvent(new Event("gittr:repo-updated"));
              }
            }
          }
        } catch (pushError) {
          repoStatePushError =
            pushError instanceof Error ? pushError.message : String(pushError);
          console.error(
            "Failed to push merged repo state to Nostr:",
            pushError
          );
        }
      } else {
        repoStatePushError =
          "missing publish context, relays, or signer identity";
      }

      // Dispatch event to update counts
      window.dispatchEvent(new CustomEvent("gittr:pr-updated"));
      window.dispatchEvent(
        new CustomEvent("gittr:activity-recorded", {
          detail: { type: "pr_merged" },
        })
      );

      if (!deferRefreshForMergePushInvoice) {
        router.refresh();
      }
      if (deferRefreshForMergePushInvoice) {
        // Invoice modal is shown; avoid refresh/alerts that hide it or imply push finished.
        console.log(
          "[Merge] Push paywall: invoice modal open — refresh deferred until payment completes or modal closes."
        );
      } else if (mergeStatusPublished && repoStatePushed) {
        alert(
          "Pull request merged and repush to Nostr completed successfully (including required signatures)."
        );
      } else if (!mergeStatusPublished && repoStatePushed) {
        alert(
          `Pull request merged and repository repush completed, but merge status event was not published (${
            mergeStatusSkippedReason || "unknown reason"
          }).`
        );
      } else if (mergeStatusPublished && !repoStatePushed) {
        alert(
          `Pull request merged and merge status was published, but repository repush did not complete (${
            repoStatePushError || "unknown push failure"
          }). Please run Push to Nostr for this repo.`
        );
      } else {
        alert(
          `Pull request merged locally, but Nostr sync is incomplete (status: ${
            mergeStatusSkippedReason || "not published"
          }, repo push: ${
            repoStatePushError || "not completed"
          }). Please run Push to Nostr for this repo.`
        );
      }
    } catch (error) {
      setMerging(false);
      console.error("Failed to merge PR:", error);
      alert("Failed to merge PR: " + (error as Error).message);
    }
  }, [
    pr,
    isOwner,
    merging,
    mergeMessage,
    params,
    currentUserPubkey,
    linkedIssue,
    recipientMetadata,
    router,
    requiredApprovals,
  ]);

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
  const handleConflictResolve = useCallback(
    async (
      resolvedConflicts: any[],
      resolutions: Record<string, "pr" | "base" | string>
    ) => {
      setShowConflictModal(false);

      try {
        const changedFiles: ChangedFile[] = pr?.changedFiles || [];

        // Apply resolved conflicts to PR's changedFiles.
        // Align `before` with the tip that was current when the conflict was
        // detected so a retry does not re-flag the same edit-edit conflict.
        const updatedChangedFiles = changedFiles.map((file) => {
          const conflict = resolvedConflicts.find((c) => c.path === file.path);
          if (!conflict) return file;

          const resolution = resolutions[conflict.path];
          const baseTip =
            conflict.baseContent !== undefined ? conflict.baseContent : "";
          if (
            typeof resolution === "string" &&
            resolution !== "pr" &&
            resolution !== "base"
          ) {
            return { ...file, before: baseTip, after: resolution };
          } else if (resolution === "pr") {
            return { ...file, before: baseTip }; // Keep PR after; tip matches before
          } else if (resolution === "base") {
            return { ...file, before: baseTip, after: baseTip };
          }
          return file;
        });

        // Update PR with resolved conflicts in localStorage + React state
        if (pr) {
          const prsKey = getRepoStorageKey(
            "gittr_prs",
            resolvedParams.entity,
            resolvedParams.repo
          );
          const prs = JSON.parse(localStorage.getItem(prsKey) || "[]");
          const updatedPRs = prs.map((p: any) =>
            p.id === pr.id ? { ...p, changedFiles: updatedChangedFiles } : p
          );
          localStorage.setItem(prsKey, JSON.stringify(updatedPRs));

          const updatedPR = { ...pr, changedFiles: updatedChangedFiles };
          setPR(updatedPR);
        }

        // Do NOT write overrides yet — handleMerge applies them on success.
        // Hand the resolved files to merge and skip a second conflict pass.
        mergeFilesOverrideRef.current = updatedChangedFiles;
        skipConflictCheckRef.current = true;
        setMerging(false);
        setTimeout(() => {
          void handleMerge();
        }, 50);
      } catch (error) {
        console.error("Failed to resolve conflicts:", error);
        skipConflictCheckRef.current = false;
        mergeFilesOverrideRef.current = null;
        setMerging(false);
        alert("Failed to resolve conflicts: " + (error as Error).message);
      }
    },
    [pr, handleMerge, resolvedParams.entity, resolvedParams.repo]
  );

  const canCloseOrReopenPr = Boolean(
    pr &&
      currentUserPubkey &&
      (canMerge ||
        (pr.author &&
          pr.author.toLowerCase() === currentUserPubkey.toLowerCase()))
  );

  /** Close without merging (or reopen). Does not apply file changes. */
  const handleCloseOrReopenPr = useCallback(async () => {
    if (!pr || !currentUserPubkey || !canCloseOrReopenPr) return;
    if (pr.status === "merged") {
      alert("Merged pull requests cannot be reopened here.");
      return;
    }

    const closing = pr.status === "open";
    const newStatus: "open" | "closed" = closing ? "closed" : "open";
    if (
      closing &&
      !confirm(
        "Close this pull request without merging?\n\nFile changes will not be applied. Only the PR status is updated on Nostr — no Push to Nostr / repo tip push is required."
      )
    ) {
      return;
    }

    try {
      const prsKey = getRepoStorageKey(
        "gittr_prs",
        resolvedParams.entity,
        resolvedParams.repo
      );
      const prs = JSON.parse(localStorage.getItem(prsKey) || "[]");
      const rowIdx = findPullRequestRowIndexByRouteParam(
        prs,
        resolvedParams.id
      );
      const statusMeta =
        newStatus === "closed"
          ? {
              status: "closed" as const,
              closedAt: Date.now(),
              closedBy: currentUserPubkey,
            }
          : {
              status: "open" as const,
              closedAt: undefined,
              closedBy: undefined,
            };

      let updatedPRs = prs;
      if (rowIdx >= 0) {
        updatedPRs = prs.map((p: any, i: number) =>
          i === rowIdx ? { ...p, ...statusMeta } : p
        );
      } else {
        updatedPRs = prs.map((p: any) =>
          pr.id != null && p.id === pr.id ? { ...p, ...statusMeta } : p
        );
      }
      localStorage.setItem(prsKey, JSON.stringify(updatedPRs));
      setPR({ ...pr, ...statusMeta });
      window.dispatchEvent(new CustomEvent("gittr:pr-updated"));

      // Publish NIP-34 status (1632 closed / 1630 open) when we have a root event id
      const rootEventId = prEventId || (isHexEventId(pr.id) ? pr.id : null);
      if (rootEventId && publish && defaultRelays?.length) {
        try {
          const repos = loadStoredRepos();
          const repo = findRepoByEntityAndName<StoredRepo>(
            repos,
            resolvedParams.entity,
            resolvedParams.repo
          );
          const ownerPubkeyHex =
            (repo ? getRepoOwnerPubkey(repo, resolvedParams.entity) : null) ||
            resolveEntityToPubkey(resolvedParams.entity) ||
            "";
          const signingCreds = await resolveSigningCredentials({
            remoteSigner,
          });
          if (ownerPubkeyHex && signingCreds) {
            const { hasNip07, privateKey } = signingCreds;
            const statusKind = closing ? KIND_STATUS_CLOSED : KIND_STATUS_OPEN;
            let statusEvent: any;
            if (hasNip07 && window.nostr) {
              const authorPubkey = await window.nostr.getPublicKey();
              statusEvent = {
                kind: statusKind,
                created_at: Math.floor(Date.now() / 1000),
                tags: [
                  ["e", rootEventId, "", "root"],
                  ["p", ownerPubkeyHex],
                  ["p", pr.author],
                  ["a", `30617:${ownerPubkeyHex}:${resolvedParams.repo}`],
                  ["k", "1618"],
                ],
                content: closing
                  ? `Closed PR #${pr.id} without merging`
                  : `Reopened PR #${pr.id}`,
                pubkey: authorPubkey,
                id: "",
                sig: "",
              };
              statusEvent.id = getEventHash(statusEvent);
              statusEvent = await window.nostr.signEvent(statusEvent);
            } else if (privateKey) {
              statusEvent = createStatusEvent(
                {
                  statusKind,
                  rootEventId,
                  ownerPubkey: ownerPubkeyHex,
                  rootEventAuthor: pr.author,
                  repoName: resolvedParams.repo,
                  rootKind: 1618,
                  content: closing
                    ? `Closed PR #${pr.id} without merging`
                    : `Reopened PR #${pr.id}`,
                },
                privateKey
              );
            }
            if (statusEvent) {
              publish(statusEvent, defaultRelays);
              console.log(
                `✅ Published NIP-34 status event (${
                  closing ? "closed" : "open"
                }):`,
                statusEvent.id
              );
            }
          }
        } catch (statusErr) {
          console.warn(
            "Failed to publish PR close/reopen status to Nostr:",
            statusErr
          );
        }
      }
    } catch (error) {
      console.error("Failed to update PR status:", error);
      alert("Failed to update pull request: " + (error as Error).message);
    }
  }, [
    pr,
    currentUserPubkey,
    canCloseOrReopenPr,
    prEventId,
    publish,
    defaultRelays,
    remoteSigner,
    resolvedParams.entity,
    resolvedParams.repo,
    resolvedParams.id,
  ]);

  const handleAddPrComment = useCallback(async () => {
    if (!commentContent.trim() || !pr || !currentUserPubkey || !prEventId) {
      return;
    }
    setPostingComment(true);
    try {
      const signingCreds = await resolveSigningCredentials({ remoteSigner });
      if (!signingCreds) {
        alert(NO_SIGNING_METHOD_MESSAGE);
        return;
      }
      const { hasNip07, privateKey } = signingCreds;
      const draft: Nip22Comment = {
        id: `local-${Date.now()}`,
        author: currentUserPubkey,
        content: commentContent.trim(),
        createdAt: Date.now(),
        nostrEventId: "",
      };
      const unsigned = buildUnsignedCommentEvent(
        {
          content: draft.content,
          prId: prEventId,
          rootKind: KIND_PULL_REQUEST,
          rootPubkey: isHexEventId(pr.author) ? pr.author : undefined,
          repoEntity: resolvedParams.entity,
          repoName: resolvedParams.repo,
        },
        currentUserPubkey
      );
      let signed = unsigned;
      if (hasNip07 && typeof window !== "undefined" && window.nostr) {
        unsigned.id = getEventHash(unsigned);
        signed = await window.nostr.signEvent(unsigned);
      } else if (privateKey) {
        signed = createCommentEvent(
          {
            content: draft.content,
            prId: prEventId,
            rootKind: KIND_PULL_REQUEST,
            rootPubkey: isHexEventId(pr.author) ? pr.author : undefined,
            repoEntity: resolvedParams.entity,
            repoName: resolvedParams.repo,
          },
          privateKey
        );
      } else {
        alert(NO_SIGNING_METHOD_MESSAGE);
        return;
      }
      if (publish && defaultRelays?.length) {
        publish(signed, defaultRelays);
      }
      const saved: Nip22Comment = {
        ...draft,
        id: signed.id || draft.id,
        nostrEventId: signed.id || draft.id,
      };
      setComments((prev) => {
        const next = [...prev, saved].sort((a, b) => a.createdAt - b.createdAt);
        persistPrComments(
          resolvedParams.entity,
          resolvedParams.repo,
          prEventId,
          next
        );
        return next;
      });
      setCommentContent("");
    } catch (err) {
      console.error("Failed to publish PR comment:", err);
      alert("Could not publish the comment: " + (err as Error).message);
    } finally {
      setPostingComment(false);
    }
  }, [
    commentContent,
    pr,
    currentUserPubkey,
    prEventId,
    remoteSigner,
    publish,
    defaultRelays,
    resolvedParams.entity,
    resolvedParams.repo,
  ]);

  if (loading) {
    return <div className="p-6">Loading PR...</div>;
  }

  if (!pr) {
    return <div className="p-6">Pull request not found</div>;
  }

  return (
    <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
      {pr.sourcePrStillOpen ? (
        <div
          className="mb-4 rounded-md border border-amber-600/50 bg-amber-950/40 px-4 py-3 text-sm text-amber-100/95"
          role="status"
        >
          This PR is merged in gittr, but the upstream copy (for example on
          GitHub) may still be open. Refetch updates lists from the source; push
          your branch and merge or close the PR there when you want the source
          to match.
        </div>
      ) : null}
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
            <Badge className="bg-gray-700">#{resolvedParams.id}</Badge>
            {pr.status === "merged" && (
              <Badge className="bg-purple-600">Merged</Badge>
            )}
            {pr.status === "closed" && (
              <Badge className="bg-gray-600">Closed</Badge>
            )}
          </div>
          <div className="text-sm text-gray-400">
            {pr.status === "merged" && pr.mergedAt
              ? `Merged ${formatDateTime24h(pr.mergedAt)}`
              : `${
                  pr.status === "open" ? "Opened" : "Closed"
                } ${formatDateTime24h(pr.createdAt)}`}{" "}
            by{" "}
            <Link
              href={`/${
                pr.status === "merged" && pr.mergedBy ? pr.mergedBy : pr.author
              }`}
              className="hover:text-purple-400 flex items-center gap-1 group"
              title={(() => {
                const pubkey =
                  pr.status === "merged" && pr.mergedBy
                    ? pr.mergedBy
                    : pr.author;
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
                const pubkey =
                  pr.status === "merged" && pr.mergedBy
                    ? pr.mergedBy
                    : pr.author;
                const meta = recipientMetadata[pubkey];
                return (
                  meta?.display_name || meta?.name || pubkey.slice(0, 8) + "..."
                );
              })()}
            </Link>
          </div>
        </div>
        <div className="ml-4 flex flex-col gap-2 shrink-0 max-w-xs sm:max-w-sm">
          <div className="flex flex-col sm:flex-row gap-2">
            {canMerge && pr.status === "open" && (
              <Button
                variant="default"
                onClick={async () => {
                  setShowMergeModal(true);
                  await checkMergePublishPreflight();
                  // Check wallet balance if there's a bounty
                  if (
                    linkedIssue?.bountyAmount &&
                    (linkedIssue?.bountyWithdrawId ||
                      linkedIssue?.bountyWithdrawUrl)
                  ) {
                    await checkWalletBalance();
                  }
                }}
                className="bg-green-600 hover:bg-green-700"
              >
                <GitMerge className="mr-2 h-4 w-4" />
                Merge pull request
              </Button>
            )}
            {canCloseOrReopenPr && pr.status === "open" && (
              <Button
                variant="outline"
                onClick={() => void handleCloseOrReopenPr()}
              >
                <X className="mr-2 h-4 w-4" />
                Close pull request
              </Button>
            )}
            {canCloseOrReopenPr && pr.status === "closed" && (
              <Button
                variant="outline"
                onClick={() => void handleCloseOrReopenPr()}
              >
                Reopen pull request
              </Button>
            )}
          </div>
          {pr.status === "open" && (canMerge || canCloseOrReopenPr) && (
            <div className="text-xs text-gray-400 space-y-1.5 leading-relaxed">
              {canMerge && (
                <p>
                  <span className="text-gray-300 font-medium">Merge</span>{" "}
                  applies the PR files and pushes the updated tip to Nostr / the
                  bridge. Other clients see it after that — you do{" "}
                  <strong className="text-gray-300 font-medium">not</strong>{" "}
                  need a separate Code-tab{" "}
                  <strong className="text-gray-300 font-medium">
                    Push to Nostr
                  </strong>
                  .
                </p>
              )}
              {canCloseOrReopenPr && (
                <p>
                  <span className="text-gray-300 font-medium">Close</span>{" "}
                  publishes a closed status event to Nostr (so other git clients
                  stop showing it as open). It does{" "}
                  <strong className="text-gray-300 font-medium">not</strong>{" "}
                  change files and does{" "}
                  <strong className="text-gray-300 font-medium">not</strong>{" "}
                  need a Code-tab{" "}
                  <strong className="text-gray-300 font-medium">
                    Push to Nostr
                  </strong>{" "}
                  (that button is for repo files / tip, not PR status).
                </p>
              )}
            </div>
          )}
          {pr.status === "closed" && canCloseOrReopenPr && (
            <p className="text-xs text-gray-400 leading-relaxed">
              Reopen publishes open status to Nostr. Still no file changes and
              no Code-tab Push to Nostr.
            </p>
          )}
        </div>
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
              <div
                className={`p-3 rounded border text-sm ${
                  mergePublishReady
                    ? "bg-emerald-900/20 border-emerald-600 text-emerald-200"
                    : "bg-amber-900/20 border-amber-600 text-amber-200"
                }`}
              >
                {mergePublishReady
                  ? `Will sign and publish merge status to Nostr (${mergePublishReason}). Merge also pushes the repo tip so others see the files — no separate Push to Nostr needed afterward.`
                  : `Local-only merge risk: ${mergePublishReason}. If publish is unavailable, file changes may stay local until you Push to Nostr on the Code tab.`}
              </div>

              {/* Bounty Warning - Prominent */}
              {linkedIssue?.bountyAmount &&
                (linkedIssue?.bountyWithdrawId ||
                  linkedIssue?.bountyWithdrawUrl) &&
                (() => {
                  const authorMeta = pr.author
                    ? recipientMetadata[pr.author]
                    : null;
                  const authorName =
                    authorMeta?.display_name ||
                    authorMeta?.name ||
                    (pr.author && pr.author.length === 64
                      ? pr.author.slice(0, 8) + "..."
                      : pr.author || "unknown");
                  const authorLightningAddress =
                    authorMeta?.lud16 || authorMeta?.lnurl || null;

                  // Get bounty creator metadata
                  const bountyCreatorMeta = linkedIssue?.bountyCreator
                    ? recipientMetadata[linkedIssue.bountyCreator]
                    : null;
                  const bountyCreatorName =
                    bountyCreatorMeta?.display_name ||
                    bountyCreatorMeta?.name ||
                    (linkedIssue?.bountyCreator &&
                    linkedIssue.bountyCreator.length === 64
                      ? linkedIssue.bountyCreator.slice(0, 8) + "..."
                      : linkedIssue?.bountyCreator || "unknown");

                  return (
                    <div className="p-4 bg-yellow-900/30 border-2 border-yellow-600 rounded-lg">
                      <div className="flex items-start gap-2">
                        <div className="text-yellow-400 text-xl">💰</div>
                        <div className="flex-1">
                          <p className="font-semibold text-yellow-200 mb-2">
                            Bounty Payment on Merge
                          </p>
                          <div className="space-y-2 text-sm">
                            <div className="bg-yellow-900/20 border border-yellow-600/50 rounded p-2">
                              <p className="text-yellow-200 font-medium mb-1">
                                Amount:
                              </p>
                              <p className="text-yellow-100 text-lg font-bold">
                                {linkedIssue.bountyAmount} sats
                              </p>
                            </div>
                            <div className="bg-yellow-900/20 border border-yellow-600/50 rounded p-2">
                              <p className="text-yellow-200 font-medium mb-1">
                                Paying to:
                              </p>
                              <p className="text-yellow-100">{authorName}</p>
                              {authorLightningAddress ? (
                                <p className="text-yellow-300 text-xs mt-1 font-mono break-all">
                                  {authorLightningAddress}
                                </p>
                              ) : (
                                <p className="text-yellow-400 text-xs mt-1 italic">
                                  ⚠️ Lightning address not found in PR author's
                                  Nostr profile
                                </p>
                              )}
                            </div>
                            {linkedIssue?.bountyCreator && (
                              <div className="bg-yellow-900/20 border border-yellow-600/50 rounded p-2">
                                <p className="text-yellow-200 font-medium mb-1">
                                  Bounty created by:
                                </p>
                                <p className="text-yellow-100">
                                  {bountyCreatorName}
                                </p>
                              </div>
                            )}
                            <p className="text-yellow-300 text-xs mt-2">
                              When you merge this PR, the withdraw link will be
                              released to the PR author. They can claim the
                              bounty using the withdraw link. The funds are
                              already reserved in the bounty creator's LNbits
                              wallet and will be deducted when the PR author
                              claims the withdraw link.
                            </p>
                            <p className="text-yellow-300 text-xs mt-1">
                              <Link
                                href="/help#bounties"
                                className="text-yellow-400 hover:text-yellow-300 underline"
                                target="_blank"
                              >
                                Learn more about bounties →
                              </Link>
                            </p>
                            <p className="text-yellow-400 text-xs mt-2">
                              ⚠️ Make sure this PR actually fixes issue #
                              {linkedIssue.number || linkedIssue.id} before
                              merging.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

              <div>
                <label className="block text-sm font-medium mb-2">
                  Merge commit message
                </label>
                <textarea
                  className="w-full border border-gray-600 bg-gray-800 text-white rounded p-2 h-24"
                  value={mergeMessage}
                  onChange={(e) => setMergeMessage(e.target.value)}
                  placeholder={`Merge pull request #${
                    resolvedParams.id
                  } from ${(() => {
                    const authorMeta = pr?.author
                      ? recipientMetadata[pr.author]
                      : null;
                    return (
                      authorMeta?.display_name ||
                      authorMeta?.name ||
                      (pr?.author && pr.author.length === 64
                        ? pr.author.slice(0, 8) + "..."
                        : pr?.author || "unknown")
                    );
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
                  className={`flex-1 ${
                    linkedIssue?.bountyAmount &&
                    (linkedIssue?.bountyWithdrawId ||
                      linkedIssue?.bountyWithdrawUrl)
                      ? "bg-yellow-600 hover:bg-yellow-700 text-white border-yellow-500"
                      : "bg-green-600 hover:bg-green-700 text-white border-green-500"
                  }`}
                >
                  {merging
                    ? "Merging..."
                    : linkedIssue?.bountyAmount &&
                      (linkedIssue?.bountyWithdrawId ||
                        linkedIssue?.bountyWithdrawUrl)
                    ? "Merge & Release Bounty Link"
                    : "Confirm merge"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      {mergePushPayment && (
        <PaymentQR
          invoice={mergePushPayment.invoice}
          amount={mergePushPayment.pushCostSats}
          onClose={() => {
            setMergePushPayment(null);
            router.refresh();
          }}
          onPaid={pushMergedRepoAfterPayment}
          pushPaymentPoll={{
            ownerPubkey: mergePushPayment.ownerPubkey,
            repo: mergePushPayment.repoName,
            payerPubkey: currentUserPubkey || "",
            ownerLnbitsUrl: mergePushPayment.ownerLnbitsUrl,
            ownerLnbitsReadKey: mergePushPayment.ownerLnbitsReadKey,
            ownerBlinkApiKey: mergePushPayment.ownerBlinkApiKey,
          }}
          extra={
            <p className="text-xs text-gray-400 mb-3">
              This repository has push paywall enabled. Pay once to authorize
              this merged-state push.
            </p>
          }
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="md:col-span-2 space-y-4">
          {/* Description */}
          <div className="border border-gray-700 rounded p-4">
            <div className="prose prose-invert max-w-none mb-4">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={markdownRehypePlugins}
                components={{
                  code: MarkdownCode,
                }}
              >
                {pr.body ||
                  (hasChanges
                    ? "No description — file changes are below."
                    : "No description provided")}
              </ReactMarkdown>
              {/* Render snippets referenced in PR description */}
              {(() => {
                if (!pr.body) return null;
                // Extract snippet event IDs from PR body
                const snippetIdPattern =
                  /(?:nostr:)?(note1[a-z0-9]{58}|[0-9a-f]{64})/gi;
                const matches = pr.body.matchAll(snippetIdPattern);
                const snippetIds: string[] = [];
                for (const match of matches) {
                  const id = match[1];
                  if (!id) continue; // Skip if no match
                  if (id.startsWith("note1")) {
                    try {
                      const decoded = nip19.decode(id);
                      if (decoded.type === "note") {
                        snippetIds.push(decoded.data as string);
                      }
                    } catch {
                      // Invalid bech32, skip
                    }
                  } else if (/^[0-9a-f]{64}$/i.test(id)) {
                    snippetIds.push(id);
                  }
                }

                return snippetIds.map((snippetId) => {
                  const snippetEvent = snippetEvents.get(snippetId);
                  if (!snippetEvent) return null;
                  return (
                    <div key={snippetId} className="mt-4">
                      <CodeSnippetRenderer
                        event={snippetEvent}
                        showAuthor={false}
                      />
                    </div>
                  );
                });
              })()}
            </div>
            <div className="mt-4 pt-4 border-t border-gray-700">
              <Reactions
                targetId={pr.id}
                targetType="pr"
                entity={resolvedParams.entity}
                repo={resolvedParams.repo}
              />
            </div>
          </div>

          <div className="border border-gray-700 rounded p-4">
            <h3 className="font-semibold mb-4">
              {comments.length} {comments.length === 1 ? "Comment" : "Comments"}
            </h3>
            <div className="space-y-4 mb-6">
              {comments.length === 0 ? (
                <div className="text-center py-6 text-gray-500 text-sm">
                  No comments yet on this pull request.
                </div>
              ) : (
                comments.map((comment) => {
                  const authorMeta = recipientMetadata[comment.author];
                  const authorLabel =
                    authorMeta?.display_name ||
                    authorMeta?.name ||
                    comment.author.slice(0, 8) + "...";
                  return (
                    <div
                      key={comment.id}
                      className="border border-gray-700 rounded p-4 bg-gray-900/50"
                    >
                      <div className="flex items-start gap-3">
                        <Avatar className="h-8 w-8 flex-shrink-0">
                          {authorMeta?.picture &&
                          authorMeta.picture.startsWith("http") ? (
                            <AvatarImage src={authorMeta.picture} />
                          ) : null}
                          <AvatarFallback className="bg-gray-700 text-white text-xs">
                            {authorLabel.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <Link
                              href={`/${comment.author}`}
                              className="font-semibold hover:text-purple-400"
                            >
                              {authorLabel}
                            </Link>
                            <span className="text-xs text-gray-500">
                              {formatDateTime24h(comment.createdAt)}
                            </span>
                          </div>
                          <div className="prose prose-invert prose-sm max-w-none">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              rehypePlugins={markdownRehypePlugins}
                            >
                              {comment.content}
                            </ReactMarkdown>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            {currentUserPubkey ? (
              <div className="border border-gray-700 rounded p-4 bg-gray-900/50">
                <Textarea
                  value={commentContent}
                  onChange={(e) => setCommentContent(e.target.value)}
                  placeholder="Write a comment…"
                  className="min-h-24 mb-3"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      void handleAddPrComment();
                    }
                  }}
                />
                <Button
                  onClick={() => void handleAddPrComment()}
                  disabled={
                    !commentContent.trim() || postingComment || !prEventId
                  }
                >
                  {postingComment ? "Posting…" : "Post Comment"}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                Sign in to comment on this pull request.
              </p>
            )}
          </div>

          {/* File Changes */}
          <div className="space-y-4">
            <div className="border border-gray-700 rounded p-4">
              <h3 className="font-semibold mb-3">
                {loadingRemoteDiffs && !hasChanges
                  ? "Loading file changes…"
                  : `Changes (${changedFiles.length} file${
                      changedFiles.length !== 1 ? "s" : ""
                    })`}
              </h3>
              {loadingRemoteDiffs && !hasChanges && (
                <p className="text-sm text-gray-400">
                  Fetching the diff from git (the PR’s clone and commit tags),
                  or from GitHub when this row is a forge import.
                </p>
              )}
              {remoteDiffError && !hasChanges && (
                <p className="text-sm text-amber-400/90">{remoteDiffError}</p>
              )}
              {!loadingRemoteDiffs && !hasChanges && !remoteDiffError && (
                <p className="text-sm text-gray-400">
                  No file changes listed for this pull request yet.
                </p>
              )}
              {hasChanges &&
                changedFiles.some(
                  (f) => f.diffPreview || prDiffLooksLikeUnifiedPatch(f.after)
                ) && (
                  <p className="text-xs text-gray-500 mb-3">
                    Patch preview from GitHub’s files API.
                  </p>
                )}
              {hasChanges &&
                changedFiles.map((file, idx) => {
                  const handleOwnerEdit = (newContent: string) => {
                    const key = getRepoStorageKey(
                      "gittr_prs",
                      resolvedParams.entity,
                      resolvedParams.repo
                    );
                    const prs = JSON.parse(localStorage.getItem(key) || "[]");
                    const updatedPRs = prs.map((p: any) => {
                      if (p.id === pr.id) {
                        const updatedChangedFiles = (p.changedFiles || []).map(
                          (f: any) => {
                            if (f.path === file.path) {
                              return {
                                ...f,
                                after: newContent,
                                ownerEdited: true,
                              };
                            }
                            return f;
                          }
                        );
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
                        ownerEdit={
                          isOwner &&
                          pr.status === "open" &&
                          !file.diffPreview &&
                          !prDiffLooksLikeUnifiedPatch(file.after)
                        }
                        onEdit={handleOwnerEdit}
                      />
                    </div>
                  );
                })}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Review Section */}
          {pr.status === "open" && (
            <PRReviewSection
              prId={pr.id}
              entity={resolvedParams.entity}
              repo={resolvedParams.repo}
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
                  const displayName =
                    meta?.display_name ||
                    meta?.name ||
                    pubkey.slice(0, 8) + "...";
                  const npub =
                    pubkey && pubkey.length === 64
                      ? (() => {
                          try {
                            return nip19.npubEncode(pubkey);
                          } catch {
                            return null;
                          }
                        })()
                      : null;
                  // Build tooltip with name, npub, and full pubkey for verification
                  const tooltipParts = [displayName];
                  if (npub) {
                    tooltipParts.push(`npub: ${npub}`);
                  }
                  if (pubkey && pubkey.length === 64) {
                    tooltipParts.push(`pubkey: ${pubkey}`);
                  }
                  const tooltip = tooltipParts.join("\n");

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
          {pr.status === "open" &&
            pr.author &&
            (() => {
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
                    if (
                      decoded.type === "npub" &&
                      typeof decoded.data === "string"
                    ) {
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
                    This zap goes to the PR author. If this PR is merged and
                    linked to an issue with a bounty, the bounty will be
                    released to the PR author.
                  </p>
                  {/* Show bounty info if PR is linked to an issue with a bounty withdraw link created */}
                  {linkedIssue?.bountyAmount &&
                    (linkedIssue?.bountyWithdrawId ||
                      linkedIssue?.bountyWithdrawUrl) && (
                      <div className="mt-3 p-3 bg-yellow-900/20 border border-yellow-600/50 rounded">
                        <p className="text-xs font-semibold text-yellow-300 mb-1">
                          💰 Bounty on linked issue
                        </p>
                        <p className="text-xs text-yellow-200">
                          Issue #{linkedIssue.number || linkedIssue.id} has a{" "}
                          <strong>{linkedIssue.bountyAmount} sats</strong>{" "}
                          bounty withdraw link created.
                        </p>
                        <p className="text-xs text-yellow-300/80 mt-1">
                          Merging this PR will automatically release the
                          withdraw link to the PR author. Funds will be deducted
                          when they claim it.
                        </p>
                      </div>
                    )}
                </div>
              );
            })()}

          {/* Bounty Info (if PR is linked to an issue with a bounty but author is not a valid Nostr pubkey) */}
          {pr.status === "open" &&
            linkedIssue?.bountyAmount &&
            (linkedIssue?.bountyWithdrawId || linkedIssue?.bountyWithdrawUrl) &&
            (() => {
              // Check if PR author is a valid Nostr pubkey
              let isValidAuthor = false;
              try {
                if (/^[0-9a-f]{64}$/i.test(pr.author || "")) {
                  isValidAuthor = true;
                } else if (pr.author?.startsWith("npub")) {
                  try {
                    const decoded = nip19.decode(pr.author);
                    if (
                      decoded.type === "npub" &&
                      typeof decoded.data === "string"
                    ) {
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
                    <p className="text-xs font-semibold text-yellow-300 mb-1">
                      ⚠️ Bounty withdraw link cannot be released
                    </p>
                    <p className="text-xs text-yellow-200">
                      Issue #{linkedIssue.number || linkedIssue.id} has a{" "}
                      <strong>{linkedIssue.bountyAmount} sats</strong> bounty
                      withdraw link, but the PR author ({pr.author || "unknown"}
                      ) is not a valid Nostr user.
                    </p>
                    <p className="text-xs text-yellow-300/80 mt-1">
                      The PR author needs to claim their GitHub profile and link
                      it to a Nostr account to receive the withdraw link.
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
