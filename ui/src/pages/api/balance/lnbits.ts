import type { NextApiRequest, NextApiResponse } from "next";
import { setCorsHeaders, handleOptionsRequest } from "@/lib/api/cors";

// LNbits Balance endpoint - fetches wallet balance
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

  const { lnbitsUrl, lnbitsAdminKey } = req.body || {};

  if (!lnbitsUrl || !lnbitsAdminKey) {
    return res.status(400).json({ 
      status: "missing_params", 
      message: "Missing LNbits URL or Admin Key" 
    });
  }

  try {
    // Normalize LNbits URL (remove trailing slash)
    const normalizedUrl = lnbitsUrl.replace(/\/$/, '');
    
    // With admin key, we need to list wallets first, then get balance of the admin wallet
    // Try admin endpoint to list wallets
    const walletsResponse = await fetch(`${normalizedUrl}/api/v1/wallets`, {
      method: "GET",
      headers: {
        "X-Api-Key": lnbitsAdminKey,
        "Content-Type": "application/json",
      },
    });
    
    if (!walletsResponse.ok) {
      // If wallets endpoint doesn't work, try direct wallet endpoint
      // Some LNbits instances allow admin key to access /wallet directly
      const balanceResponse = await fetch(`${normalizedUrl}/api/v1/wallet`, {
        method: "GET",
        headers: {
          "X-Api-Key": lnbitsAdminKey,
          "Content-Type": "application/json",
        },
      });
      
      if (!balanceResponse.ok) {
        const errorText = await balanceResponse.text();
        let errorMessage = "Failed to fetch balance from LNbits";
        
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.detail || errorJson.message || errorJson.error || errorMessage;
        } catch {
          if (errorText) {
            errorMessage = errorText.substring(0, 200);
          }
        }
        
        return res.status(400).json({
          status: "error",
          message: errorMessage || `HTTP ${balanceResponse.status}: ${balanceResponse.statusText}`,
          httpStatus: balanceResponse.status,
        });
      }
      
      const walletData = await balanceResponse.json();
      
      // LNbits API returns balance in millisats (msat)
      // Check which field exists - all LNbits balance fields are in millisats
      let balanceMsat = 0;
      if (walletData.balance_msat !== undefined) {
        balanceMsat = walletData.balance_msat;
      } else if (walletData.balanceMsat !== undefined) {
        balanceMsat = walletData.balanceMsat;
      } else if (walletData.balance !== undefined) {
        // LNbits 'balance' field is ALWAYS in millisats
        balanceMsat = walletData.balance;
      }
      
      // Convert millisats to sats (always divide by 1000)
      const balanceSats = Math.floor(balanceMsat / 1000);
      
      return res.status(200).json({
        status: "ok",
        balance: balanceMsat, // Raw balance in millisats
        balanceSats: balanceSats, // Balance in sats
        currency: "sats",
      });
    }
    
    // If wallets endpoint works, get the first wallet (admin wallet)
    const walletsData = await walletsResponse.json();
    
    if (!Array.isArray(walletsData) || walletsData.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "No wallets found for this admin key",
      });
    }
    
    // Get the admin wallet (usually the first one)
    const adminWallet = walletsData[0];
    const walletId = adminWallet.id || adminWallet.wallet_id;
    
    if (!walletId) {
      return res.status(400).json({
        status: "error",
        message: "Wallet ID not found in response",
      });
    }
    
    // Get balance for the admin wallet
    const balanceResponse = await fetch(`${normalizedUrl}/api/v1/wallet/${walletId}`, {
      method: "GET",
      headers: {
        "X-Api-Key": lnbitsAdminKey,
        "Content-Type": "application/json",
      },
    });
    
    if (!balanceResponse.ok) {
      const errorText = await balanceResponse.text();
      let errorMessage = "Failed to fetch wallet balance";
      
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.detail || errorJson.message || errorJson.error || errorMessage;
      } catch {
        if (errorText) {
          errorMessage = errorText.substring(0, 200);
        }
      }
      
      return res.status(400).json({
        status: "error",
        message: errorMessage || `HTTP ${balanceResponse.status}: ${balanceResponse.statusText}`,
        httpStatus: balanceResponse.status,
      });
    }

    const walletData = await balanceResponse.json();
    
    // LNbits wallet API returns balance in millisats (msat)
    // Check which field exists - all LNbits balance fields are in millisats
    let balanceMsat = 0;
    if (walletData.balance_msat !== undefined) {
      balanceMsat = walletData.balance_msat;
    } else if (walletData.balanceMsat !== undefined) {
      balanceMsat = walletData.balanceMsat;
    } else if (walletData.balance !== undefined) {
      // LNbits 'balance' field is ALWAYS in millisats
      balanceMsat = walletData.balance;
    }
    
    // Convert millisats to sats (always divide by 1000)
    const balanceSats = Math.floor(balanceMsat / 1000);
    
    return res.status(200).json({
      status: "ok",
      balance: balanceMsat, // Raw balance in millisats
      balanceSats: balanceSats, // Balance in sats
      currency: "sats",
    });
  } catch (error: any) {
    // Handle network errors, JSON parse errors, etc.
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to connect to LNbits API",
      errorType: error.name || "UnknownError",
    });
  }
}

