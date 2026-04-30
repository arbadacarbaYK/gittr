"use client";

import { useCallback, useRef, useState } from "react";

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
import { type Discussion, appendDiscussion } from "@/lib/discussions/storage";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { KIND_LONG_FORM, createDiscussionEvent } from "@/lib/nostr/events";
import useSession from "@/lib/nostr/useSession";
import { getNostrPrivateKey } from "@/lib/security/encryptedStorage";

import { X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { Event, UnsignedEvent } from "nostr-tools";

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
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const { initials, isLoggedIn } = useSession();
  const {
    publish,
    defaultRelays,
    pubkey: currentUserPubkey,
  } = useNostrContext();

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();

      if (submitting) return;
      setSubmitting(true);
      setErrorMsg("");

      // Check if user is logged in
      if (!isLoggedIn || !currentUserPubkey) {
        setErrorMsg("Please sign in to create discussions.");
        setTimeout(() => {
          setErrorMsg("");
        }, 6000);
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

      try {
        const now = Math.floor(Date.now() / 1000);
        const identifier = `${entity}/${repo}/${now}-${Math.random().toString(36).slice(2, 10)}`;

        let discussionEvent: Event | null = null;

        // Build and sign NIP-23 (kind 30023) event first so we have event.id for the discussion
        if (publish && defaultRelays && defaultRelays.length > 0) {
          try {
            const privateKey = await getNostrPrivateKey();
            const hasNip07 = typeof window !== "undefined" && window.nostr;
            const { getPublicKey } = await import("nostr-tools");
            const authorPubkey = privateKey
              ? getPublicKey(privateKey)
              : (await (hasNip07 ? window.nostr.getPublicKey() : null)) ?? currentUserPubkey;

            if (hasNip07 && window.nostr) {
              const unsignedEvent = {
                kind: KIND_LONG_FORM,
                created_at: now,
                tags: [
                  ["d", identifier],
                  ["title", title],
                  ["summary", description.slice(0, 200)],
                  ["published_at", String(now)],
                  ["repo", `${entity}/${repo}`],
                  ["status", "open"],
                  ...(selectedCategory ? [["t", selectedCategory], ["category", selectedCategory]] : []),
                ],
                content: description,
                pubkey: authorPubkey,
              } as unknown as UnsignedEvent;
              discussionEvent = await window.nostr.signEvent(unsignedEvent);
            } else if (privateKey) {
              discussionEvent = createDiscussionEvent(
                {
                  repoEntity: entity,
                  repoName: repo,
                  title,
                  description,
                  category: selectedCategory || undefined,
                  status: "open",
                  identifier,
                },
                privateKey
              );
            }

            if (discussionEvent && publish) {
              publish(discussionEvent, defaultRelays);
              console.log("✅ Published discussion (NIP-23 30023) to Nostr:", discussionEvent.id);
            }
          } catch (err) {
            console.error("Failed to publish discussion to Nostr:", err);
          }
        }

        // Use event.id as discussion id (so NIP-22 comments can reference it); fallback to local id if not published
        const discussionId = discussionEvent?.id ?? `local-${identifier}`;

        const newDiscussion: Discussion = {
          id: discussionId,
          entity,
          repo,
          title,
          description,
          preview: description.substring(0, 200),
          author: currentUserPubkey,
          authorName: initials || currentUserPubkey.slice(0, 8),
          category: selectedCategory || undefined,
          createdAt: (discussionEvent?.created_at ?? now) * 1000,
          commentCount: 0,
          comments: [],
        };

        try {
          appendDiscussion(entity, repo, newDiscussion);
          window.dispatchEvent(
            new CustomEvent("gittr:discussion-created", { detail: newDiscussion })
          );
        } catch (err) {
          console.error("Failed to save discussion locally:", err);
          const message = err instanceof Error ? err.message : String(err);
          setErrorMsg(`Failed to save discussion: ${message}`);
          setSubmitting(false);
          return;
        }

        setSubmitting(false);
        router.push(`/${entity}/${repo}/discussions`);
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
      currentUserPubkey,
      defaultRelays,
      entity,
      initials,
      isLoggedIn,
      publish,
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
          Share ideas, ask questions, or get feedback from the community
        </p>
      </div>

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
                      setSelectedCategory(selectedCategory === cat ? null : cat)
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
    </div>
  );
}
