"use client";

import { useState, useEffect } from "react";
import { Coins, Zap, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createBountyInvoice } from "@/lib/payments/zap";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { getSecureItem } from "@/lib/security/encryptedStorage";
import Link from "next/link";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import { formatPaymentMessage, getPaymentSenderName } from "@/lib/payments/payment-message";

interface BountyButtonProps {
  issueId: string;
  issueTitle?: string;
  repoEntity?: string; // For constructing title
  repoName?: string; // For constructing title
  repoOwnerDisplayName?: string; // Nostr display name for repo owner (for constructing title)
  onBountyCreated?: (withdrawId: string, lnurl: string, withdrawUrl: string, amount: number) => void;
  variant?: "default" | "outline" | "ghost";
  size?: "sm" | "lg";
  className?: string;
}

export function BountyButton({ 
  issueId,
  issueTitle,
  repoEntity,
  repoName,
  repoOwnerDisplayName,
  onBountyCreated,
  variant = "outline",
  size = "sm",
  className 
}: BountyButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAmountInput, setShowAmountInput] = useState(false);
  const [bountyAmount, setBountyAmount] = useState("10"); // Default 10 sats
  const [hasLnbitsConfig, setHasLnbitsConfig] = useState<boolean | null>(null);
  const { pubkey } = useNostrContext();
  
  // Get current user's metadata for payment message
  const currentUserPubkeys = pubkey && /^[0-9a-f]{64}$/i.test(pubkey) ? [pubkey] : [];
  const currentUserMetadata = useContributorMetadata(currentUserPubkeys);

  // Check if user has LNbits config
  useEffect(() => {
    const checkLnbitsConfig = async () => {
      try {
        let lnbitsUrl: string | null = null;
        let lnbitsAdminKey: string | null = null;
        
        try {
          lnbitsUrl = await getSecureItem("gittr_lnbits_url");
          lnbitsAdminKey = await getSecureItem("gittr_lnbits_admin_key");
        } catch {
          // Fallback to plaintext
          lnbitsUrl = localStorage.getItem("gittr_lnbits_url");
          lnbitsAdminKey = localStorage.getItem("gittr_lnbits_admin_key");
        }
        
        setHasLnbitsConfig(!!(lnbitsUrl && lnbitsAdminKey));
      } catch {
        setHasLnbitsConfig(false);
      }
    };
    
    if (pubkey) {
      checkLnbitsConfig();
    }
  }, [pubkey]);

  const handleCreateBounty = async () => {
    if (!pubkey) {
      setError("Please log in to create a bounty");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const amount = parseInt(bountyAmount) || 100;
      if (amount < 2) {
        throw new Error("Minimum bounty amount is 2 sats");
      }

      // Format payment message: username + "via gittr.space ⚡⚡"
      const senderName = getPaymentSenderName(pubkey, currentUserMetadata);
      const paymentMessage = formatPaymentMessage(senderName);

      // Bounties use the USER's sending wallet (from Settings → Account), not repo wallet
      // Creates LNURL-withdraw link (automatically funded from wallet)
      // Include payment message in the title (LNURL withdraw links don't have a separate message field)
      const { withdrawId, lnurl, withdrawUrl, amount: createdAmount } = await createBountyInvoice(
        amount,
        issueId,
        issueTitle,
        repoEntity,
        repoName,
        repoOwnerDisplayName,
        paymentMessage // Pass payment message to be included in title
      );

      // Store amount for display
      if (typeof window !== "undefined") {
        localStorage.setItem("bounty_amount_input", bountyAmount);
      }

      if (onBountyCreated) {
        if (!withdrawId || !withdrawUrl) {
          throw new Error("Withdraw link created but ID/URL not found. Please try again.");
        }
        onBountyCreated(withdrawId, lnurl, withdrawUrl, createdAmount);
      }
      
      setShowAmountInput(false);
    } catch (err: any) {
      setError(err.message || "Failed to create bounty");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative">
      <Button
        variant={variant}
        size={size}
        onClick={() => setShowAmountInput(true)}
        disabled={loading || !pubkey}
        className={className}
      >
        <Coins className="mr-2 h-4 w-4" />
        Add Bounty
      </Button>
      {showAmountInput && (
        <div className="absolute top-full left-0 mt-2 p-3 bg-gray-900 border border-gray-700 rounded shadow-lg z-50 min-w-[300px]">
          <div className="flex flex-col gap-2">
            <label className="text-sm text-gray-300">Bounty Amount (sats)</label>
            <Input
              type="number"
              min="2"
              max="1000000"
              value={bountyAmount}
              onChange={(e) => setBountyAmount(e.target.value)}
              placeholder="Amount (sats)"
              className="px-2 py-1 border border-gray-600 bg-gray-800 text-white rounded"
            />
            {hasLnbitsConfig === false && (
              <div className="text-xs text-yellow-400 bg-yellow-900/20 border border-yellow-600/50 p-2 rounded">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <strong>LNbits wallet required:</strong> You need to configure your LNbits sending wallet in <Link href="/settings/account" className="underline hover:text-yellow-300" target="_blank">Settings → Account</Link> to create bounties. The withdraw link will be created from your LNbits wallet and funds will be reserved there until the PR author claims it.
                  </div>
                </div>
              </div>
            )}
            {hasLnbitsConfig === true && (
              <div className="text-xs text-gray-400 bg-gray-800/50 p-2 rounded">
                <strong>Bounty System:</strong> The bounty amount will be deducted from your LNbits wallet and a withdraw link will be created. Make sure you have sufficient balance in your wallet. When a PR fixing this issue is merged, the withdraw link will be released to the PR author. They can claim the bounty using the withdraw link. The funds are already reserved in your wallet and will be deducted when they claim it.
                <Link href="/help#bounties" className="text-purple-400 hover:text-purple-300 underline ml-1" target="_blank">
                  Learn more →
                </Link>
              </div>
            )}
            {hasLnbitsConfig === null && (
            <div className="text-xs text-gray-400 bg-gray-800/50 p-2 rounded">
                💡 <strong>Bounty System:</strong> Checking LNbits configuration...
            </div>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleCreateBounty}
                disabled={loading}
                className="flex-1"
              >
                {loading ? "Creating..." : "Create Bounty"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowAmountInput(false);
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
            {error && (
              <p className="text-red-400 text-sm">{error}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

