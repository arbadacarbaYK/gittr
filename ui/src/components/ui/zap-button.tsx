"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import {
  formatPaymentMessage,
  getPaymentSenderName,
} from "@/lib/payments/payment-message";
import {
  type ZapRequest,
  type ZapSplit,
  createLNbitsZap,
  createNWCZap,
} from "@/lib/payments/zap";
import { recordZap } from "@/lib/payments/zap-tracker";

import { Zap } from "lucide-react";
import { nip19 } from "nostr-tools";

import { PaymentQR } from "./payment-qr";

interface ZapButtonProps {
  recipient: string; // npub or pubkey
  amount?: number; // default amount in sats
  comment?: string;
  splits?: ZapSplit[]; // For repo zaps with splits
  variant?: "default" | "outline" | "ghost";
  size?: "sm" | "lg";
  className?: string;
  modalExtra?: React.ReactNode; // extra content to show in the QR modal
  recipientMetadata?: { lud16?: string; lnurl?: string; nwcRecv?: string }; // Pre-resolved wallet (from repo config, etc.)
  label?: string; // Custom button label (defaults to "{amount} sats")
}

export function ZapButton({
  recipient,
  amount = 10, // Use 2-10 sats for testing (LNbits ~300 sats, NWC ~84 sats)
  comment,
  splits,
  variant = "outline",
  size = "sm",
  className,
  modalExtra,
  recipientMetadata: providedMetadata,
  label,
}: ZapButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAmountInput, setShowAmountInput] = useState(false);
  const [customAmount, setCustomAmount] = useState(amount.toString());
  const [showQR, setShowQR] = useState(false);
  const [paymentInvoice, setPaymentInvoice] = useState<string | null>(null);
  const [paymentHash, setPaymentHash] = useState<string | undefined>(undefined);
  const [paymentAmount, setPaymentAmount] = useState<number>(amount);
  const [recipientMetadata, setRecipientMetadata] = useState<{
    lud16?: string;
    lnurl?: string;
  } | null>(null);
  const { pubkey, subscribe, defaultRelays } = useNostrContext();

  // Get current user's metadata for payment message
  const currentUserPubkeys =
    pubkey && /^[0-9a-f]{64}$/i.test(pubkey) ? [pubkey] : [];
  const currentUserMetadata = useContributorMetadata(currentUserPubkeys);

  // Fetch recipient's Lightning address from Nostr profile (only if not provided)
  useEffect(() => {
    // If metadata is already provided (e.g., from repo config), use it
    if (providedMetadata) {
      setRecipientMetadata(providedMetadata);
      return;
    }

    if (!recipient || !subscribe) return;

    const fetchRecipientMetadata = async () => {
      try {
        // Decode npub to pubkey if needed
        let recipientPubkey = recipient;
        if (recipient.startsWith("npub")) {
          const decoded = nip19.decode(recipient);
          recipientPubkey = decoded.data as string;
        }

        // Subscribe to recipient's profile (kind 0)
        const events = await new Promise<any[]>((resolve) => {
          const timeout = setTimeout(() => resolve([]), 5000);
          subscribe(
            [
              {
                kinds: [0],
                authors: [recipientPubkey],
              },
            ],
            defaultRelays,
            (event) => {
              clearTimeout(timeout);
              resolve([event]);
            },
            undefined,
            () => {
              clearTimeout(timeout);
              resolve([]);
            }
          );
        });

        if (events.length > 0) {
          const profile = JSON.parse(events[0].content || "{}");
          setRecipientMetadata({
            lud16: profile.lud16,
            lnurl: profile.lnurl,
          });
        }
      } catch (error) {
        console.warn("Failed to fetch recipient metadata:", error);
      }
    };

    fetchRecipientMetadata();
  }, [recipient, subscribe, defaultRelays, providedMetadata]);

  const handleZap = async () => {
    const zapAmount = parseInt(customAmount) || amount;
    if (zapAmount < 2) {
      setError("Minimum zap amount is 2 sats");
      setShowQR(true);
      return;
    }

    setPaymentAmount(zapAmount);
    setShowAmountInput(false);
    setShowQR(true);
    setLoading(true);
    setError(null);

    try {
      // Format payment message: username + "via gittr.space ⚡⚡"
      // If not logged in, paymentMessage will default to "Anonymous via gittr.space ⚡⚡"
      const senderName = pubkey
        ? getPaymentSenderName(pubkey, currentUserMetadata)
        : null;
      const paymentMessage = formatPaymentMessage(senderName);

      const zapRequest: ZapRequest & {
        recipientMetadata?: { lud16?: string; lnurl?: string };
      } = {
        amount: zapAmount,
        recipient,
        comment: paymentMessage, // Always use formatted payment message
        splits,
        recipientMetadata: recipientMetadata || undefined,
      };

      let paymentResult: { invoice: string; paymentHash: string } | null = null;

      // Check if LNbits is configured (for fallback or splits)
      const lnbitsUrl =
        typeof window !== "undefined"
          ? localStorage.getItem("gittr_lnbits_url") || undefined
          : undefined;
      const lnbitsAdminKey =
        typeof window !== "undefined"
          ? localStorage.getItem("gittr_lnbits_admin_key") || undefined
          : undefined;
      const hasLnbits = lnbitsUrl && lnbitsAdminKey;

      if (splits && splits.length > 0) {
        // Use LNbits SplitPayments extension for splits
        // Creates invoice from SOURCE wallet (owner's LNbits wallet)
        // SplitPayments extension must be pre-configured in LNbits wallet
        // When invoice is paid, LNbits automatically splits to configured targets
        paymentResult = await createLNbitsZap({
          ...zapRequest,
          splits,
          // For splits, we don't need recipient metadata - invoice comes from source wallet
        });
      } else {
        // Create invoice from recipient's Lightning address (LNURL/LUD-16)
        // Show QR modal first - NWC payment happens only when user clicks "Pay via NWC" button
        if (!recipientMetadata?.lud16 && !recipientMetadata?.lnurl) {
          setError(
            "Recipient's Lightning address not found. The recipient needs to set a lud16 or lnurl in their Nostr profile."
          );
          setPaymentInvoice(null);
          return;
        }

        try {
          const response = await fetch("/api/zap/create-invoice", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              recipient: recipient,
              amount: zapAmount,
              comment: paymentMessage, // Include comment for LNURL invoices
              lud16: recipientMetadata.lud16,
              lnurl: recipientMetadata.lnurl,
            }),
          });

          if (!response.ok) {
            const error = await response
              .json()
              .catch(() => ({ message: "Unknown error" }));
            throw new Error(error.message || "Failed to create invoice");
          }

          const data = await response.json();
          const invoice = data.paymentRequest;

          if (!invoice || invoice.length < 50) {
            throw new Error("Received invalid invoice");
          }

          paymentResult = { invoice, paymentHash: "" };
        } catch (error: any) {
          setError(
            error.message || "Failed to create invoice. Please try again."
          );
          setPaymentInvoice(null);
          setLoading(false);
          return;
        }
      }

      if (!paymentResult || !paymentResult.invoice) {
        setError("No payment request received");
        setPaymentInvoice(null);
        setLoading(false);
        return;
      }

      const paymentRequest = paymentResult.invoice;
      const paymentHash = paymentResult.paymentHash;

      // Verify invoice is complete
      if (paymentRequest.length < 50 || paymentRequest.includes("...")) {
        throw new Error(
          `Received truncated invoice (length: ${paymentRequest.length}). Full: ${paymentRequest}`
        );
      }

      recordZap({
        id: Date.now().toString(),
        recipient,
        sender: pubkey || undefined, // Convert null to undefined
        amount: zapAmount,
        comment: zapRequest.comment,
        createdAt: Date.now(),
        type: "user",
        contextId: undefined,
        invoice: paymentRequest,
        status: "pending",
      });

      setPaymentInvoice(paymentRequest);
      setPaymentHash(paymentHash);
    } catch (err: any) {
      setError(err.message || "Failed to create zap");
      setPaymentInvoice(null);
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
        disabled={loading}
        className={className}
      >
        <Zap className="mr-2 h-4 w-4" />
        {showAmountInput ? "Zap" : label || `${amount} sats`}
      </Button>
      {showAmountInput && (
        <div className="absolute top-full left-0 mt-2 p-3 bg-gray-900 border border-gray-700 rounded shadow-lg z-50 min-w-[250px]">
          <div className="flex flex-col gap-2">
            <input
              type="number"
              min="2"
              max="1000"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              placeholder="Amount (sats)"
              className="px-2 py-1 border border-gray-600 bg-gray-800 text-white rounded"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleZap}
                disabled={loading}
                className="flex-1"
              >
                {loading ? "Processing..." : "Zap"}
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
            {error && <p className="text-red-400 text-sm">{error}</p>}
          </div>
        </div>
      )}
      {showQR && (
        <PaymentQR
          invoice={paymentInvoice}
          amount={paymentAmount}
          paymentHash={paymentHash}
          lnbitsUrl={
            typeof window !== "undefined"
              ? localStorage.getItem("gittr_lnbits_url") || undefined
              : undefined
          }
          lnbitsAdminKey={
            typeof window !== "undefined"
              ? localStorage.getItem("gittr_lnbits_admin_key") || undefined
              : undefined
          }
          nwcUri={
            typeof window !== "undefined"
              ? localStorage.getItem("gittr_nwc_send") || undefined
              : undefined
          }
          extra={modalExtra}
          error={error}
          onPaid={async () => {
            // Only record accumulated zap when payment is confirmed
            const repoId = comment?.match(/Zap for (.+)/)?.[1];
            if (repoId && typeof window !== "undefined") {
              const { recordAccumulatedZap } = await import(
                "@/lib/payments/zap-repo"
              );
              recordAccumulatedZap(
                repoId,
                paymentAmount,
                paymentHash || "",
                comment
              );
            }
          }}
          onClose={() => {
            setShowQR(false);
            setPaymentInvoice(null);
            setPaymentHash(undefined);
            setError(null);
          }}
        />
      )}
    </div>
  );
}
