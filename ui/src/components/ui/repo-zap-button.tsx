"use client";

import { useEffect, useMemo, useState } from "react";

import { ZapButton } from "@/components/ui/zap-button";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import { resolveRepoReceiveWallet } from "@/lib/payments/resolve-repo-wallet";
import {
  calculateSplitWeights,
  getContributorsWithAddresses,
} from "@/lib/payments/zap-repo";

import { User, Users } from "lucide-react";
import { nip19 } from "nostr-tools";

interface RepoZapButtonProps {
  repoId: string; // entity/repo
  ownerPubkey: string;
  contributors?: Array<{
    pubkey?: string;
    name?: string;
    picture?: string;
    weight: number;
  }>;
  amount?: number;
  comment?: string;
}

export function RepoZapButton({
  repoId,
  ownerPubkey,
  contributors = [],
  amount = 10, // Use 2-10 sats for testing (LNbits ~300 sats, NWC ~84 sats)
  comment,
}: RepoZapButtonProps) {
  const { pubkey: currentUserPubkey } = useNostrContext();
  const [zapMode, setZapMode] = useState<"owner-only" | "auto-split">(
    "owner-only"
  );

  // Parse repoId to get entity and repo
  const [entity, repo] = repoId.split("/");

  /** `metadataMap` keys are always lowercase hex */
  const ownerHex = useMemo(() => {
    if (!ownerPubkey) return "";
    try {
      if (ownerPubkey.startsWith("npub")) {
        return (nip19.decode(ownerPubkey).data as string).toLowerCase();
      }
      if (/^[0-9a-f]{64}$/i.test(ownerPubkey)) {
        return ownerPubkey.toLowerCase();
      }
    } catch {
      return "";
    }
    return "";
  }, [ownerPubkey]);

  // Get all contributor pubkeys (including owner)
  const contributorPubkeys = useMemo(() => {
    const pubkeys = contributors
      .map((c) => c.pubkey)
      .filter((p): p is string => !!p);
    // Ensure owner is included
    if (ownerPubkey && !pubkeys.includes(ownerPubkey)) {
      return [ownerPubkey, ...pubkeys];
    }
    return pubkeys;
  }, [contributors, ownerPubkey]);

  // Fetch Nostr metadata for all contributors to get Lightning addresses
  const metadataMap = useContributorMetadata(contributorPubkeys);

  const ownerProfileMeta = ownerHex ? metadataMap[ownerHex] : undefined;

  // Resolve repo receive wallet (priority: owner profile -> owner settings -> repo config)
  const [repoWallet, setRepoWallet] = useState<{
    lud16?: string;
    lnurl?: string;
    nwcRecv?: string;
    source: "repo-config" | "owner-profile" | "owner-settings" | "none";
  }>({ source: "none" });

  useEffect(() => {
    if (!entity || !repo || !ownerPubkey) {
      setRepoWallet({ source: "none" });
      return;
    }
    resolveRepoReceiveWallet(
      entity,
      repo,
      ownerHex || ownerPubkey,
      ownerProfileMeta,
      currentUserPubkey || undefined
    )
      .then(setRepoWallet)
      .catch((error) => {
        console.error("Failed to resolve repo wallet:", error);
        setRepoWallet({ source: "none" });
      });
  }, [
    entity,
    repo,
    ownerPubkey,
    ownerHex,
    ownerProfileMeta,
    currentUserPubkey,
  ]);

  // Filter contributors who have Lightning receive addresses
  const contributorsWithAddresses = useMemo(() => {
    return getContributorsWithAddresses(contributors, metadataMap);
  }, [contributors, metadataMap]);

  // Contributors missing a Lightning address or GitHub→Nostr claim
  const excludedContributors = useMemo(() => {
    const withAddrPubkeys = new Set(
      contributorsWithAddresses.map((c) => c.pubkey)
    );
    return contributors.filter(
      (c) => !c.pubkey || !withAddrPubkeys.has(c.pubkey)
    );
  }, [contributors, contributorsWithAddresses]);

  const splitWeights = useMemo(() => {
    if (zapMode === "auto-split" && contributorsWithAddresses.length > 0) {
      return calculateSplitWeights(contributorsWithAddresses);
    }
    return undefined;
  }, [zapMode, contributorsWithAddresses]);

  /** Same merge as `recipientMetadata` below — used so we never show a false "no wallet" while an invoice is possible */
  const effectiveReceive = useMemo(() => {
    if (repoWallet.source !== "none") {
      return {
        lud16: repoWallet.lud16,
        lnurl: repoWallet.lnurl,
        nwcRecv: repoWallet.nwcRecv,
      };
    }
    return {
      lud16: repoWallet.lud16 ?? ownerProfileMeta?.lud16,
      lnurl: repoWallet.lnurl ?? ownerProfileMeta?.lnurl,
      nwcRecv: repoWallet.nwcRecv ?? ownerProfileMeta?.nwcRecv,
    };
  }, [repoWallet, ownerProfileMeta]);

  const hasEffectiveReceive = useMemo(() => {
    return !!(
      effectiveReceive.lud16?.trim() ||
      effectiveReceive.lnurl?.trim() ||
      effectiveReceive.nwcRecv?.trim()
    );
  }, [effectiveReceive]);

  const modalExtra = (
    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
      {ownerHex && !hasEffectiveReceive && (
        <div
          className="text-xs text-slate-200 mb-2 p-2 bg-slate-800/80 rounded border border-slate-600"
          role="note"
        >
          No Lightning receive address was found for this repository (owner
          profile <code className="text-slate-300">lud16</code> /{" "}
          <code className="text-slate-300">lnurl</code>, or Repo Settings →
          Payment configuration). Without one, zaps cannot be routed to a
          wallet.
        </div>
      )}
      {contributorsWithAddresses.length > 0 && (
        <div
          className="flex gap-2 items-center text-xs text-gray-300 mb-2"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setZapMode("owner-only");
            }}
            className={`px-2 py-1 rounded border ${
              zapMode === "owner-only"
                ? "bg-purple-600 text-white border-purple-500"
                : "border-gray-600 hover:border-gray-500"
            }`}
          >
            <User className="inline h-3 w-3 mr-1" />
            Owner only
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setZapMode("auto-split");
            }}
            className={`px-2 py-1 rounded border ${
              zapMode === "auto-split"
                ? "bg-purple-600 text-white border-purple-500"
                : "border-gray-600 hover:border-gray-500"
            }`}
          >
            <Users className="inline h-3 w-3 mr-1" />
            Split ({contributorsWithAddresses.length})
          </button>
          {zapMode === "auto-split" && splitWeights && (
            <span className="text-xs text-gray-400 ml-2">
              ~{Math.floor(100 / splitWeights.length)}% each
            </span>
          )}
        </div>
      )}

      {zapMode === "auto-split" && contributorsWithAddresses.length > 0 && (
        <div className="text-xs mt-1 p-3 rounded border bg-[#0D1117] border-[#2B2F36] text-gray-200">
          <p className="mb-1">
            Will split equally among {contributorsWithAddresses.length}{" "}
            contributor{contributorsWithAddresses.length !== 1 ? "s" : ""}:
          </p>
          <ul className="list-disc list-inside space-y-1">
            {contributorsWithAddresses.map((c) => {
              const splitWeight =
                splitWeights?.find((s) => s.pubkey === c.pubkey)?.weight || 0;
              return (
                <li key={c.pubkey} className="text-xs">
                  {c.name || c.pubkey.slice(0, 8)}... ({splitWeight}%)
                </li>
              );
            })}
          </ul>
          {excludedContributors.length > 0 && (
            <div className="mt-3 rounded-md border border-yellow-700 bg-yellow-900/20 px-3 py-2 text-yellow-200">
              <p className="font-medium mb-1">
                Why only {contributorsWithAddresses.length}?
              </p>
              <ul className="list-disc list-inside space-y-1">
                {excludedContributors.map((c, idx) => (
                  <li key={(c.pubkey || c.name || String(idx)) + "-excluded"}>
                    {c.name || c.pubkey?.slice(0, 8) || "Unknown"} – no
                    Lightning receive address yet
                    {!c.pubkey ? " (unclaimed GitHub import)" : ""}.
                  </li>
                ))}
              </ul>
              <p className="mt-1">
                Contributors can claim their profile and add a Lightning address
                in Settings → Account to be included.
              </p>
            </div>
          )}
          <p className="mt-2 text-xs text-gray-400">
            <strong>Important:</strong> Before using split payments, configure
            SplitPayments extension in your LNbits wallet (Extensions →
            SplitPayments). Add {contributorsWithAddresses.length} targets
            matching these contributors' Lightning addresses.
            LNURL-pay/Lightning addresses must allow comments &gt; 100 chars and
            flexible amounts. A fee_reserve is automatically subtracted for
            routing fees on LNURL splits. If any split fails, remainder goes to
            owner.
          </p>
        </div>
      )}
    </div>
  );

  // Prepare recipient metadata with resolved wallet (must match `effectiveReceive`)
  const recipientMetadata = useMemo(() => {
    return { ...effectiveReceive };
  }, [effectiveReceive]);

  return (
    <div className="space-y-2">
      <ZapButton
        key={zapMode} // Force re-render when mode changes
        recipient={ownerPubkey}
        amount={amount}
        comment={comment || `Zap for ${repoId}`}
        splits={zapMode === "auto-split" ? splitWeights : undefined}
        modalExtra={modalExtra}
        recipientMetadata={recipientMetadata}
        nip57ProfileZap={zapMode === "owner-only"}
        splitSendContext={entity && repo ? { entity, repo } : undefined}
      />
    </div>
  );
}
