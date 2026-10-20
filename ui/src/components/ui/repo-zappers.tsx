"use client";

import { useEffect } from "react";

import { useNostrContext } from "@/lib/nostr/NostrContext";
import { pickProfileDisplayName } from "@/lib/nostr/kind0-profile-fields";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import { useRepoNip57ZapBadgeTotal } from "@/lib/nostr/useRepoNip57ZapBadgeTotal";

import { Zap } from "lucide-react";
import Link from "next/link";
import { nip19 } from "nostr-tools";

export function RepoZappers({
  ownerHex,
  entity,
  repo,
}: {
  ownerHex: string;
  entity: string;
  repo: string;
}) {
  const { subscribe, defaultRelays } = useNostrContext();
  const badge = useRepoNip57ZapBadgeTotal({
    ownerHex,
    entity,
    repo,
    subscribe,
    defaultRelays,
    enabled: !!ownerHex,
  });
  const metadata = useContributorMetadata(badge.zappers.map((z) => z.pubkey));

  useEffect(() => {
    if (typeof window === "undefined") return;
    const flag = new URLSearchParams(window.location.search).get("zap");
    if (flag !== "true") return;
    document
      .getElementById("repo-zaps")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [badge.zappers.length]);

  if (badge.zappers.length === 0) return null;

  return (
    <div className="mt-3">
      <p className="text-xs text-gray-400 mb-2">
        {badge.zappers.length === 1
          ? "1 person zapped this repo"
          : `${badge.zappers.length} people zapped this repo`}
        {badge.totalSats > 0
          ? ` · ${badge.totalSats.toLocaleString()} sats`
          : ""}
      </p>
      <ul className="space-y-1">
        {badge.zappers.map((zapper) => {
          const name =
            pickProfileDisplayName(metadata[zapper.pubkey]) ||
            `${zapper.pubkey.slice(0, 8)}…`;
          let href = `/${zapper.pubkey.slice(0, 8)}`;
          try {
            href = `/${nip19.npubEncode(zapper.pubkey)}`;
          } catch {
            /* keep prefix */
          }
          return (
            <li
              key={zapper.pubkey}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <Link
                href={href}
                className="text-purple-300 hover:underline truncate"
              >
                {name}
              </Link>
              <span className="shrink-0 text-amber-300/90 tabular-nums inline-flex items-center gap-1">
                <Zap className="h-3 w-3" />
                {zapper.totalSats.toLocaleString()}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
