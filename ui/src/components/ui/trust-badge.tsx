"use client";

import { cn } from "@/lib/utils";
import { useWoTDistance } from "@/lib/nostr/useWoTDistance";
import { wotBadgeClassName, wotLabel } from "@/lib/nostr/wot";

import { Network } from "lucide-react";

type TrustBadgeProps = {
  targetPubkey: string | null | undefined;
  className?: string;
  /** When false, nothing is rendered for logged-out viewers. */
  showWhenLoggedOut?: boolean;
  /** compact = icon + short text on sm+; inline = text only */
  size?: "sm" | "md";
};

export function TrustBadge({
  targetPubkey,
  className,
  showWhenLoggedOut = false,
  size = "sm",
}: TrustBadgeProps) {
  const wot = useWoTDistance(targetPubkey);

  if (wot.status === "idle" || wot.status === "self") return null;

  if (wot.status === "logged_out") {
    if (!showWhenLoggedOut) return null;
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium text-gray-500",
          "border-gray-700/80 bg-transparent",
          className
        )}
        title="Sign in to see Web of Trust distance"
      >
        —
      </span>
    );
  }

  if (wot.status === "loading") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded border border-gray-700/60 px-1.5 py-0.5 text-[10px] text-gray-500",
          className
        )}
        aria-busy="true"
        title="Loading trust distance"
      >
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-gray-600" />
        {size === "md" ? <span className="hidden sm:inline">…</span> : null}
      </span>
    );
  }

  const hops = wot.result?.hops ?? null;
  const label = wotLabel(hops);
  if (!label) return null;

  const mutual = wot.result?.mutual;
  const title = mutual
    ? `${label} (mutual follow)`
    : `${label} · Web of Trust`;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-medium leading-none",
        size === "md" ? "text-xs" : "text-[10px]",
        wotBadgeClassName(hops),
        className
      )}
      title={title}
    >
      <Network
        className={cn("shrink-0 opacity-80", size === "md" ? "h-3.5 w-3.5" : "h-3 w-3")}
        aria-hidden
      />
      <span>{label}</span>
    </span>
  );
}
