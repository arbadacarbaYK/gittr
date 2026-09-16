"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { discussionNostrFilters } from "@/lib/discussions/repo-scope";
import {
  type Discussion,
  discussionFromLongFormEvent,
  discussionsForTab,
  loadDiscussions,
  loadHiddenDiscussionIds,
  mergeDiscussionListsForView,
  persistDiscussionListPublic,
} from "@/lib/discussions/storage";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { KIND_LONG_FORM } from "@/lib/nostr/events";
import {
  type CollaborationTabMode,
  type CollaborationViewPref,
  collaborationTabMode,
  isGithubCollaborationUrl,
  readCollabViewPref,
  writeCollabViewPref,
} from "@/lib/repos/collaboration-tab-source";
import { hydrateRepoFromGithub } from "@/lib/repos/repo-github-hub";
import { type StoredRepo, loadStoredRepos } from "@/lib/repos/storage";
import { formatDate24h } from "@/lib/utils/date-format";
import { getRepoOwnerPubkey } from "@/lib/utils/entity-resolver";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";
import { syncGithubDiscussionsForRepo } from "@/lib/utils/sync-github-repo-discussions";

import { MessageCircle, Plus } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

export default function DiscussionsPage() {
  const [mounted, setMounted] = useState(false);
  const params = useParams<{ entity: string; repo: string }>();
  const entity = params?.entity || "";
  const repo = params?.repo || "";
  const { subscribe, defaultRelays } = useNostrContext();

  const [discussions, setDiscussions] = useState<Discussion[]>([]);
  const [fromNostr, setFromNostr] = useState<Discussion[]>([]);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [tabMode, setTabMode] = useState<CollaborationTabMode | null>(null);
  const [viewPref, setViewPref] = useState<CollaborationViewPref>("nostr");
  const [forgeNote, setForgeNote] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [ownerPubkey, setOwnerPubkey] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !entity || !repo) return;
    setViewPref(readCollabViewPref(entity, repo));
  }, [mounted, entity, repo]);

  const refreshDiscussions = useCallback(() => {
    if (!mounted) return;
    setDiscussions(loadDiscussions(entity, repo));
    setHiddenIds(loadHiddenDiscussionIds(entity, repo));
  }, [mounted, entity, repo]);

  useEffect(() => {
    if (!mounted || !entity || !repo) return;
    let cancelled = false;
    (async () => {
      setSyncing(true);
      try {
        const repos = loadStoredRepos();
        const rec = findRepoByEntityAndName<StoredRepo>(repos, entity, repo);
        const { sourceUrl } = await hydrateRepoFromGithub(entity, repo, {
          repoRecord: rec,
          subscribe,
          defaultRelays,
        });
        if (cancelled) return;
        const url = sourceUrl || rec?.sourceUrl || "";
        const mode = collaborationTabMode({
          sourceUrl: url || rec?.sourceUrl,
          forkedFrom: rec?.forkedFrom,
          clone: rec?.clone,
        });
        setTabMode(mode);
        setOwnerPubkey(getRepoOwnerPubkey(rec, entity));
        if (mode === "forge-readonly") {
          if (!isGithubCollaborationUrl(url)) {
            setForgeNote(
              "This repo’s git source is on a forge. Discussions show the forge copy only (read-only). gittr does not write GitHub/Gitea/GitLab discussions, and only GitHub Discussions can be imported here."
            );
            return;
          }
          const result = await syncGithubDiscussionsForRepo(entity, repo, url);
          if (cancelled) return;
          if (result.ok) {
            refreshDiscussions();
            if (result.enabled === false) {
              setForgeNote(
                "GitHub Discussions are not enabled on this repo. gittr will not create a parallel Nostr thread here."
              );
            } else if (result.imported > 0) {
              setForgeNote(
                `Synced ${result.imported} GitHub Discussion${
                  result.imported === 1 ? "" : "s"
                } (read-only). gittr does not write back to GitHub.`
              );
            } else {
              setForgeNote(
                "No GitHub Discussions on this repo (or none visible to the token)."
              );
            }
          } else {
            setForgeNote(
              "GitHub Discussions sync failed — showing the last cached forge threads if this browser still has them."
            );
            refreshDiscussions();
          }
          return;
        }
        setForgeNote(
          "Nostr-only repo — threads live on relays, with a cache in this browser."
        );
      } catch (e) {
        console.warn("[Discussions] source hydrate failed:", e);
      } finally {
        if (!cancelled) setSyncing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mounted, entity, repo, subscribe, defaultRelays, refreshDiscussions]);

  useEffect(() => {
    if (
      !mounted ||
      tabMode !== "nostr-local" ||
      !entity ||
      !repo ||
      !subscribe ||
      !defaultRelays?.length
    ) {
      return;
    }
    const filters = discussionNostrFilters(entity, repo, ownerPubkey);
    const unsub = subscribe(filters as any, defaultRelays, (ev) => {
      if (ev.kind !== KIND_LONG_FORM) return;
      setFromNostr((prev) => {
        const next = discussionFromLongFormEvent(ev as any, entity, repo);
        const byId = new Map(prev.map((d) => [d.id, d]));
        byId.set(ev.id, next);
        return Array.from(byId.values()).sort(
          (a, b) => b.createdAt - a.createdAt
        );
      });
    });
    return () => unsub();
  }, [mounted, tabMode, entity, repo, ownerPubkey, subscribe, defaultRelays]);

  useEffect(() => {
    if (!mounted || tabMode !== "nostr-local" || fromNostr.length === 0) return;
    const local = loadDiscussions(entity, repo);
    persistDiscussionListPublic(entity, repo, [...fromNostr, ...local]);
  }, [mounted, tabMode, entity, repo, fromNostr]);

  useEffect(() => {
    if (!mounted) return;
    refreshDiscussions();
    const handleDiscussionCreated = () => refreshDiscussions();
    window.addEventListener(
      "gittr:discussion-created",
      handleDiscussionCreated
    );
    window.addEventListener(
      "gittr:discussion-deleted",
      handleDiscussionCreated
    );
    return () => {
      window.removeEventListener(
        "gittr:discussion-created",
        handleDiscussionCreated
      );
      window.removeEventListener(
        "gittr:discussion-deleted",
        handleDiscussionCreated
      );
    };
  }, [refreshDiscussions, mounted]);

  const merged = useMemo(() => {
    if (!tabMode) return [];
    if (tabMode === "forge-readonly") {
      return discussionsForTab(discussions, "forge-readonly");
    }
    return mergeDiscussionListsForView(
      fromNostr,
      discussions,
      hiddenIds,
      viewPref
    );
  }, [discussions, fromNostr, hiddenIds, tabMode, viewPref]);

  const canChooseView = tabMode === "nostr-local" && fromNostr.length > 0;

  const onViewPref = (next: CollaborationViewPref) => {
    setViewPref(next);
    writeCollabViewPref(entity, repo, next);
  };

  return (
    <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
      <div className="flex flex-wrap justify-between items-start gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MessageCircle className="h-6 w-6" />
            Discussions
          </h1>
          {(syncing || forgeNote) && (
            <p className="mt-1 text-xs text-gray-400">
              {syncing ? "Checking source…" : forgeNote}
            </p>
          )}
          {tabMode === "forge-readonly" && (
            <p className="mt-1 text-xs text-amber-400/90">
              Forge threads only (read-only). gittr does not post to GitHub
              Discussions.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canChooseView && (
            <div className="flex rounded-md border border-[#383B42] overflow-hidden text-xs">
              <button
                type="button"
                className={`px-3 py-1.5 ${
                  viewPref === "nostr"
                    ? "bg-purple-900/50 text-purple-100"
                    : "text-gray-400 hover:text-gray-200"
                }`}
                onClick={() => onViewPref("nostr")}
              >
                Nostr
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 border-l border-[#383B42] ${
                  viewPref === "local"
                    ? "bg-purple-900/50 text-purple-100"
                    : "text-gray-400 hover:text-gray-200"
                }`}
                onClick={() => onViewPref("local")}
              >
                This browser
              </button>
            </div>
          )}
          {tabMode === "nostr-local" && (
            <Link href={`/${entity}/${repo}/discussions/new`}>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                New Discussion
              </Button>
            </Link>
          )}
        </div>
      </div>

      {merged.length === 0 ? (
        <div className="border border-[#383B42] rounded p-12 text-center bg-[#171B21]">
          <MessageCircle className="h-12 w-12 mx-auto mb-4 text-gray-500" />
          <h3 className="text-xl font-semibold mb-2">No discussions yet</h3>
          <p className="text-gray-400 mb-4">
            {tabMode === "forge-readonly"
              ? "Nothing from the forge to show. Threads are not created on gittr for repos with a GitHub/Gitea/GitLab source."
              : !tabMode
              ? "Checking whether this repo’s git source is a forge or Nostr-only…"
              : viewPref === "local"
              ? "This browser has no cached threads yet. Switch to Nostr or start a discussion."
              : "Start a discussion to share ideas, ask questions, or get feedback"}
          </p>
          {tabMode === "nostr-local" && (
            <Link href={`/${entity}/${repo}/discussions/new`}>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                New Discussion
              </Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {merged.map((discussion) => (
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
                    <span>
                      {discussion.source === "github"
                        ? "GitHub"
                        : viewPref === "local"
                        ? "This browser"
                        : "Nostr"}
                    </span>
                    <span>
                      Started by {discussion.author?.slice(0, 8)}
                      {discussion.author?.length > 8 ? "..." : ""}
                    </span>
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
