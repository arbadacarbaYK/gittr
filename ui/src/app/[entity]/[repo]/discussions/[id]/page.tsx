"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Reactions } from "@/components/ui/reactions";
import { Textarea } from "@/components/ui/textarea";
import {
  type Discussion,
  type DiscussionComment,
  LOCAL_STORAGE_QUOTA_MESSAGE,
  discussionAuthorMatches,
  discussionFromLongFormEvent,
  hideDiscussion,
  loadDiscussionById,
  persistDiscussion,
} from "@/lib/discussions/storage";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import {
  KIND_COMMENT,
  KIND_LONG_FORM,
  buildUnsignedCommentEvent,
  buildUnsignedDiscussionDeletionEvent,
} from "@/lib/nostr/events";
import {
  NO_SIGNING_METHOD_MESSAGE,
  resolveNostrSigner,
} from "@/lib/nostr/signer";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import { markdownRehypePlugins } from "@/lib/security/markdown-rehype-plugins";
import { markdownRemarkPlugins } from "@/lib/security/markdown-remark-plugins";
import { formatDateTime24h } from "@/lib/utils/date-format";
import { MarkdownCode } from "@/lib/utils/markdown-code";

import { ArrowLeft, MessageCircle, Reply, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getEventHash } from "nostr-tools";
import ReactMarkdown from "react-markdown";

type ThreadedComment = DiscussionComment & {
  depth: number;
  children: ThreadedComment[];
};

export default function DiscussionDetailPage({
  params,
}: {
  params: Promise<{ entity: string; repo: string; id: string }>;
}) {
  const resolvedParams = use(params);
  const {
    pubkey: currentUserPubkey,
    publish,
    defaultRelays,
    remoteSigner,
    subscribe,
  } = useNostrContext();
  const router = useRouter();
  const searchParams = useSearchParams();
  const cacheFull = searchParams?.get("cache") === "full";
  const [discussion, setDiscussion] = useState<Discussion | null>(null);
  const [loading, setLoading] = useState(true);
  const [replyContent, setReplyContent] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyParentId, setReplyParentId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const local = loadDiscussionById(
      resolvedParams.entity,
      resolvedParams.repo,
      resolvedParams.id
    );
    if (local) {
      setDiscussion(local);
      setLoading(false);
    }
    if (!subscribe || !defaultRelays?.length || !resolvedParams.id) {
      if (!local) setLoading(false);
      return;
    }
    const unsubTopic = subscribe(
      [{ ids: [resolvedParams.id], kinds: [KIND_LONG_FORM] }],
      defaultRelays,
      (ev) => {
        if (ev.kind !== KIND_LONG_FORM || ev.id !== resolvedParams.id) return;
        const fromNostr = discussionFromLongFormEvent(
          ev as any,
          resolvedParams.entity,
          resolvedParams.repo
        );
        setDiscussion((prev) => {
          const merged: Discussion = {
            ...fromNostr,
            comments: prev?.comments?.length
              ? prev.comments
              : fromNostr.comments,
            commentCount: prev?.commentCount || fromNostr.commentCount,
            authorName: prev?.authorName,
          };
          try {
            persistDiscussion(
              resolvedParams.entity,
              resolvedParams.repo,
              merged
            );
          } catch {
            /* cache is optional once the event is on relays */
          }
          return merged;
        });
        setLoading(false);
      }
    );
    const unsubComments = subscribe(
      [{ kinds: [KIND_COMMENT], "#E": [resolvedParams.id] }],
      defaultRelays,
      (ev) => {
        if (ev.kind !== KIND_COMMENT || !ev.id) return;
        const parent =
          (ev.tags || []).find((t: string[]) => t[0] === "e")?.[1] ||
          resolvedParams.id;
        const comment: DiscussionComment = {
          id: ev.id,
          author: ev.pubkey,
          content: ev.content || "",
          createdAt: (ev.created_at || 0) * 1000,
          parentId: parent && parent !== resolvedParams.id ? parent : undefined,
        };
        setDiscussion((prev) => {
          if (!prev) return prev;
          if (prev.comments.some((c) => c.id === comment.id)) return prev;
          const comments = [...prev.comments, comment];
          const next = {
            ...prev,
            comments,
            commentCount: comments.length,
          };
          try {
            persistDiscussion(resolvedParams.entity, resolvedParams.repo, next);
          } catch {
            /* cache is optional once the event is on relays */
          }
          return next;
        });
      }
    );
    const timeout = window.setTimeout(() => setLoading(false), 8000);
    return () => {
      unsubTopic();
      unsubComments();
      window.clearTimeout(timeout);
    };
  }, [
    defaultRelays,
    resolvedParams.entity,
    resolvedParams.id,
    resolvedParams.repo,
    subscribe,
  ]);

  // Get all participant pubkeys for metadata
  const participantPubkeys = discussion
    ? Array.from(
        new Set([
          discussion.author,
          ...discussion.comments.map((comment) => comment.author),
        ])
      )
    : [];
  const metadata = useContributorMetadata(participantPubkeys);

  const getMetadataForPubkey = useCallback(
    (pubkey: string) => metadata[pubkey.toLowerCase()] || metadata[pubkey],
    [metadata]
  );

  const handleReply = useCallback(async () => {
    if (!replyContent.trim() || !discussion || !currentUserPubkey) return;

    try {
      let commentId = `comment-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      const newComment: DiscussionComment = {
        id: commentId,
        author: currentUserPubkey,
        content: replyContent.trim(),
        createdAt: Date.now(),
        parentId: replyParentId || undefined,
      };

      if (publish && defaultRelays?.length) {
        try {
          const signer = await resolveNostrSigner({ remoteSigner });
          if (signer) {
            const parentComment = replyParentId
              ? discussion.comments.find(
                  (comment) => comment.id === replyParentId
                )
              : null;
            const pubkeyHex = await signer.getPublicKey();
            const commentEvent = buildUnsignedCommentEvent(
              {
                replyTo: replyParentId || discussion.id,
                rootKind: 30023,
                rootPubkey: discussion.author,
                ...(parentComment
                  ? {
                      parentKind: 1111,
                      parentPubkey: parentComment.author,
                    }
                  : {}),
                repoEntity: resolvedParams.entity,
                repoName: resolvedParams.repo,
                content: replyContent.trim(),
              },
              pubkeyHex
            );
            commentEvent.id = getEventHash(commentEvent);
            const signedCommentEvent = await signer.signEvent(commentEvent);
            publish(signedCommentEvent, defaultRelays);
            commentId = signedCommentEvent.id;
            newComment.id = commentId;
          } else {
            console.warn(NO_SIGNING_METHOD_MESSAGE);
          }
        } catch (err) {
          console.error("Failed to publish comment to Nostr:", err);
        }
      }

      const updatedComments: DiscussionComment[] = [
        ...discussion.comments,
        newComment,
      ];
      const updatedDiscussion: Discussion = {
        ...discussion,
        comments: updatedComments,
        commentCount: updatedComments.length,
      };

      persistDiscussion(
        resolvedParams.entity,
        resolvedParams.repo,
        updatedDiscussion
      );
      setDiscussion(updatedDiscussion);
      setReplyContent("");
      setReplyingTo(null);
      setReplyParentId(null);
      if (textareaRef.current) textareaRef.current.focus();
    } catch (error) {
      console.error("Failed to add comment:", error);
      alert("Failed to add comment: " + (error as Error).message);
    }
  }, [
    discussion,
    currentUserPubkey,
    publish,
    defaultRelays,
    resolvedParams.entity,
    resolvedParams.repo,
    remoteSigner,
    replyContent,
    replyParentId,
  ]);

  const handleDelete = useCallback(async () => {
    if (!discussion || !currentUserPubkey) return;
    if (!discussionAuthorMatches(discussion.author, currentUserPubkey)) return;
    const ok = window.confirm(
      "Delete this discussion? Relays will get a NIP-09 deletion. It will disappear from this browser’s list."
    );
    if (!ok) return;
    setDeleting(true);
    setActionError("");
    try {
      if (!publish || !defaultRelays?.length) {
        throw new Error("Nostr relays are not ready yet.");
      }
      const signer = await resolveNostrSigner({ remoteSigner });
      if (!signer) {
        throw new Error(NO_SIGNING_METHOD_MESSAGE);
      }
      const pubkeyHex = await signer.getPublicKey();
      const unsigned = buildUnsignedDiscussionDeletionEvent({
        eventId: discussion.id,
        pubkeyHex,
        dTag: discussion.dTag,
        title: discussion.title,
      });
      unsigned.id = getEventHash(unsigned);
      const signed = await signer.signEvent(unsigned);
      if (!signed?.sig) {
        throw new Error(
          "Could not sign the deletion. Unlock Amber, then try again."
        );
      }
      publish(signed, defaultRelays);
      hideDiscussion(resolvedParams.entity, resolvedParams.repo, discussion.id);
      window.dispatchEvent(new CustomEvent("gittr:discussion-deleted"));
      router.push(
        `/${resolvedParams.entity}/${resolvedParams.repo}/discussions`
      );
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Failed to delete discussion"
      );
      setDeleting(false);
    }
  }, [
    currentUserPubkey,
    defaultRelays,
    discussion,
    publish,
    remoteSigner,
    resolvedParams.entity,
    resolvedParams.repo,
    router,
  ]);

  const startReply = (parentId?: string, authorPubkey?: string) => {
    setReplyParentId(parentId || null);
    setReplyingTo(authorPubkey || null);
    const authorLabel = authorPubkey ? authorPubkey.slice(0, 8) : "author";
    setReplyContent(parentId ? `@${authorLabel}... ` : "");
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  // Build threaded comment tree
  const buildCommentTree = (
    comments: DiscussionComment[]
  ): ThreadedComment[] => {
    const commentMap = new Map<string, ThreadedComment>();
    const rootComments: ThreadedComment[] = [];

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
      const node = commentMap.get(comment.id);
      if (!node) {
        return;
      }
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
    const sortTree = (nodes: ThreadedComment[]) => {
      nodes.sort((a, b) => a.createdAt - b.createdAt);
      nodes.forEach((node) => {
        if (node.children.length > 0) {
          sortTree(node.children);
        }
      });
    };

    sortTree(rootComments);
    return rootComments;
  };

  const renderComment = (comment: ThreadedComment) => {
    const authorMeta = getMetadataForPubkey(comment.author);
    const indent = comment.depth * 32; // 32px per level

    return (
      <div
        key={comment.id}
        className="mb-4"
        style={{ marginLeft: `${indent}px` }}
      >
        <div className="border border-gray-700 rounded p-4 bg-gray-900/50">
          <div className="flex items-start gap-3">
            <Avatar className="h-8 w-8 flex-shrink-0">
              <AvatarImage src={authorMeta?.picture} />
              <AvatarFallback>
                {comment.author.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <Link
                  href={`/${comment.author}`}
                  className="font-semibold hover:text-purple-400"
                >
                  {(authorMeta?.name || comment.author.slice(0, 8)) + "..."}
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
                  remarkPlugins={markdownRemarkPlugins}
                  rehypePlugins={markdownRehypePlugins}
                  components={{
                    code: MarkdownCode,
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
                  entity={resolvedParams.entity}
                  repo={resolvedParams.repo}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Render nested replies */}
        {comment.children.length > 0 && (
          <div className="mt-2">
            {comment.children.map((child) => renderComment(child))}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return <div className="container mx-auto max-w-4xl p-6">Loading...</div>;
  }

  if (!discussion) {
    return (
      <div className="container mx-auto max-w-4xl p-6">
        <div className="text-center py-12">
          <MessageCircle className="h-12 w-12 mx-auto mb-4 text-gray-500" />
          <h2 className="text-xl font-semibold mb-2">Discussion not found</h2>
          <p className="text-sm text-gray-400 mb-4 max-w-md mx-auto">
            gittr looks this up on Nostr by event id. If it never published, or
            relays have not answered yet, try the list again in a moment.
          </p>
          <Link
            href={`/${resolvedParams.entity}/${resolvedParams.repo}/discussions`}
          >
            <Button variant="outline">Back to Discussions</Button>
          </Link>
        </div>
      </div>
    );
  }

  const authorMeta = getMetadataForPubkey(discussion.author);
  const threadedComments = buildCommentTree(discussion.comments);

  return (
    <div className="container mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <Link
          href={`/${resolvedParams.entity}/${resolvedParams.repo}/discussions`}
          className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-purple-400 mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Discussions
        </Link>

        <div className="flex items-start gap-4 mb-4">
          <Avatar className="h-10 w-10">
            <AvatarImage src={authorMeta?.picture} />
            <AvatarFallback>
              {discussion.author.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-2xl font-bold mb-2">{discussion.title}</h1>
              {discussionAuthorMatches(
                discussion.author,
                currentUserPubkey || ""
              ) && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={deleting}
                  onClick={handleDelete}
                  className="shrink-0 text-red-400 border-red-800 hover:bg-red-950/40"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  {deleting ? "Deleting..." : "Delete"}
                </Button>
              )}
            </div>
            {(cacheFull || actionError) && (
              <div className="mb-3 p-3 text-sm rounded border border-amber-800 bg-amber-950/30 text-amber-200">
                {actionError || LOCAL_STORAGE_QUOTA_MESSAGE}
              </div>
            )}
            <div className="flex items-center gap-3 text-sm text-gray-400 mb-4">
              <Link
                href={`/${discussion.author}`}
                className="hover:text-purple-400"
              >
                {(authorMeta?.name || discussion.author.slice(0, 8)) + "..."}
              </Link>
              <span>•</span>
              <span>{formatDateTime24h(discussion.createdAt)}</span>
              {discussion.category && (
                <>
                  <span>•</span>
                  <Badge className="bg-purple-900/30 text-purple-400">
                    {discussion.category}
                  </Badge>
                </>
              )}
            </div>
            <div className="prose prose-invert max-w-none">
              <ReactMarkdown
                remarkPlugins={markdownRemarkPlugins}
                rehypePlugins={markdownRehypePlugins}
                components={{
                  code: MarkdownCode,
                }}
              >
                {discussion.description}
              </ReactMarkdown>
            </div>
            <div className="mt-4">
              <Reactions
                targetId={discussion.id}
                targetType="discussion"
                entity={resolvedParams.entity}
                repo={resolvedParams.repo}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Comments Section */}
      <div className="border-t border-gray-700 pt-6">
        <h2 className="text-xl font-semibold mb-4">
          {discussion.commentCount || 0}{" "}
          {discussion.commentCount === 1 ? "Comment" : "Comments"}
        </h2>

        {/* Threaded Comments */}
        <div className="space-y-4 mb-6">
          {threadedComments.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No comments yet. Be the first to comment!
            </div>
          ) : (
            threadedComments.map((comment) => renderComment(comment))
          )}
        </div>

        {/* Reply Form */}
        {currentUserPubkey ? (
          <div className="border border-gray-700 rounded p-4 bg-gray-900/50">
            {replyingTo && (
              <div className="mb-2 text-sm text-gray-400">
                Replying to{" "}
                <span className="text-purple-400">
                  {replyingTo.slice(0, 8)}...
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setReplyingTo(null);
                    setReplyParentId(null);
                    setReplyContent("");
                  }}
                  className="ml-2 h-5 text-xs"
                >
                  Cancel
                </Button>
              </div>
            )}
            <Textarea
              ref={textareaRef}
              value={replyContent}
              onChange={(e) => setReplyContent(e.target.value)}
              placeholder={
                replyingTo ? "Write a reply..." : "Write a comment..."
              }
              className="min-h-24 mb-3"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  handleReply();
                }
              }}
            />
            <div className="flex justify-end">
              <Button
                onClick={handleReply}
                disabled={!replyContent.trim()}
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
  );
}
