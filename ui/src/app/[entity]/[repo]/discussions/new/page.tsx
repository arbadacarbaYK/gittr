"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  type Discussion,
  LOCAL_STORAGE_QUOTA_MESSAGE,
  appendDiscussion,
  normalizeDiscussionPubkey,
} from "@/lib/discussions/storage";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { buildUnsignedDiscussionEvent } from "@/lib/nostr/events";
import {
  NO_SIGNING_METHOD_MESSAGE,
  resolveNostrSigner,
} from "@/lib/nostr/signer";
import useSession from "@/lib/nostr/useSession";
import { collaborationTabMode } from "@/lib/repos/collaboration-tab-source";
import { type StoredRepo, loadStoredRepos } from "@/lib/repos/storage";
import { getRepoOwnerPubkey } from "@/lib/utils/entity-resolver";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";

import { X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { getEventHash } from "nostr-tools";

const DISCUSSION_CATEGORIES = [
  "General",
  "Ideas",
  "Q&A",
  "Announcements",
  "Polls",
];

export default function NewDiscussionPage() {
  const params = useParams<{ entity: string; repo: string }>();
  const entity = params?.entity ?? "";
  const repo = params?.repo ?? "";
  const router = useRouter();
  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const draftDTagRef = useRef<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [forgeBlocked, setForgeBlocked] = useState(false);
  const { initials, isLoggedIn } = useSession();
  const {
    publish,
    defaultRelays,
    pubkey: currentUserPubkey,
    remoteSigner,
  } = useNostrContext();

  useEffect(() => {
    try {
      const repos = loadStoredRepos();
      const rec = findRepoByEntityAndName<StoredRepo>(repos, entity, repo);
      const mode = collaborationTabMode({
        sourceUrl: rec?.sourceUrl,
        forkedFrom: rec?.forkedFrom,
        clone: rec?.clone,
      });
      setForgeBlocked(mode === "forge-readonly");
    } catch {
      setForgeBlocked(false);
    }
  }, [entity, repo]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();

      if (submitting) return;
      setSubmitting(true);
      setErrorMsg("");

      if (!isLoggedIn || !currentUserPubkey) {
        setErrorMsg("Please sign in to create discussions.");
        setSubmitting(false);
        return;
      }

      const title = titleRef.current?.value || "";
      const description = descriptionRef.current?.value || "";

      if (!title || !description) {
        setErrorMsg("Title and description are required");
        setSubmitting(false);
        return;
      }

      if (!entity || !repo) {
        setErrorMsg("Invalid repository");
        setSubmitting(false);
        return;
      }

      if (forgeBlocked) {
        setErrorMsg(
          "This repo’s git source is on a forge. gittr shows GitHub Discussions read-only and does not create a parallel Nostr thread."
        );
        setSubmitting(false);
        return;
      }

      if (!publish || !defaultRelays?.length) {
        setErrorMsg(
          "Nostr relays are not ready yet. Wait a moment and try again."
        );
        setSubmitting(false);
        return;
      }

      try {
        const now = Math.floor(Date.now() / 1000);
        if (!draftDTagRef.current) {
          draftDTagRef.current = `${entity}/${repo}/${now}-${Math.random()
            .toString(36)
            .slice(2, 10)}`;
        }
        const identifier = draftDTagRef.current;
        const repos = loadStoredRepos();
        const rec = findRepoByEntityAndName<StoredRepo>(repos, entity, repo);
        const ownerHex =
          getRepoOwnerPubkey(rec, entity) ||
          normalizeDiscussionPubkey(entity) ||
          normalizeDiscussionPubkey(currentUserPubkey);

        const signer = await resolveNostrSigner({ remoteSigner });
        if (!signer) {
          setErrorMsg(NO_SIGNING_METHOD_MESSAGE);
          setSubmitting(false);
          return;
        }

        const pubkeyHex = await signer.getPublicKey();
        const unsigned = buildUnsignedDiscussionEvent(
          {
            repoEntity: entity,
            repoName: repo,
            title,
            description,
            category: selectedCategory || undefined,
            status: "open",
            identifier,
            ownerPubkey: ownerHex || undefined,
          },
          pubkeyHex,
          now
        );
        unsigned.id = getEventHash(unsigned);
        const discussionEvent = await signer.signEvent(unsigned);
        if (!discussionEvent?.id || !discussionEvent.sig) {
          setErrorMsg(
            "Could not sign the discussion. Unlock Amber (or your signer), then try again. Your text is still in this form."
          );
          setSubmitting(false);
          return;
        }

        publish(discussionEvent, defaultRelays);
        console.log(
          "✅ Published discussion (NIP-23 30023) to Nostr:",
          discussionEvent.id
        );

        const newDiscussion: Discussion = {
          id: discussionEvent.id,
          entity,
          repo,
          title,
          description,
          preview: description.substring(0, 200),
          author: pubkeyHex || currentUserPubkey,
          authorName: initials || currentUserPubkey.slice(0, 8),
          category: selectedCategory || undefined,
          createdAt: (discussionEvent.created_at ?? now) * 1000,
          commentCount: 0,
          comments: [],
          dTag: identifier,
          source: "nostr",
        };

        const saved = appendDiscussion(entity, repo, newDiscussion);
        window.dispatchEvent(
          new CustomEvent("gittr:discussion-created", {
            detail: newDiscussion,
          })
        );

        const cacheNote = saved.quota ? "?cache=full" : "";
        setSubmitting(false);
        router.push(
          `/${entity}/${repo}/discussions/${discussionEvent.id}${cacheNote}`
        );
        if (saved.quota) {
          setErrorMsg(LOCAL_STORAGE_QUOTA_MESSAGE);
        }
      } catch (error) {
        console.error("Error creating discussion:", error);
        const message =
          error instanceof Error
            ? error.message
            : "Failed to create discussion";
        setErrorMsg(message);
        setSubmitting(false);
      }
    },
    [
      forgeBlocked,
      currentUserPubkey,
      defaultRelays,
      entity,
      initials,
      isLoggedIn,
      publish,
      remoteSigner,
      repo,
      router,
      selectedCategory,
      submitting,
    ]
  );

  return (
    <div className="container mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <Link
          href={`/${entity}/${repo}/discussions`}
          className="text-purple-500 hover:underline mb-4 inline-block"
        >
          ← Back to Discussions
        </Link>
        <h1 className="text-2xl font-bold mb-2">Start a New Discussion</h1>
        <p className="text-gray-400">
          {forgeBlocked
            ? "This repo has a forge git source. Discussions are read-only from GitHub."
            : "Share ideas, ask questions, or get feedback from the community"}
        </p>
      </div>

      {forgeBlocked ? (
        <div className="p-4 bg-amber-950/40 border border-amber-600/50 rounded text-amber-100/90 text-sm">
          gittr does not write to GitHub Discussions. Open the Discussions tab
          for the forge copy.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {errorMsg && (
            <div className="p-4 bg-red-900/20 border border-red-700 rounded text-red-400">
              {errorMsg}
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="category" className="block text-sm font-medium">
              Category (optional)
            </label>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" type="button">
                    {selectedCategory || "Select category"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>Category</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {DISCUSSION_CATEGORIES.map((cat) => (
                    <DropdownMenuItem
                      key={cat}
                      onClick={() =>
                        setSelectedCategory(
                          selectedCategory === cat ? null : cat
                        )
                      }
                    >
                      {cat}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {selectedCategory && (
                <Badge
                  variant="outline"
                  className="border-purple-700 text-purple-400 bg-purple-900/20"
                >
                  {selectedCategory}
                  <button
                    type="button"
                    onClick={() => setSelectedCategory(null)}
                    className="ml-1 hover:text-red-400"
                  >
                    <X className="h-3 w-3 inline" />
                  </button>
                </Badge>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="title" className="block text-sm font-medium">
              Title *
            </label>
            <Input
              id="title"
              ref={titleRef}
              placeholder="Discussion title"
              required
              className="w-full"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="description" className="block text-sm font-medium">
              Description *
            </label>
            <Textarea
              id="description"
              ref={descriptionRef}
              placeholder="What's on your mind?"
              required
              rows={12}
              className="w-full font-mono text-sm"
            />
          </div>

          <div className="flex justify-end gap-4">
            <Link href={`/${entity}/${repo}/discussions`}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating..." : "Start Discussion"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
