import { getSecureItem } from "@/lib/security/encryptedStorage";

export async function ensurePushPaymentAuthorization(params: {
  entity: string;
  repo: string;
  ownerPubkey: string;
  payerPubkey: string;
  privateKey?: string;
  ownerMetadata?: {
    lud16?: string;
    lnurl?: string;
    nwcRecv?: string;
    [key: string]: any;
  };
  signer?: (event: any) => Promise<any>;
}): Promise<{
  ok: boolean;
  error?: string;
  needsExternalPayment?: boolean;
  invoice?: string;
  paymentHash?: string;
  pushCostSats?: number;
  ownerLnbitsUrl?: string;
  ownerLnbitsReadKey?: string;
  ownerBlinkApiKey?: string;
}> {
  const {
    repo,
    ownerPubkey,
    payerPubkey,
  } = params;
  if (!ownerPubkey?.trim() || !repo?.trim()) {
    return {
      ok: false,
      error:
        "Cannot verify push payment: missing owner pubkey or repository name.",
    };
  }

  const checkRes = await fetch(
    `/api/nostr/repo/push-payment?ownerPubkey=${encodeURIComponent(
      ownerPubkey
    )}&repo=${encodeURIComponent(repo)}&payerPubkey=${encodeURIComponent(
      payerPubkey
    )}`
  );
  if (!checkRes.ok) {
    return { ok: false, error: "Failed to check push payment policy" };
  }
  const checkData = await checkRes.json();
  const pushCostSats =
    typeof checkData.pushCostSats === "number" ? checkData.pushCostSats : 0;
  if (pushCostSats <= 0 || checkData.authorized) {
    return { ok: true };
  }

  let ownerLnbitsUrl = "";
  let ownerLnbitsInvoiceKey = "";
  let ownerLnbitsAdminKey = "";
  let ownerBlinkApiKey = "";
  try {
    ownerLnbitsUrl = (await getSecureItem("gittr_lnbits_url")) || "";
    ownerLnbitsInvoiceKey =
      (await getSecureItem("gittr_lnbits_invoice_key")) || "";
    ownerLnbitsAdminKey = (await getSecureItem("gittr_lnbits_admin_key")) || "";
    ownerBlinkApiKey = (await getSecureItem("gittr_blink_api_key")) || "";
  } catch {
    if (typeof window !== "undefined") {
      ownerLnbitsUrl = localStorage.getItem("gittr_lnbits_url") || "";
      ownerLnbitsInvoiceKey =
        localStorage.getItem("gittr_lnbits_invoice_key") || "";
      ownerLnbitsAdminKey = localStorage.getItem("gittr_lnbits_admin_key") || "";
      ownerBlinkApiKey = localStorage.getItem("gittr_blink_api_key") || "";
    }
  }

  const authRes = await fetch("/api/nostr/repo/push-payment", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ownerPubkey,
      repo,
      payerPubkey,
      action: "create_intent",
      ownerLnbitsUrl,
      ownerLnbitsInvoiceKey,
      ownerLnbitsAdminKey,
      ownerBlinkApiKey,
    }),
  });
  if (!authRes.ok) {
    const err = await authRes.json().catch(() => ({}));
    return {
      ok: false,
      error: err.error || err.message || "Payment authorization failed",
    };
  }

  const authData = await authRes.json();
  if (authData.authorized) {
    return { ok: true };
  }
  const invoice =
    typeof authData.paymentRequest === "string" ? authData.paymentRequest : "";
  if (!invoice) {
    return {
      ok: false,
      error:
        "Push payment required but no invoice was created. Check push paywall server wallet configuration.",
    };
  }
  return {
    ok: false,
    needsExternalPayment: true,
    pushCostSats,
    invoice,
    paymentHash:
      typeof authData.paymentHash === "string"
        ? authData.paymentHash
        : undefined,
    ownerLnbitsUrl: ownerLnbitsUrl || undefined,
    ownerLnbitsReadKey: effectiveReadKeyForPolling(
      ownerLnbitsInvoiceKey,
      ownerLnbitsAdminKey
    ),
    ownerBlinkApiKey: ownerBlinkApiKey || undefined,
    error: "External payment required. Pay the invoice, then retry push.",
  };
}

function effectiveReadKeyForPolling(
  ownerLnbitsInvoiceKey: string,
  ownerLnbitsAdminKey: string
): string | undefined {
  if (ownerLnbitsInvoiceKey?.trim()) return ownerLnbitsInvoiceKey.trim();
  if (ownerLnbitsAdminKey?.trim()) return ownerLnbitsAdminKey.trim();
  return undefined;
}
