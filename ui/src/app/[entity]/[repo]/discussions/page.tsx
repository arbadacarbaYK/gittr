"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { type Discussion, loadDiscussions } from "@/lib/discussions/storage";
import { formatDate24h } from "@/lib/utils/date-format";

import { MessageCircle, Plus } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

export default function DiscussionsPage() {
  const [mounted, setMounted] = useState(false);
  const params = useParams<{ entity: string; repo: string }>();
  const entity = params?.entity || "";
  const repo = params?.repo || "";

  const [discussions, setDiscussions] = useState<Discussion[]>([]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const refreshDiscussions = useCallback(() => {
    if (!mounted) return; // Don't load from localStorage until mounted
    setDiscussions(loadDiscussions(entity, repo));
  }, [mounted, entity, repo]);

  useEffect(() => {
    if (!mounted) return;
    refreshDiscussions();

    // Listen for new discussion creation
    const handleDiscussionCreated = () => {
      refreshDiscussions();
    };
    window.addEventListener(
      "gittr:discussion-created",
      handleDiscussionCreated
    );

    return () => {
      window.removeEventListener(
        "gittr:discussion-created",
        handleDiscussionCreated
      );
    };
  }, [refreshDiscussions]);

  return (
    <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MessageCircle className="h-6 w-6" />
          Discussions
        </h1>
        <Link href={`/${entity}/${repo}/discussions/new`}>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New Discussion
          </Button>
        </Link>
      </div>

      {discussions.length === 0 ? (
        <div className="border border-[#383B42] rounded p-12 text-center bg-[#171B21]">
          <MessageCircle className="h-12 w-12 mx-auto mb-4 text-gray-500" />
          <h3 className="text-xl font-semibold mb-2">No discussions yet</h3>
          <p className="text-gray-400 mb-4">
            Start a discussion to share ideas, ask questions, or get feedback
          </p>
          <Link href={`/${entity}/${repo}/discussions/new`}>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Discussion
            </Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {discussions.map((discussion) => (
            <Link
              key={discussion.id}
              href={`/${entity}/${repo}/discussions/${discussion.id}`}
              className="block border border-[#383B42] rounded p-4 hover:bg-white/5"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="font-semibold text-lg mb-1">
                    {discussion.title}
                  </h3>
                  <p className="text-sm text-gray-400 mb-2">
                    {discussion.preview || "No preview available"}
                  </p>
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span>Started by {discussion.author?.slice(0, 8)}...</span>
                    <span>{formatDate24h(discussion.createdAt)}</span>
                    {discussion.category && (
                      <span className="px-2 py-1 bg-purple-900/30 text-purple-400 rounded">
                        {discussion.category}
                      </span>
                    )}
                  </div>
                </div>
                {discussion.commentCount > 0 && (
                  <div className="text-sm text-gray-400">
                    {discussion.commentCount}{" "}
                    {discussion.commentCount === 1 ? "comment" : "comments"}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
