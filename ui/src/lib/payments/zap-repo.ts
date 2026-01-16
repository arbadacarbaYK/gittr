// Utilities for repo zap splitting logic
import {
  type Metadata,
  useContributorMetadata,
} from "@/lib/nostr/useContributorMetadata";

export interface ContributorWithAddress {
  pubkey: string;
  name?: string;
  picture?: string;
  weight: number;
  lud16?: string;
  lnurl?: string;
  nwcRecv?: string;
}

export interface ZapSplitConfig {
  mode: "owner-only" | "auto-split"; // Owner-only or split to contributors
  ownerPubkey: string;
  contributors: ContributorWithAddress[];
}

/**
 * Calculate split amounts for contributors
 * Returns split percentages that sum to 100%
 * Fees are handled by LNbits backend
 */
export function calculateSplitWeights(
  contributors: ContributorWithAddress[]
): Array<{ pubkey: string; weight: number }> {
  if (contributors.length === 0) return [];

  // Equal split: 100% / number of contributors
  const weightPerContributor = Math.floor(100 / contributors.length);
  const remainder = 100 - weightPerContributor * contributors.length;

  return contributors.map((c, idx) => ({
    pubkey: c.pubkey,
    weight: weightPerContributor + (idx === 0 ? remainder : 0), // Give remainder to first contributor
  }));
}

/**
 * Get contributors who have Lightning receive addresses
 * Checks lud16, lnurl, or nwcRecv from Nostr metadata
 */
export function getContributorsWithAddresses(
  contributors: Array<{
    pubkey?: string;
    name?: string;
    picture?: string;
    weight: number;
  }>,
  metadataMap: Record<string, Metadata>
): ContributorWithAddress[] {
  return contributors
    .filter((c): c is ContributorWithAddress & { pubkey: string } => {
      if (!c.pubkey) return false;
      const meta = metadataMap[c.pubkey];
      // Has at least one Lightning address
      return !!(meta?.lud16 || meta?.lnurl || meta?.nwcRecv);
    })
    .map((c) => {
      const meta = metadataMap[c.pubkey!];
      return {
        pubkey: c.pubkey!,
        name: c.name || meta?.name || meta?.display_name,
        picture: c.picture || meta?.picture,
        weight: c.weight,
        lud16: meta?.lud16,
        lnurl: meta?.lnurl,
        nwcRecv: meta?.nwcRecv,
      };
    });
}

/**
 * Store accumulated zap for repo (owner receives)
 * Used for manual splitting later
 */
export function recordAccumulatedZap(
  repoId: string,
  amount: number,
  paymentHash: string,
  comment?: string
): void {
  if (typeof window === "undefined") return;

  try {
    const key = `gittr_accumulated_zaps__${repoId}`;
    const existing = JSON.parse(localStorage.getItem(key) || "[]");
    existing.push({
      amount,
      paymentHash,
      comment,
      createdAt: Date.now(),
      status: "received", // Will be "split" when distributed
    });
    localStorage.setItem(key, JSON.stringify(existing));
  } catch {}
}

/**
 * Get accumulated zaps for a repo
 */
export function getAccumulatedZaps(repoId: string): Array<{
  amount: number;
  paymentHash: string;
  comment?: string;
  createdAt: number;
  status: "received" | "split";
}> {
  if (typeof window === "undefined") return [];

  try {
    const key = `gittr_accumulated_zaps__${repoId}`;
    return JSON.parse(localStorage.getItem(key) || "[]");
  } catch {
    return [];
  }
}
