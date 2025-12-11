import type { NextApiRequest, NextApiResponse } from "next";
import { validatePaymentAmount } from "@/lib/security/input-validation";
import { setCorsHeaders, handleOptionsRequest } from "@/lib/api/cors";
import { createWithdrawLink, listWithdrawLinks, type LNbitsConfig } from "@/lib/payments/lnbits-adapter";

/**
 * Create LNURL-withdraw link for bounty
 * This ensures the withdraw extension is activated, then creates a single-use withdraw link
 * The funds are deducted from the wallet when the link is created (requires sufficient balance)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

  const { amount, issueId, title, lnbitsUrl, lnbitsAdminKey, lnbitsInvoiceKey } = req.body || {};

  if (!amount || !issueId) {
    return res.status(400).json({ status: "missing_params", message: "Missing required parameters" });
  }

  // Input validation
  const amountValidation = validatePaymentAmount(amount);
  if (!amountValidation.valid) {
    return res.status(400).json({ status: "invalid_amount", message: amountValidation.error });
  }

  if (typeof issueId !== "string" || issueId.length > 200) {
    return res.status(400).json({ status: "invalid_issue_id", message: "Invalid issue ID format" });
  }

  // Get LNbits admin key from request body (user config) or environment
  const finalLnbitsAdminKey = lnbitsAdminKey || process.env.LNBITS_ADMIN_KEY || "";
  const finalLnbitsUrl = lnbitsUrl || process.env.LNBITS_URL || "https://bitcoindelta.club";

  if (!finalLnbitsAdminKey) {
    return res.status(400).json({ status: "missing_lnbits_key", message: "LNbits admin key required" });
  }

  try {
    // Step 1: Try to activate withdraw extension (may fail if not available or already active)
    // Extension activation typically requires user session, not admin key
    // User should enable it manually in LNbits UI if needed
    const withdrawExtId = "withdraw";
    
    try {
      // Try to activate withdraw extension (non-blocking, will continue if it fails)
      // Use Promise.race for timeout instead of AbortController
      const activatePromise = fetch(`${finalLnbitsUrl}/api/v1/extension/${withdrawExtId}/activate`, {
        method: "PUT",
        headers: {
          "X-Api-Key": finalLnbitsAdminKey,
        },
      });
      
      const activateTimeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('TIMEOUT')), 10000);
      });
      
      const activateResponse = await Promise.race([activatePromise, activateTimeout]);

      if (!activateResponse.ok && activateResponse.status !== 409) {
        // 409 = already activated, which is fine
        // Other errors (like 401/403) mean extension needs manual activation
        const errorText = await activateResponse.text();
        console.warn("Extension activation check failed (user may need to enable manually):", errorText);
        // Continue anyway - try to create link, will fail with clear error if extension not enabled
      }
    } catch (activateError: any) {
      // Silently continue - activation is optional, will get clear error when creating link if extension not enabled
      console.warn("Extension activation check failed (user may need to enable manually):", activateError.message);
    }

    // Step 2: Create withdraw link using adapter (handles both API versions)
    // Note: The withdraw link is automatically funded from the wallet associated with the admin key
    // Use provided title (with user-friendly format) or fallback to simple format
    const withdrawTitle = title || `Bounty for issue ${issueId}`;
    
    const config: LNbitsConfig = {
      url: finalLnbitsUrl,
      adminKey: finalLnbitsAdminKey,
      invoiceKey: lnbitsInvoiceKey,
    };

    let withdrawData;
    try {
      withdrawData = await createWithdrawLink(config, {
          title: withdrawTitle,
          min_withdrawable: amount * 1000, // millisats
          max_withdrawable: amount * 1000, // millisats
          uses: 1, // Single use withdraw link
          wait_time: 1, // Minimum wait time (1 second)
          is_unique: true, // Single use only
      });
    } catch (fetchError: any) {
      // Log the actual error details for debugging
      console.error("Fetch error details:", {
        message: fetchError.message,
        name: fetchError.name,
        cause: fetchError.cause,
        stack: fetchError.stack,
        code: fetchError.cause?.code,
        errno: fetchError.cause?.errno,
        syscall: fetchError.cause?.syscall,
        address: fetchError.cause?.address,
        port: fetchError.cause?.port
      });
      
      if (fetchError.message?.includes('fetch failed') || fetchError.cause?.code === 'ECONNREFUSED' || fetchError.cause?.code === 'ETIMEDOUT' || fetchError.cause?.code === 'ENOTFOUND') {
        throw new Error(`Network error: Unable to connect to LNbits at ${finalLnbitsUrl}. Error: ${fetchError.cause?.code || fetchError.message}. Please check your LNbits URL and network connection.`);
    }

      // Check if extension is not enabled
      if (fetchError.message?.includes("not enabled") || fetchError.message?.includes("404")) {
        throw new Error(`Withdraw extension is not enabled. Please enable it in LNbits UI (Extensions → Withdraw) for your wallet.`);
      }
      
      throw fetchError;
    }

    // Response format from POST: Full object with id, lnurl, title, etc.
    // Example: {"id":"gnDBSXT9jicWBmiMLaswVF","lnurl":"LNURL1DP68G...","title":"...",...}
    // The withdraw link is already funded from the wallet associated with the admin key
    
    if (!withdrawData.lnurl) {
      throw new Error("Invalid response from LNbits: missing lnurl");
    }

    // Extract withdraw ID directly from response (adapter normalizes this)
    const withdrawId = withdrawData.id;
    
    if (!withdrawId) {
      // Fallback: Try to get ID by listing links if not in POST response
      console.warn("Withdraw ID not in POST response, trying to list links...");
      
      if (!lnbitsInvoiceKey) {
        console.warn("Invoice key not provided, cannot list links");
        return res.status(200).json({
          status: "ok",
          lnurl: withdrawData.lnurl,
          amount: amount,
          // Note: withdrawId not available, will need to be extracted from lnurl or stored separately
        });
      }
      
      // Use adapter to list withdraw links (handles both API versions)
      let allLinks;
      try {
        allLinks = await listWithdrawLinks(config);
      } catch (listError: any) {
        console.warn("Failed to list withdraw links to get ID:", listError.message);
        return res.status(200).json({
          status: "ok",
          lnurl: withdrawData.lnurl,
          amount: amount,
        });
      }
      
      // Find the link we just created by matching the title
      const bountyTitle = withdrawTitle;
      const createdLink = allLinks.find((link: any) => link.title === bountyTitle);
      
      if (createdLink && createdLink.id) {
        return res.status(200).json({
          status: "ok",
          withdrawId: createdLink.id,
          lnurl: withdrawData.lnurl,
          amount: amount,
        });
      }
      
      // Last resort: return lnurl only
      console.warn("Could not find withdraw link ID");
      return res.status(200).json({
        status: "ok",
        lnurl: withdrawData.lnurl,
        amount: amount,
      });
    }

    // Construct the shareable withdraw link URL
    // Format: https://bitcoindelta.club/withdraw/{withdrawId}
    const withdrawUrl = `${finalLnbitsUrl.replace(/\/$/, "")}/withdraw/${withdrawId}`;

    // Return the withdraw link ID, lnurl, and shareable URL from POST response
    return res.status(200).json({
      status: "ok",
      withdrawId: withdrawId,
      lnurl: withdrawData.lnurl,
      withdrawUrl: withdrawUrl, // Shareable link for user to claim
      amount: amount,
      // Store additional metadata if available
      title: withdrawData.title,
      uses: withdrawData.uses,
      maxWithdrawable: withdrawData.max_withdrawable,
    });
  } catch (error: any) {
    console.error("Bounty withdraw link creation error:", error);
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to create withdraw link",
    });
  }
}

