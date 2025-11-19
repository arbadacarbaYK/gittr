/**
 * Resolves the receive wallet for a repository zap
 * Priority order:
 * 1. Repo-specific wallet config (from repo settings)
 * 2. Owner's Nostr profile (lud16, lnurl, nwcRecv from metadata)
 * 3. Owner's user settings (fallback, if we can access them)
 */

import { Metadata } from "@/lib/nostr/useContributorMetadata";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";
import { type StoredRepo } from "@/lib/repos/storage";
import { getSecureItem } from "@/lib/security/encryptedStorage";

export interface ResolvedRepoWallet {
  // Receive wallets (where zaps go TO)
  lud16?: string;
  lnurl?: string;
  nwcRecv?: string;
  
  // Send wallets (for splits - where zaps come FROM)
  lnbitsUrl?: string;
  lnbitsAdminKey?: string;
  nwcSend?: string;
  
  source: "repo-config" | "owner-profile" | "owner-settings" | "none";
}

/**
 * Resolve receive wallet for repo zap
 */
export async function resolveRepoReceiveWallet(
  entity: string,
  repo: string,
  ownerPubkey?: string,
  ownerMetadata?: Metadata
): Promise<{ lud16?: string; lnurl?: string; nwcRecv?: string; source: "repo-config" | "owner-profile" | "owner-settings" | "none" }> {
  // Priority 1: Check repo-specific wallet config
  try {
    const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
    const repoData = findRepoByEntityAndName<StoredRepo>(repos, entity, repo);
    const repoWithWallet = repoData as StoredRepo & { walletConfig?: { lnurl?: string; lnaddress?: string; nwcRecv?: string; lnbitsUrl?: string; lnbitsAdminKey?: string; nwcSend?: string } };
    
    if (repoWithWallet?.walletConfig) {
      const config = repoWithWallet.walletConfig;
      
      // Check receiving wallets (priority: lnaddress -> lnurl -> nwcRecv)
      if (config.lnaddress) {
        return { lud16: config.lnaddress, source: "repo-config" as const };
      }
      if (config.lnurl) {
        return { lnurl: config.lnurl, source: "repo-config" as const };
      }
      if (config.nwcRecv) {
        return { nwcRecv: config.nwcRecv, source: "repo-config" as const };
      }
    }
  } catch (error) {
    console.error("Error reading repo wallet config:", error);
  }

  // Priority 2: Check owner's Nostr profile metadata
  if (ownerMetadata) {
    if (ownerMetadata.lud16) {
      return { lud16: ownerMetadata.lud16, source: "owner-profile" as const };
    }
    if (ownerMetadata.lnurl) {
      return { lnurl: ownerMetadata.lnurl, source: "owner-profile" as const };
    }
    // NWC receive from profile (less common, but possible)
    const profileJson = typeof ownerMetadata === "object" ? ownerMetadata : {};
    if ((profileJson as any).nwcRecv) {
      return { nwcRecv: (profileJson as any).nwcRecv, source: "owner-profile" as const };
    }
  }

  // Priority 3: Check owner's user settings (if owner is current user)
  // This is a fallback - we can't access other users' settings
  try {
    if (ownerPubkey) {
      const currentUserPubkey = localStorage.getItem("nostr:session")
        ? JSON.parse(localStorage.getItem("nostr:session") || "{}").pubkey
        : null;
      
      if (currentUserPubkey === ownerPubkey) {
        // Current user owns the repo - can use their settings (encrypted if encryption is enabled)
        try {
          const [lud16, lnurl, nwcRecv] = await Promise.all([
            getSecureItem("gittr_lud16"),
            getSecureItem("gittr_lnurl"),
            getSecureItem("gittr_nwc_recv"),
          ]);
          
          if (lud16) return { lud16, source: "owner-settings" as const };
          if (lnurl) return { lnurl, source: "owner-settings" as const };
          if (nwcRecv) return { nwcRecv, source: "owner-settings" as const };
        } catch (error) {
          // Fallback to plaintext for backward compatibility
          const lud16 = localStorage.getItem("gittr_lud16");
          const lnurl = localStorage.getItem("gittr_lnurl");
          const nwcRecv = localStorage.getItem("gittr_nwc_recv");
          
          if (lud16) return { lud16, source: "owner-settings" as const };
          if (lnurl) return { lnurl, source: "owner-settings" as const };
          if (nwcRecv) return { nwcRecv, source: "owner-settings" as const };
        }
      }
    }
  } catch (error) {
    console.error("Error reading owner settings:", error);
  }

  return { source: "none" };
}

/**
 * Resolve send wallet for repo splits
 */
export async function resolveRepoSendWallet(
  entity: string,
  repo: string
): Promise<{ lnbitsUrl?: string; lnbitsAdminKey?: string; nwcSend?: string; source: "repo-config" | "owner-settings" | "none" }> {
  // Priority 1: Check repo-specific wallet config
  try {
    const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
    const repoData = findRepoByEntityAndName<StoredRepo>(repos, entity, repo);
    const repoWithWallet = repoData as StoredRepo & { walletConfig?: { lnurl?: string; lnaddress?: string; nwcRecv?: string; lnbitsUrl?: string; lnbitsAdminKey?: string; nwcSend?: string } };
    
    if (repoWithWallet?.walletConfig) {
      const config = repoWithWallet.walletConfig;
      if (config.lnbitsUrl && config.lnbitsAdminKey) {
        return { 
          lnbitsUrl: config.lnbitsUrl, 
          lnbitsAdminKey: config.lnbitsAdminKey, 
          source: "repo-config" as const
        };
      }
      if (config.nwcSend) {
        return { nwcSend: config.nwcSend, source: "repo-config" as const };
      }
    }
  } catch (error) {
    console.error("Error reading repo wallet config:", error);
  }

  // Priority 2: Use user's default settings (for splits, use sender's wallet) - encrypted if encryption is enabled
  try {
    try {
      const [lnbitsUrl, lnbitsAdminKey, nwcSend] = await Promise.all([
        getSecureItem("gittr_lnbits_url"),
        getSecureItem("gittr_lnbits_admin_key"),
        getSecureItem("gittr_nwc_send"),
      ]);
      
      if (lnbitsUrl && lnbitsAdminKey) {
        return { lnbitsUrl, lnbitsAdminKey, source: "owner-settings" as const };
      }
      if (nwcSend) {
        return { nwcSend, source: "owner-settings" as const };
      }
    } catch (error) {
      // Fallback to plaintext for backward compatibility
      const lnbitsUrl = localStorage.getItem("gittr_lnbits_url");
      const lnbitsAdminKey = localStorage.getItem("gittr_lnbits_admin_key");
      const nwcSend = localStorage.getItem("gittr_nwc_send");
      
      if (lnbitsUrl && lnbitsAdminKey) {
        return { lnbitsUrl, lnbitsAdminKey, source: "owner-settings" as const };
      }
      if (nwcSend) {
        return { nwcSend, source: "owner-settings" as const };
      }
    }
  } catch (error) {
    console.error("Error reading user settings:", error);
  }

  return { source: "none" };
}

/**
 * Complete wallet resolution for a repo
 */
export async function resolveRepoWallet(
  entity: string,
  repo: string,
  ownerPubkey?: string,
  ownerMetadata?: Metadata
): Promise<ResolvedRepoWallet> {
  const receive = await resolveRepoReceiveWallet(entity, repo, ownerPubkey, ownerMetadata);
  const send = await resolveRepoSendWallet(entity, repo);
  
  const finalSource: "repo-config" | "owner-profile" | "owner-settings" | "none" = 
    receive.source !== "none" ? receive.source : (send.source !== "none" ? send.source : "none");
  
  return {
    ...receive,
    ...send,
    source: finalSource,
  };
}

