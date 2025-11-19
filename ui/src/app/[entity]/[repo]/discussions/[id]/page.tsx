"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, ArrowLeft, Reply } from "lucide-react";
import useSession from "@/lib/nostr/useSession";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import {
  loadDiscussionById,
  persistDiscussion,
  type Discussion,
  type DiscussionComment,
} from "@/lib/discussions/storage";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { Reactions } from "@/components/ui/reactions";
import { formatDateTime24h } from "@/lib/utils/date-format";

type ThreadedComment = DiscussionComment & { depth: number; children: ThreadedComment[] };

export default function DiscussionDetailPage({ params }: { params: { entity: string; repo: string; id: string } }) {
  const { pubkey: currentUserPubkey } = useNostrContext();
  const [discussion, setDiscussion] = useState<Discussion | null>(null);
  const [loading, setLoading] = useState(true);
  const [replyContent, setReplyContent] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyParentId, setReplyParentId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load discussion
  useEffect(() => {
    try {
      const foundDiscussion = loadDiscussionById(params.entity, params.repo, params.id);
      setDiscussion(foundDiscussion);
    } catch (error) {
      console.error("Failed to load discussion:", error);
    } finally {
      setLoading(false);
    }
  }, [params.entity, params.id, params.repo]);

  // Get all participant pubkeys for metadata
  const participantPubkeys = discussion
    ? Array.from(new Set([discussion.author, ...discussion.comments.map((comment) => comment.author)]))
    : [];
  const metadata = useContributorMetadata(participantPubkeys);

  const getMetadataForPubkey = useCallback(
    (pubkey: string) => metadata[pubkey.toLowerCase()] || metadata[pubkey],
    [metadata]
  );

  const handleReply = useCallback(() => {
    if (!replyContent.trim() || !discussion || !currentUserPubkey) return;

    try {
      const commentId = `comment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const newComment: DiscussionComment = {
        id: commentId,
        author: currentUserPubkey,
        content: replyContent.trim(),
        createdAt: Date.now(),
        parentId: replyParentId || undefined,
      };

      const updatedComments: DiscussionComment[] = [...discussion.comments, newComment];
      const updatedDiscussion: Discussion = {
        ...discussion,
        comments: updatedComments,
        commentCount: updatedComments.length,
      };

      persistDiscussion(params.entity, params.repo, updatedDiscussion);

      setDiscussion(updatedDiscussion);
      setReplyContent("");
      setReplyingTo(null);
      setReplyParentId(null);
      
      // Focus textarea if still mounted
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    } catch (error) {
      console.error("Failed to add comment:", error);
      alert("Failed to add comment: " + (error as Error).message);
    }
  }, [discussion, currentUserPubkey, params, replyContent, replyParentId]);

  const startReply = (parentId?: string, authorPubkey?: string) => {
    setReplyParentId(parentId || null);
    setReplyingTo(authorPubkey || null);
    const authorLabel = authorPubkey ? authorPubkey.slice(0, 8) : "author";
    setReplyContent(parentId ? `@${authorLabel}... ` : "");
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  // Build threaded comment tree
  const buildCommentTree = (comments: DiscussionComment[]): ThreadedComment[] => {
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
      <div key={comment.id} className="mb-4" style={{ marginLeft: `${indent}px` }}>
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
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw]}
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
          <Link href={`/${params.entity}/${params.repo}/discussions`}>
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
          href={`/${params.entity}/${params.repo}/discussions`}
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
            <h1 className="text-2xl font-bold mb-2">{discussion.title}</h1>
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
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw]}
              >
                {discussion.description}
              </ReactMarkdown>
            </div>
            <div className="mt-4">
              <Reactions
                targetId={discussion.id}
                targetType="discussion"
                entity={params.entity}
                repo={params.repo}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Comments Section */}
      <div className="border-t border-gray-700 pt-6">
        <h2 className="text-xl font-semibold mb-4">
          {discussion.commentCount || 0} {discussion.commentCount === 1 ? "Comment" : "Comments"}
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
                Replying to <span className="text-purple-400">{replyingTo.slice(0, 8)}...</span>
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
              placeholder={replyingTo ? "Write a reply..." : "Write a comment..."}
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

