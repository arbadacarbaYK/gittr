"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import {
  createInvoiceFromLnurlZapRequest,
  encodeLnurlPayHttpsToBech32,
  lightningAddressToLnurlpHttps,
  lnurlPayInputToHttpsUrl,
  resolveLNURL,
} from "@/lib/payments/lnurl";
import { buildUnsignedZapRequest9734 } from "@/lib/payments/nip57-zap";
import {
  formatPaymentMessage,
  getPaymentSenderName,
} from "@/lib/payments/payment-message";
import { resolveRepoSendWallet } from "@/lib/payments/resolve-repo-wallet";
import {
  type ZapRequest,
  type ZapSplit,
  createLNbitsZap,
} from "@/lib/payments/zap";
import { markZapPaid, recordZap } from "@/lib/payments/zap-tracker";

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
  /** Repo zaps: use NIP-57 when the recipient LNURL-pay endpoint advertises `allowsNostr` */
  nip57ProfileZap?: boolean;
  /** Repo split zaps: resolve LNbits send keys repo-first (see resolveRepoSendWallet) */
  splitSendContext?: { entity: string; repo: string };
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
  nip57ProfileZap = false,
  splitSendContext,
}: ZapButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAmountInput, setShowAmountInput] = useState(false);
  const [customAmount, setCustomAmount] = useState(amount.toString());
  const [showQR, setShowQR] = useState(false);
  const [paymentInvoice, setPaymentInvoice] = useState<string | null>(null);
  const [paymentHash, setPaymentHash] = useState<string | undefined>(undefined);
  const [paymentTrackHint, setPaymentTrackHint] = useState<"default" | "nip57">(
    "default"
  );
  const [paymentAmount, setPaymentAmount] = useState<number>(amount);
  const [recipientMetadata, setRecipientMetadata] = useState<{
    lud16?: string;
    lnurl?: string;
  } | null>(null);
  const { pubkey, subscribe, defaultRelays } = useNostrContext();
  const pendingZapIdRef = useRef<string | null>(null);

  // Get current user's metadata for payment message
  const currentUserPubkeys =
    pubkey && /^[0-9a-f]{64}$/i.test(pubkey) ? [pubkey] : [];
  const currentUserMetadata = useContributorMetadata(currentUserPubkeys);

  const hasProvidedRecipientWallet = !!(
    providedMetadata?.lud16?.trim() ||
    providedMetadata?.lnurl?.trim() ||
    providedMetadata?.nwcRecv?.trim()
  );

  // Fetch recipient's Lightning address from Nostr profile (only if not provided)
  useEffect(() => {
    // If parent passed a usable receive hint (repo config / merged profile), use it
    if (hasProvidedRecipientWallet) {
      setRecipientMetadata({
        lud16: providedMetadata?.lud16,
        lnurl: providedMetadata?.lnurl,
      });
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
  }, [
    recipient,
    subscribe,
    defaultRelays,
    providedMetadata,
    hasProvidedRecipientWallet,
  ]);

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
    setPaymentTrackHint("default");

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
        let lnbitsUrlOverride: string | undefined;
        let lnbitsAdminKeyOverride: string | undefined;
        if (splitSendContext?.entity && splitSendContext.repo) {
          const sendWallet = await resolveRepoSendWallet(
            splitSendContext.entity,
            splitSendContext.repo
          );
          if (sendWallet.lnbitsUrl && sendWallet.lnbitsAdminKey) {
            lnbitsUrlOverride = sendWallet.lnbitsUrl;
            lnbitsAdminKeyOverride = sendWallet.lnbitsAdminKey;
          }
        }
        paymentResult = await createLNbitsZap({
          ...zapRequest,
          splits,
          lnbitsUrlOverride,
          lnbitsAdminKeyOverride,
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

        const tryNip57Invoice = async (): Promise<{
          invoice: string;
          paymentHash: string;
        } | null> => {
          if (
            !nip57ProfileZap ||
            typeof window === "undefined" ||
            !(
              window as {
                nostr?: { signEvent?: (e: unknown) => Promise<unknown> };
              }
            ).nostr?.signEvent ||
            !pubkey ||
            !/^[0-9a-f]{64}$/i.test(pubkey)
          ) {
            return null;
          }
          try {
            const ludOr =
              recipientMetadata.lud16?.trim() ||
              recipientMetadata.lnurl?.trim() ||
              "";
            const httpsPay = ludOr.includes("@")
              ? lightningAddressToLnurlpHttps(ludOr)
              : lnurlPayInputToHttpsUrl(ludOr);
            const payMeta = await resolveLNURL(httpsPay);
            if (
              payMeta.allowsNostr !== true ||
              !payMeta.nostrPubkey ||
              !payMeta.callback
            ) {
              return null;
            }
            let recipientHex = recipient;
            if (recipient.startsWith("npub")) {
              recipientHex = (
                nip19.decode(recipient).data as string
              ).toLowerCase();
            }
            if (!/^[0-9a-f]{64}$/i.test(recipientHex)) return null;

            const lnurlBech32 = encodeLnurlPayHttpsToBech32(httpsPay);
            const relays =
              defaultRelays && defaultRelays.length > 0
                ? defaultRelays
                : ["wss://relay.damus.io"];
            const zapBody = (comment && comment.trim()) || paymentMessage;
            const unsigned = buildUnsignedZapRequest9734({
              senderPubkeyHex: pubkey,
              recipientPubkeyHex: recipientHex,
              amountMsat: zapAmount * 1000,
              relays,
              lnurlBech32,
              content: zapBody,
            });
            const signed = (await (
              window as {
                nostr: { signEvent: (e: unknown) => Promise<unknown> };
              }
            ).nostr.signEvent(unsigned as never)) as Record<string, unknown>;
            const invoice = await createInvoiceFromLnurlZapRequest({
              callback: payMeta.callback,
              amountMsat: zapAmount * 1000,
              signedZapRequest9734: signed,
              lnurlBech32,
            });
            setPaymentTrackHint("nip57");
            return { invoice, paymentHash: "" };
          } catch (nipErr: unknown) {
            console.warn(
              "[ZapButton] NIP-57 zap invoice not used:",
              nipErr instanceof Error ? nipErr.message : nipErr
            );
            return null;
          }
        };

        paymentResult = await tryNip57Invoice();

        if (!paymentResult) {
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

      const zapId = `zap-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 9)}`;
      pendingZapIdRef.current = zapId;
      const repoMatch = comment?.match(/^Zap for (.+)/);
      recordZap({
        id: zapId,
        recipient,
        sender: pubkey || undefined, // Convert null to undefined
        amount: zapAmount,
        comment: zapRequest.comment,
        createdAt: Date.now(),
        type: repoMatch ? "repo" : "user",
        contextId: repoMatch ? repoMatch[1] : undefined,
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
            const id = pendingZapIdRef.current;
            if (id) markZapPaid(id);
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
            pendingZapIdRef.current = null;
            setShowQR(false);
            setPaymentInvoice(null);
            setPaymentHash(undefined);
            setPaymentTrackHint("default");
            setError(null);
          }}
          completionHint={paymentTrackHint}
        />
      )}
    </div>
  );
}
