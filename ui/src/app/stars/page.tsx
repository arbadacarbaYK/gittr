"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { getAllRelays } from "@/lib/nostr/getAllRelays";
import { aggregateMyStarredRepoEventIds } from "@/lib/nostr/repo-stars";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import useSession from "@/lib/nostr/useSession";

import { Star } from "lucide-react";
import Link from "next/link";
import { type Event as NostrEvent, nip19 } from "nostr-tools";

type StarredRepo = {
  slug: string;
  entity?: string;
  repo?: string;
  name: string;
  sourceUrl?: string;
  createdAt?: number;
  entityDisplayName?: string;
  logoUrl?: string;
};

export default function StarsPage() {
  const { isLoggedIn } = useSession();
  const { pubkey, subscribe, defaultRelays } = useNostrContext();
  const [myStarEvents, setMyStarEvents] = useState<NostrEvent[]>([]);
  const [allRepos, setAllRepos] = useState<any[]>([]);
  const [repoListVersion, setRepoListVersion] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const bump = () => setRepoListVersion((v) => v + 1);
    if (typeof window === "undefined") return;
    window.addEventListener("gittr:repos-updated", bump);
    window.addEventListener("gittr:stars-updated", bump);
    return () => {
      window.removeEventListener("gittr:repos-updated", bump);
      window.removeEventListener("gittr:stars-updated", bump);
    };
  }, []);

  useEffect(() => {
    if (!isLoggedIn) return;
    try {
      setAllRepos(
        JSON.parse(localStorage.getItem("gittr_repos") || "[]") as any[]
      );
    } catch {
      setAllRepos([]);
    }
  }, [isLoggedIn, repoListVersion]);

  useEffect(() => {
    if (!isLoggedIn || !pubkey || !subscribe || !defaultRelays?.length) {
      setMyStarEvents([]);
      return;
    }
    setMyStarEvents([]);
    const collected = new Map<string, NostrEvent>();
    const relays = getAllRelays(defaultRelays);
    const unsub = subscribe(
      [
        {
          kinds: [7],
          authors: [pubkey],
          "#k": ["30617"],
          limit: 500,
        },
      ],
      relays,
      (event) => {
        if (event.kind !== 7) return;
        collected.set(event.id, event as NostrEvent);
        setMyStarEvents(Array.from(collected.values()));
      },
      undefined,
      undefined,
      {}
    );
    return () => {
      try {
        unsub?.();
      } catch {
        /* ignore */
      }
    };
  }, [isLoggedIn, pubkey, subscribe, defaultRelays]);

  const starredRepos = useMemo(() => {
    if (!isLoggedIn || !pubkey) return [];

    let localStarredIds: string[] = [];
    try {
      localStarredIds = JSON.parse(
        localStorage.getItem("gittr_starred_repos") || "[]"
      ) as string[];
    } catch {
      localStarredIds = [];
    }

    const deletedRepos = JSON.parse(
      localStorage.getItem("gittr_deleted_repos") || "[]"
    ) as Array<{ entity: string; repo: string; deletedAt: number }>;
    const deletedReposSet = new Set(
      deletedRepos.map((d) => `${d.entity}/${d.repo}`.toLowerCase())
    );

    const isRepoDeleted = (r: any): boolean => {
      const repo = r.repo || r.slug || "";
      const entity = r.entity || "";
      const repoKey = `${entity}/${repo}`.toLowerCase();
      if (deletedReposSet.has(repoKey)) return true;
      if (r.deleted === true || r.archived === true) return true;
      return false;
    };

    const nostrIds = new Set(
      aggregateMyStarredRepoEventIds(myStarEvents, pubkey)
    );
    const byKey = new Map<string, StarredRepo>();

    for (const r of allRepos) {
      if (isRepoDeleted(r)) continue;
      const eid = r.nostrEventId || r.lastNostrEventId;
      const entity = r.entity || "";
      const repoName = r.repo || r.slug || "";
      if (!entity || !repoName) continue;
      const key = `${entity}/${repoName}`.toLowerCase();
      if (eid && nostrIds.has(eid)) {
        if (!byKey.has(key)) {
          byKey.set(key, {
            slug: r.slug || `${entity}/${repoName}`,
            entity,
            repo: repoName,
            name: r.name || repoName,
            sourceUrl: r.sourceUrl,
            createdAt: r.createdAt,
            entityDisplayName: r.entityDisplayName,
            logoUrl: r.logoUrl,
          });
        }
      }
    }

    for (const starredId of localStarredIds) {
      const key = starredId.toLowerCase();
      if (byKey.has(key)) continue;

      const repo = allRepos.find((r: any) => {
        const rid = r.entity && r.repo ? `${r.entity}/${r.repo}` : r.slug || "";
        return rid === starredId || r.slug === starredId;
      });

      if (repo && !isRepoDeleted(repo)) {
        byKey.set(key, {
          slug: repo.slug || starredId,
          entity: repo.entity,
          repo: repo.repo,
          name: repo.name || repo.repo || starredId,
          sourceUrl: repo.sourceUrl,
          createdAt: repo.createdAt,
          entityDisplayName: repo.entityDisplayName,
          logoUrl: repo.logoUrl,
        });
      } else {
        const [entity, repoName] = starredId.split("/");
        const repoKey = `${entity}/${repoName || starredId}`.toLowerCase();
        if (!deletedReposSet.has(repoKey)) {
          byKey.set(key, {
            slug: starredId,
            entity,
            repo: repoName || starredId,
            name: repoName || starredId,
          });
        }
      }
    }

    return Array.from(byKey.values());
  }, [isLoggedIn, pubkey, myStarEvents, allRepos]);

  const ownerPubkeys = useMemo(() => {
    if (typeof window === "undefined") return [];
    const pubkeys = new Set<string>();
    for (const repo of starredRepos) {
      if (!repo.entity || repo.entity === "user") continue;
      try {
        const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
        const matchingRepo = repos.find(
          (r: any) =>
            r.slug === repo.slug ||
            (r.entity === repo.entity &&
              (r.repo === repo.repo || r.slug === repo.slug))
        );
        if (
          matchingRepo?.ownerPubkey &&
          /^[0-9a-f]{64}$/i.test(matchingRepo.ownerPubkey)
        ) {
          pubkeys.add(matchingRepo.ownerPubkey);
        } else if (/^[0-9a-f]{64}$/i.test(repo.entity)) {
          pubkeys.add(repo.entity);
        } else if (repo.entity.startsWith("npub")) {
          try {
            const decoded = nip19.decode(repo.entity);
            if (decoded.type === "npub") {
              pubkeys.add(decoded.data as string);
            }
          } catch {}
        }
      } catch {}
    }
    return Array.from(pubkeys);
  }, [starredRepos]);

  const ownerMetadata = useContributorMetadata(ownerPubkeys);

  const getRepoIcon = (repo: StarredRepo): string | null => {
    if (repo.logoUrl) return repo.logoUrl;
    if (typeof window === "undefined") return null;

    try {
      const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
      const matchingRepo = repos.find(
        (r: any) =>
          r.slug === repo.slug ||
          (r.entity === repo.entity &&
            (r.repo === repo.repo || r.slug === repo.slug))
      );

      if (
        matchingRepo?.ownerPubkey &&
        /^[0-9a-f]{64}$/i.test(matchingRepo.ownerPubkey)
      ) {
        const normalizedKey = matchingRepo.ownerPubkey.toLowerCase();
        const meta =
          ownerMetadata[normalizedKey] ||
          ownerMetadata[matchingRepo.ownerPubkey];
        if (meta?.picture) return meta.picture;
      }

      if (matchingRepo?.files && Array.isArray(matchingRepo.files)) {
        const logoFiles = matchingRepo.files
          .map((f: any) => f.path)
          .filter((p: string) => {
            const fileName = p.split("/").pop() || "";
            const baseName = fileName.replace(/\.[^.]+$/, "").toLowerCase();
            const extension = fileName.split(".").pop()?.toLowerCase() || "";
            const imageExts = [
              "png",
              "jpg",
              "jpeg",
              "gif",
              "webp",
              "svg",
              "ico",
            ];
            return (
              baseName.includes("logo") &&
              !baseName.includes("logo-alby") &&
              !baseName.includes("alby-logo") &&
              imageExts.includes(extension)
            );
          });
        if (logoFiles.length > 0 && matchingRepo.sourceUrl) {
          try {
            const url = new URL(matchingRepo.sourceUrl);
            if (url.hostname === "github.com") {
              const parts = url.pathname.split("/").filter(Boolean);
              if (parts.length >= 2 && parts[0] && parts[1]) {
                const owner = parts[0];
                const repoName = parts[1].replace(/\.git$/, "");
                const branch = matchingRepo.defaultBranch || "main";
                return `https://raw.githubusercontent.com/${owner}/${repoName}/${encodeURIComponent(
                  branch
                )}/${logoFiles[0]}`;
              }
            }
          } catch {}
        }
      }
    } catch {}

    if (repo.entity && /^[0-9a-f]{64}$/i.test(repo.entity)) {
      const normalizedKey = repo.entity.toLowerCase();
      const meta = ownerMetadata[normalizedKey] || ownerMetadata[repo.entity];
      if (meta?.picture) return meta.picture;
    }

    return null;
  };

  if (!mounted) {
    return (
      <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
        <h1 className="text-2xl font-bold mb-4">Your Stars</h1>
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
        <h1 className="text-2xl font-bold mb-4">Your Stars</h1>
        <p className="text-gray-400">
          Please sign in to view your starred repositories.
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
      <h1 className="text-2xl font-bold mb-4 flex items-center gap-2">
        <Star className="h-6 w-6 text-yellow-500 fill-yellow-500" />
        Your Stars
      </h1>
      <p className="text-sm text-gray-400 mb-6 max-w-2xl">
        Repos you star with NIP-25 (kind 7,{" "}
        <code className="text-gray-300">#k</code> 30617) on relays. Entries are
        matched to repos stored in this browser (by 30617 event id). The local
        list updates when you star or unstar on a repo page.
      </p>

      {starredRepos.length === 0 ? (
        <div className="border border-[#383B42] rounded p-8 text-center">
          <Star className="h-12 w-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 mb-2">
            You haven&apos;t starred any repositories on Nostr yet.
          </p>
          <Link href="/explore">
            <Button variant="outline" className="mt-4">
              Browse repos
            </Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {starredRepos.map((repo) => {
            const entity = repo.entity || "";
            const repoSlug = repo.repo || repo.slug || "";
            const href = entity && repoSlug ? `/${entity}/${repoSlug}` : "#";
            const iconUrl = getRepoIcon(repo);

            return (
              <Link
                key={repo.slug}
                href={href}
                className="border border-[#383B42] rounded p-4 hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {iconUrl ? (
                    <img
                      src={iconUrl}
                      alt="repo"
                      className="h-6 w-6 rounded-sm object-contain flex-shrink-0"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  ) : (
                    <span className="inline-block h-6 w-6 rounded-sm bg-[#22262C] flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{repo.name}</div>
                    <div className="text-sm text-gray-400 truncate">
                      {repo.entityDisplayName || entity || "Unknown"} /{" "}
                      {repoSlug}
                    </div>
                    {repo.sourceUrl ? (
                      <div className="text-xs text-gray-500 truncate mt-0.5">
                        {repo.sourceUrl.replace(/^https?:\/\//, "")}
                      </div>
                    ) : null}
                  </div>
                  <Star className="h-4 w-4 text-yellow-500 fill-yellow-500 flex-shrink-0" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
