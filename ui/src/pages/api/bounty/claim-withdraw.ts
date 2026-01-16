import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import {
  type LNbitsConfig,
  type LNbitsPaymentRequest,
  createPayment,
  getWithdrawLink,
} from "@/lib/payments/lnbits-adapter";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Programmatically claim an LNURL-withdraw link
 * This is used to automatically release bounties to PR authors
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Handle OPTIONS request for CORS (GRASP requirement)
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res);
    return;
  }

  // Set CORS headers (GRASP requirement)
  setCorsHeaders(res);

  if (req.method !== "POST") {
    return res.status(405).json({ status: "method_not_allowed" });
  }

  const {
    withdrawLinkId,
    lnurl,
    recipientLud16,
    recipientLnurl,
    lnbitsUrl,
    lnbitsAdminKey,
    issueEntity,
    issueRepo,
  } = req.body || {};

  if (!withdrawLinkId && !lnurl) {
    return res.status(400).json({
      status: "missing_params",
      message: "Missing withdrawLinkId or lnurl",
    });
  }

  if (!recipientLud16 && !recipientLnurl) {
    return res.status(400).json({
      status: "missing_recipient",
      message: "Recipient Lightning address (lud16 or lnurl) required",
    });
  }

  const finalLnbitsAdminKey =
    lnbitsAdminKey || process.env.LNBITS_ADMIN_KEY || "";
  const finalLnbitsUrl =
    lnbitsUrl || process.env.LNBITS_URL || "https://bitcoindelta.club";

  if (!finalLnbitsAdminKey) {
    return res.status(400).json({
      status: "missing_lnbits_key",
      message: "LNbits admin key required",
    });
  }

  try {
    // Step 1: Get invoice from recipient's Lightning address
    const recipientAddress = recipientLud16 || recipientLnurl;

    // Use our existing create-invoice endpoint logic
    const invoiceResponse = await fetch(`${finalLnbitsUrl}/api/v1/payments`, {
      method: "POST",
      headers: {
        "X-Api-Key": finalLnbitsAdminKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        out: false, // Create receiving invoice
        amount: 0, // Will be determined by withdraw link amount
        memo: `Bounty payment from ${issueEntity}/${issueRepo}`,
      }),
    });

    if (!invoiceResponse.ok) {
      throw new Error("Failed to create invoice from recipient address");
    }

    // Actually, we need to use LNURL-withdraw flow:
    // 1. Decode LNURLw to get callback URL
    // 2. Call callback with k1 (withdraw link ID) and pr (payment request/invoice)

    // For now, simpler approach: Use LNbits API to programmatically claim
    // The withdraw link needs to be claimed by calling the LNURL callback

    // Alternative: Use LNbits withdraw API to get the withdraw link details
    // Then claim it using the LNURL callback

    // Get withdraw link details using adapter (handles both API versions)
    const config: LNbitsConfig = {
      url: finalLnbitsUrl,
      adminKey: finalLnbitsAdminKey,
    };

    let linkData;
    try {
      linkData = await getWithdrawLink(config, withdrawLinkId);
    } catch (error: any) {
      throw new Error(`Failed to get withdraw link details: ${error.message}`);
    }

    // Step 2: Create invoice from recipient
    // Use LNURL-pay or LUD-16 to get invoice
    let invoice: string;

    if (recipientLud16) {
      // Resolve LUD-16 to LNURL-pay
      const [name, domain] = recipientLud16.split("@");
      const lnurlPayUrl = `https://${domain}/.well-known/lnurlp/${name}`;

      // Fetch LNURL-pay endpoint
      const lnurlResponse = await fetch(lnurlPayUrl);
      if (!lnurlResponse.ok) {
        throw new Error("Failed to resolve LNURL-pay");
      }

      const lnurlData = await lnurlResponse.json();
      const callbackUrl = lnurlData.callback;
      const amount = linkData.max_withdrawable || linkData.min_withdrawable;

      // Call callback to get invoice
      const callbackResponse = await fetch(`${callbackUrl}?amount=${amount}`);
      if (!callbackResponse.ok) {
        throw new Error("Failed to get invoice from LNURL-pay callback");
      }

      const invoiceData = await callbackResponse.json();
      invoice = invoiceData.pr; // Payment request (BOLT11 invoice)
    } else if (recipientLnurl) {
      // Decode LNURL and follow same flow
      // For now, assume it's already a callback URL
      const amount = linkData.max_withdrawable || linkData.min_withdrawable;
      const callbackResponse = await fetch(
        `${recipientLnurl}?amount=${amount}`
      );
      if (!callbackResponse.ok) {
        throw new Error("Failed to get invoice from LNURL callback");
      }
      const invoiceData = await callbackResponse.json();
      invoice = invoiceData.pr;
    } else {
      throw new Error("No valid recipient address");
    }

    // Step 3: Claim withdraw link by calling LNURL-withdraw callback
    // The withdraw link's LNURLw contains a callback URL
    // We need to decode it and call it with the invoice

    // Decode LNURLw (starts with LNURLw...)
    const lnurlw = linkData.lnurl || lnurl;
    if (!lnurlw || !lnurlw.startsWith("LNURLw")) {
      throw new Error("Invalid LNURLw format");
    }

    // Decode bech32 LNURLw to get callback URL
    // For now, use the withdraw API's callback endpoint
    // The withdraw extension provides: /withdraw/api/v1/lnurl/{unique_hash}

    // Extract unique hash from withdraw link
    const uniqueHash = linkData.id || linkData.unique_hash;

    // Call LNURL-withdraw callback with invoice
    const withdrawCallbackUrl = `${finalLnbitsUrl}/withdraw/api/v1/lnurl/${uniqueHash}`;

    // First, get the withdraw parameters (k1)
    const withdrawParamsResponse = await fetch(withdrawCallbackUrl);
    if (!withdrawParamsResponse.ok) {
      throw new Error("Failed to get withdraw parameters");
    }

    const withdrawParams = await withdrawParamsResponse.json();
    const k1 = withdrawParams.k1;

    // Now claim the withdraw by calling callback with k1 and pr (invoice)
    const claimResponse = await fetch(
      `${withdrawCallbackUrl}?k1=${k1}&pr=${encodeURIComponent(invoice)}`
    );

    if (!claimResponse.ok) {
      throw new Error("Failed to claim withdraw link");
    }

    const claimData = await claimResponse.json();

    if (claimData.status === "ERROR") {
      throw new Error(claimData.reason || "Withdraw claim failed");
    }

    // Step 4: Pay the invoice from the wallet that funds the withdraw link using adapter
    // The withdraw link is funded by the wallet associated with the admin key
    // So we pay the invoice from that wallet
    const paymentRequest: LNbitsPaymentRequest = {
      out: true, // Outgoing payment
      bolt11: invoice,
    };

    let paymentData;
    try {
      paymentData = await createPayment(config, paymentRequest);
    } catch (error: any) {
      throw new Error(`Failed to pay invoice: ${error.message}`);
    }

    return res.status(200).json({
      status: "ok",
      message: "Bounty claimed and paid successfully",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      paymentHash: paymentData.payment_hash,
    });
  } catch (error: any) {
    console.error("Bounty withdraw claim error:", error);
    return res.status(500).json({
      status: "error",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      message: (error as any).message || "Failed to claim withdraw link",
    });
  }
}
