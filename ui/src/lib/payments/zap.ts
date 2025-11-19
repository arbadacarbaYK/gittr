// Payment utilities for zaps, bounties, and LNbits/NWC integration

import { getSecureItem } from "@/lib/security/encryptedStorage";

export interface ZapConfig {
  lnurl?: string;
  lud16?: string;
  nwcRecv?: string;
  nwcSend?: string;
}

export interface ZapSplit {
  pubkey: string;
  weight: number; // percentage (0-100)
}

export interface ZapRequest {
  amount: number; // sats
  recipient: string; // npub or pubkey
  comment?: string;
  relays?: string[];
  splits?: ZapSplit[]; // For repo zaps
}

// Get zap config from secure storage (encrypted if encryption is enabled)
export async function getZapConfig(): Promise<ZapConfig> {
  if (typeof window === "undefined") return {};
  try {
    const [lnurl, lud16, nwcRecv, nwcSend] = await Promise.all([
      getSecureItem("gittr_lnurl"),
      getSecureItem("gittr_lud16"),
      getSecureItem("gittr_nwc_recv"),
      getSecureItem("gittr_nwc_send"),
    ]);
    return {
      lnurl: lnurl || undefined,
      lud16: lud16 || undefined,
      nwcRecv: nwcRecv || undefined,
      nwcSend: nwcSend || undefined,
    };
  } catch (error) {
    console.error("Failed to load zap config:", error);
    // Fallback to plaintext for backward compatibility
    return {
      lnurl: localStorage.getItem("gittr_lnurl") || undefined,
      lud16: localStorage.getItem("gittr_lud16") || undefined,
      nwcRecv: localStorage.getItem("gittr_nwc_recv") || undefined,
      nwcSend: localStorage.getItem("gittr_nwc_send") || undefined,
    };
  }
}

// NWC Zap helper (client-side)
// CORRECT FLOW: Get invoice from recipient's LNURL, then pay with NWC
export async function createNWCZap(config: ZapRequest): Promise<{ invoice: string; paymentHash: string } | null> {
  const zapConfig = await getZapConfig();
  
  // Get LNbits config as fallback (encrypted if encryption is enabled)
  let lnbitsUrl: string | undefined;
  let lnbitsAdminKey: string | undefined;
  if (typeof window !== "undefined") {
    try {
      lnbitsUrl = (await getSecureItem("gittr_lnbits_url")) || undefined;
      lnbitsAdminKey = (await getSecureItem("gittr_lnbits_admin_key")) || undefined;
    } catch (error) {
      // Fallback to plaintext for backward compatibility
      lnbitsUrl = localStorage.getItem("gittr_lnbits_url") || undefined;
      lnbitsAdminKey = localStorage.getItem("gittr_lnbits_admin_key") || undefined;
    }
  }

  // If LNbits is configured but NWC is not, use LNbits directly
  if (!zapConfig.nwcSend && lnbitsUrl && lnbitsAdminKey) {
    const result = await createLNbitsZap({ ...config, splits: [] });
    return result;
  }

  if (!zapConfig.nwcSend) {
    throw new Error("NWC send not configured. Please set it in Settings → Account or configure LNbits");
  }

  // STEP 1: Fetch recipient's Nostr profile to get their Lightning address
  // This should be done where we have access to NostrContext
  // For now, we'll require the caller to fetch metadata and pass lud16/lnurl
  
  // STEP 2: Create invoice from recipient's Lightning address
  // We'll need to pass lud16/lnurl from the caller
  // For MVP, we'll create a separate endpoint that requires lud16/lnurl
  
  // If recipient metadata is available (passed via config), use it
  const recipientMetadata = (config as any).recipientMetadata;
  const lud16 = recipientMetadata?.lud16;
  const lnurl = recipientMetadata?.lnurl;
  
  if (!lud16 && !lnurl) {
    // No recipient Lightning address available - cannot create invoice
    throw new Error("Lightning address not found");
  }

  try {
    const response = await fetch("/api/zap/create-invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: config.recipient,
        amount: config.amount,
        comment: undefined,
        lud16,
        lnurl,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Unknown error" }));
      throw new Error(error.message || "Failed to create invoice from recipient");
    }

    const data = await response.json();
    const invoice = data.paymentRequest;
    
    if (!invoice || invoice.length < 50 || invoice.includes("...")) {
      throw new Error("Received invalid invoice from recipient");
    }
    
    return { invoice, paymentHash: "" };
  } catch (error: any) {
    throw new Error(`NWC Zap failed: ${error.message}`);
  }
}

// LNbits zap with splits (server-side)
// Uses LNbits SplitPayments extension:
// - For splits: Creates invoice from SOURCE wallet (owner's LNbits wallet with SplitPayments configured)
// - For single: Creates invoice from recipient's LNURL, then pays with LNbits
export async function createLNbitsZap(config: ZapRequest & { splits?: ZapSplit[] }): Promise<{ invoice: string; paymentHash: string } | null> {
  try {
    // Get user's LNbits config from secure storage (encrypted if encryption is enabled)
    let lnbitsUrl: string | undefined;
    let lnbitsAdminKey: string | undefined;
    if (typeof window !== "undefined") {
      try {
        lnbitsUrl = (await getSecureItem("gittr_lnbits_url")) || undefined;
        lnbitsAdminKey = (await getSecureItem("gittr_lnbits_admin_key")) || undefined;
      } catch (error) {
        // Fallback to plaintext for backward compatibility
        lnbitsUrl = localStorage.getItem("gittr_lnbits_url") || undefined;
        lnbitsAdminKey = localStorage.getItem("gittr_lnbits_admin_key") || undefined;
      }
    }
    
    // Get recipient metadata (passed from caller)
    const recipientMetadata = (config as any).recipientMetadata;
    const lud16 = recipientMetadata?.lud16;
    const lnurl = recipientMetadata?.lnurl;
    
    const response = await fetch("/api/zap/lnbits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: config.amount,
        recipient: config.recipient,
        comment: config.comment,
        splits: config.splits,
        lud16,
        lnurl,
        lnbitsUrl,
        lnbitsAdminKey,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Failed to create zap");
    }

    const data = await response.json();
    const invoice = data.paymentRequest;
    const paymentHash = data.paymentHash;
    
    // Verify invoice is complete (not truncated)
    if (!invoice || invoice.length < 50 || invoice.includes("...")) {
      throw new Error("Received truncated invoice from LNbits. Please check your LNbits configuration.");
    }
    
    return { invoice, paymentHash: paymentHash || "" };
  } catch (error: any) {
    throw new Error(`LNbits Zap failed: ${error.message}`);
  }
}

// Create bounty LNURL-withdraw link (LNbits)
// Bounties use LNURL-withdraw links - funds are deducted from the wallet and made available via a single-use withdraw link
// The withdraw link is created and funded from the wallet associated with the admin key (requires sufficient balance)
// Bounties are opened by USERS (not repos), so we use the USER's sending wallet from Settings → Account
export async function createBountyInvoice(
  amount: number, 
  issueId: string, 
  description?: string,
  repoEntity?: string,
  repoName?: string,
  repoOwnerDisplayName?: string,
  paymentMessage?: string // Payment message to include in title (format: "username via gittr.space ⚡⚡")
): Promise<{ withdrawId: string; lnurl: string; withdrawUrl: string; amount: number; title?: string; uses?: number; maxWithdrawable?: number }> {
  try {
    // Get LNbits config from USER's settings (Settings → Account) - encrypted if encryption is enabled
    let lnbitsUrl: string | undefined;
    let lnbitsAdminKey: string | undefined;
    let lnbitsInvoiceKey: string | undefined;
    if (typeof window !== "undefined") {
      try {
        lnbitsUrl = (await getSecureItem("gittr_lnbits_url")) || undefined;
        lnbitsAdminKey = (await getSecureItem("gittr_lnbits_admin_key")) || undefined;
        lnbitsInvoiceKey = (await getSecureItem("gittr_lnbits_invoice_key")) || undefined;
      } catch (error) {
        // Fallback to plaintext for backward compatibility
        lnbitsUrl = localStorage.getItem("gittr_lnbits_url") || undefined;
        lnbitsAdminKey = localStorage.getItem("gittr_lnbits_admin_key") || undefined;
        lnbitsInvoiceKey = localStorage.getItem("gittr_lnbits_invoice_key") || undefined;
      }
    }
    
    if (!lnbitsUrl || !lnbitsAdminKey) {
      throw new Error("Please configure your LNbits wallet in Settings → Account to create bounties");
    }
    
    // Construct user-friendly title for the withdraw link
    // Use repo owner display name + repo name + issue title, or fallback to entity/repo format
    // Include payment message at the end (format: "username via gittr.space ⚡⚡")
    let bountyTitle: string;
    if (repoOwnerDisplayName && repoName) {
      bountyTitle = `Bounty: ${repoOwnerDisplayName}/${repoName}#${issueId}`;
      if (description) {
        bountyTitle += ` - ${description.substring(0, 50)}${description.length > 50 ? '...' : ''}`;
      }
    } else if (repoEntity && repoName) {
      bountyTitle = `Bounty: ${repoEntity}/${repoName}#${issueId}`;
      if (description) {
        bountyTitle += ` - ${description.substring(0, 50)}${description.length > 50 ? '...' : ''}`;
      }
    } else {
      // Fallback to simple format
      bountyTitle = `Bounty for issue ${issueId}`;
      if (description) {
        bountyTitle += `: ${description.substring(0, 50)}${description.length > 50 ? '...' : ''}`;
      }
    }
    
    // Append payment message to title (max 200 chars total for title)
    if (paymentMessage) {
      const separator = " - ";
      const maxTitleLength = 200;
      const availableLength = maxTitleLength - bountyTitle.length - separator.length;
      if (availableLength > 0) {
        const truncatedMessage = paymentMessage.length > availableLength 
          ? paymentMessage.substring(0, availableLength - 3) + "..." 
          : paymentMessage;
        bountyTitle = `${bountyTitle}${separator}${truncatedMessage}`;
      }
    }
    
    // Use LNURL-withdraw endpoint - creates funded withdraw link
    const response = await fetch("/api/bounty/create-withdraw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        amount, 
        issueId, 
        title: bountyTitle, // Pass the constructed title
        lnbitsUrl, 
        lnbitsAdminKey, 
        lnbitsInvoiceKey 
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Failed to create bounty withdraw link");
    }

    return await response.json();
  } catch (error: any) {
    throw new Error(`Bounty creation failed: ${error.message}`);
  }
}

// Release bounty to recipient (on PR merge)
// Requires fetching recipient's Lightning address first (should be done by caller)
export async function releaseBounty(
  bountyId: string, 
  recipientPubkey: string, 
  bountyAmount: number,
  recipientMetadata?: { lud16?: string; lnurl?: string },
  lnbitsUrl?: string,
  lnbitsAdminKey?: string,
  issueEntity?: string,
  issueRepo?: string
): Promise<{ paymentHash?: string }> {
  try {
    // Get LNbits config (encrypted if encryption is enabled)
    let finalLnbitsUrl = lnbitsUrl;
    let finalLnbitsAdminKey = lnbitsAdminKey;
    if (!finalLnbitsUrl || !finalLnbitsAdminKey) {
      if (typeof window !== "undefined") {
        try {
          finalLnbitsUrl = finalLnbitsUrl || (await getSecureItem("gittr_lnbits_url")) || undefined;
          finalLnbitsAdminKey = finalLnbitsAdminKey || (await getSecureItem("gittr_lnbits_admin_key")) || undefined;
        } catch (error) {
          // Fallback to plaintext for backward compatibility
          finalLnbitsUrl = finalLnbitsUrl || localStorage.getItem("gittr_lnbits_url") || undefined;
          finalLnbitsAdminKey = finalLnbitsAdminKey || localStorage.getItem("gittr_lnbits_admin_key") || undefined;
        }
      }
    }

    if (!finalLnbitsUrl || !finalLnbitsAdminKey) {
      throw new Error("LNbits not configured. Please set LNbits URL and admin key in Settings → Account");
    }

    // Extract issue entity/repo from bountyId if it's a full path
    // For server-side validation, we need to pass entity/repo
    // Note: This is a best-effort - the API will validate on server if possible
    let issueEntity: string | undefined;
    let issueRepo: string | undefined;
    
    // Try to extract from current URL if available
    if (typeof window !== "undefined") {
      const pathMatch = window.location.pathname.match(/^\/([^\/]+)\/([^\/]+)\//);
      if (pathMatch) {
        issueEntity = pathMatch[1];
        issueRepo = pathMatch[2];
      }
    }

    const response = await fetch("/api/bounty/release", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        bountyId, 
        recipientPubkey,
        bountyAmount,
        recipientLud16: recipientMetadata?.lud16,
        recipientLnurl: recipientMetadata?.lnurl,
        lnbitsUrl: finalLnbitsUrl,
        lnbitsAdminKey: finalLnbitsAdminKey,
        issueEntity, // For server-side validation (verify amount matches issue)
        issueRepo,   // For server-side validation (verify amount matches issue)
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Failed to release bounty");
    }

    const result = await response.json();
    return { paymentHash: result.paymentHash };
  } catch (error: any) {
    throw new Error(`Bounty release failed: ${error.message}`);
  }
}

