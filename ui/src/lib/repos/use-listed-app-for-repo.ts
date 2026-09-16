"use client";

import { useEffect, useState } from "react";

import {
  type ListedAppLike,
  pickListedAppForRepo,
} from "@/lib/repos/listed-app-for-repo";

type CatalogPayload = {
  apps?: ListedAppLike[];
};

export type ListedAppRef = { appId: string; name: string };

/** Author-scoped NIP-82 app for this Code-tab repo, or null. */
export function useListedAppForRepo(opts: {
  ownerPubkeyHex: string;
  repoName: string;
  entity: string;
}): ListedAppRef | null {
  const owner = (opts.ownerPubkeyHex || "").trim().toLowerCase();
  const repo = (opts.repoName || "").trim();
  const entity = opts.entity || "";
  const [app, setApp] = useState<ListedAppRef | null>(null);

  useEffect(() => {
    if (!owner || !/^[0-9a-f]{64}$/.test(owner) || !repo) {
      setApp(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/nostr/software-catalog?author=${encodeURIComponent(owner)}`
        );
        if (!res.ok) return;
        const data = (await res.json()) as CatalogPayload;
        if (cancelled) return;
        const match = pickListedAppForRepo(data.apps, {
          ownerPubkeyHex: owner,
          repoName: repo,
          entity,
        });
        const appId = match?.appId?.trim() || "";
        const name = match?.name?.trim() || "";
        setApp(appId ? { appId, name: name || appId } : null);
      } catch {
        if (!cancelled) setApp(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [owner, repo, entity]);

  return app;
}
