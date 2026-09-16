"use client";

import { useEffect, useState } from "react";

import {
  type ListedAppLike,
  pickListedAppForRepo,
} from "@/lib/repos/listed-app-for-repo";

type CatalogPayload = {
  apps?: ListedAppLike[];
};

/** Author-scoped NIP-82 app id for this Code-tab repo, or null. */
export function useListedAppIdForRepo(opts: {
  ownerPubkeyHex: string;
  repoName: string;
  entity: string;
}): string | null {
  const owner = (opts.ownerPubkeyHex || "").trim().toLowerCase();
  const repo = (opts.repoName || "").trim();
  const entity = opts.entity || "";
  const [appId, setAppId] = useState<string | null>(null);

  useEffect(() => {
    if (!owner || !/^[0-9a-f]{64}$/.test(owner) || !repo) {
      setAppId(null);
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
        setAppId(match?.appId?.trim() || null);
      } catch {
        if (!cancelled) setAppId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [owner, repo, entity]);

  return appId;
}
