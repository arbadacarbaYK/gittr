/**
 * LNbits API Adapter
 * 
 * Supports both:
 * - LNbits v0.12.12 (bitcoindelta.club) - Legacy API
 * - LNbits latest (azzamo.online) - New API
 * 
 * Automatically detects version and adapts API calls accordingly
 */

export type LNbitsApiVersion = '0.12.12' | 'latest' | 'unknown';

export interface LNbitsConfig {
  url: string;
  adminKey: string;
  invoiceKey?: string;
}

export interface LNbitsPaymentRequest {
  out: boolean; // true = sending payment, false = creating invoice
  amount?: number; // millisats (for creating invoice)
  bolt11?: string; // BOLT11 invoice (for paying)
  memo?: string;
  extra?: Record<string, any>;
}

export interface LNbitsPaymentResponse {
  payment_request?: string;
  bolt11?: string;
  payment_hash?: string;
  checking_id?: string;
  // Additional fields that may vary by version
  [key: string]: any;
}

export interface LNbitsWalletResponse {
  balance?: number;
  balance_msat?: number;
  balanceMsat?: number;
  id?: string;
  wallet_id?: string;
  name?: string;
  [key: string]: any;
}

/**
 * Detect LNbits API version by querying the /api/v1/info endpoint
 */
export async function detectLNbitsVersion(config: LNbitsConfig): Promise<LNbitsApiVersion> {
  try {
    const normalizedUrl = config.url.replace(/\/$/, '');
    const infoResponse = await fetch(`${normalizedUrl}/api/v1/info`, {
      method: 'GET',
      headers: {
        'X-Api-Key': config.adminKey,
        'Content-Type': 'application/json',
      },
    });

    if (!infoResponse.ok) {
      // If info endpoint doesn't exist, try to infer from other endpoints
      return 'unknown';
    }

    const infoData = await infoResponse.json();
    const version = infoData.version || infoData.lnbits_version;

    if (version) {
      // Compare version strings
      if (version.startsWith('0.12.') || version === '0.12.12') {
        return '0.12.12';
      }
      // Assume newer versions use latest API
      return 'latest';
    }

    // Fallback: try to detect by API behavior
    return 'unknown';
  } catch (error) {
    console.warn('Failed to detect LNbits version:', error);
    return 'unknown';
  }
}

/**
 * Create payment/invoice using version-appropriate API
 */
export async function createPayment(
  config: LNbitsConfig,
  request: LNbitsPaymentRequest,
  version?: LNbitsApiVersion
): Promise<LNbitsPaymentResponse> {
  const apiVersion = version || await detectLNbitsVersion(config);
  const normalizedUrl = config.url.replace(/\/$/, '');

  const headers: Record<string, string> = {
    'X-Api-Key': config.adminKey,
    'Content-Type': 'application/json',
  };

  // Build request body - use format compatible with both versions
  // Start with common fields that work in both versions
  let body: Record<string, any> = {
    out: request.out,
  };

  if (request.out) {
    // Paying invoice - both versions use bolt11
    if (!request.bolt11) {
      throw new Error('bolt11 invoice is required for outgoing payments');
    }
    body.bolt11 = request.bolt11;
    
    // Include extra fields if provided (works in both versions)
    if (request.extra) {
      body.extra = request.extra;
    } else if (request.memo) {
      // Some versions expect memo in extra
      body.extra = { memo: request.memo, comment: request.memo };
    }
  } else {
    // Creating invoice - both versions use amount
    if (!request.amount) {
      throw new Error('amount is required for creating invoices');
    }
    body.amount = request.amount;
    
    // Include memo - both versions support 'memo' field
    // For 'unknown' version, try with just memo first, then add description if needed
    if (request.memo) {
      body.memo = request.memo;
      // If version is latest or unknown, also include description for compatibility
      if (apiVersion === 'latest' || apiVersion === 'unknown') {
        body.description = request.memo;
      }
    }
  }

  // Try the request - if it fails with validation error, try alternative format
  let response: Response;
  let data: any;
  
  try {
    response = await fetch(`${normalizedUrl}/api/v1/payments`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = errorText;
      
      // Try to parse error for better message
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.detail || errorJson.message || errorJson.error || errorText;
      } catch {
        // Keep original error text
      }
      
      // If it's a validation error (422) and we included 'description', try without it (legacy format)
      if ((apiVersion === 'latest' || apiVersion === 'unknown') && response.status === 422 && !request.out && body.description) {
        // Try without 'description' field (legacy v0.12.12 format)
        const legacyBody: Record<string, any> = { out: false, amount: request.amount };
        if (request.memo) {
          legacyBody.memo = request.memo;
        }
        
        const legacyResponse = await fetch(`${normalizedUrl}/api/v1/payments`, {
          method: 'POST',
          headers,
          body: JSON.stringify(legacyBody),
        });
        
        if (legacyResponse.ok) {
          data = await legacyResponse.json();
        } else {
          throw new Error(`LNbits payment API error: ${errorMessage}`);
        }
      } else {
        throw new Error(`LNbits payment API error: ${errorMessage}`);
      }
    } else {
      data = await response.json();
    }
  } catch (fetchError: any) {
    // Handle network errors
    if (fetchError.message && !fetchError.message.includes('LNbits') && !fetchError.message.includes('payment API')) {
      throw new Error(`Network error connecting to LNbits: ${fetchError.message}`);
    }
    throw fetchError;
  }

  // Normalize response format (works for both versions)
  const normalizedResponse: LNbitsPaymentResponse = {
    payment_request: data.payment_request || data.bolt11 || data.pr,
    bolt11: data.bolt11 || data.payment_request || data.pr,
    payment_hash: data.payment_hash || data.checking_id,
    checking_id: data.checking_id || data.payment_hash,
    ...data, // Include all other fields
  };

  return normalizedResponse;
}

/**
 * Get wallet balance using version-appropriate API
 */
export async function getWalletBalance(
  config: LNbitsConfig,
  version?: LNbitsApiVersion
): Promise<{ balance: number; balanceMsat: number; balanceSats: number }> {
  const apiVersion = version || await detectLNbitsVersion(config);
  const normalizedUrl = config.url.replace(/\/$/, '');

  const headers: Record<string, string> = {
    'X-Api-Key': config.adminKey,
    'Content-Type': 'application/json',
  };

  let walletData: LNbitsWalletResponse;

  // Try /api/v1/wallet first (works in both versions if admin key has direct access)
  let walletResponse = await fetch(`${normalizedUrl}/api/v1/wallet`, {
    method: 'GET',
    headers,
  });

  if (walletResponse.ok) {
    walletData = await walletResponse.json();
  } else {
    // Fallback: List wallets and get first one (more reliable across versions)
    const walletsResponse = await fetch(`${normalizedUrl}/api/v1/wallets`, {
      method: 'GET',
      headers,
    });

    if (!walletsResponse.ok) {
      const errorText = await walletsResponse.text();
      let errorMessage = 'Failed to fetch wallet balance';
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.detail || errorJson.message || errorJson.error || errorMessage;
      } catch {
        if (errorText) {
          errorMessage = errorText.substring(0, 200);
        }
      }
      throw new Error(errorMessage);
    }

    const wallets = await walletsResponse.json();
    // Handle both array format and object with data property (both versions)
    const walletList = Array.isArray(wallets) ? wallets : (wallets.data || wallets.wallets || []);
    
    if (walletList.length === 0) {
      throw new Error('No wallets found for this admin key');
    }

    // Get the first wallet (admin wallet)
    const adminWallet = walletList[0];
    const walletId = adminWallet.id || adminWallet.wallet_id;
    
    if (!walletId) {
      throw new Error('Wallet ID not found in response');
    }

    // Get balance for the specific wallet
    walletResponse = await fetch(`${normalizedUrl}/api/v1/wallet/${walletId}`, {
      method: 'GET',
      headers,
    });

    if (!walletResponse.ok) {
      const errorText = await walletResponse.text();
      let errorMessage = 'Failed to fetch wallet balance';
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.detail || errorJson.message || errorJson.error || errorMessage;
      } catch {
        if (errorText) {
          errorMessage = errorText.substring(0, 200);
        }
      }
      throw new Error(errorMessage);
    }

    walletData = await walletResponse.json();
  }

  // Normalize balance field (always in millisats)
  const balanceMsat = walletData.balance_msat ?? walletData.balanceMsat ?? walletData.balance ?? 0;
  const balanceSats = Math.floor(balanceMsat / 1000);

  return {
    balance: balanceMsat,
    balanceMsat,
    balanceSats,
  };
}

/**
 * Create withdraw link using version-appropriate API
 */
export async function createWithdrawLink(
  config: LNbitsConfig,
  params: {
    title: string;
    min_withdrawable: number; // millisats
    max_withdrawable: number; // millisats
    uses?: number;
    wait_time?: number;
    is_unique?: boolean;
  },
  version?: LNbitsApiVersion
): Promise<{ id: string; lnurl: string; title?: string; uses?: number; max_withdrawable?: number }> {
  const apiVersion = version || await detectLNbitsVersion(config);
  const normalizedUrl = config.url.replace(/\/$/, '');

  const headers: Record<string, string> = {
    'X-Api-Key': config.adminKey,
    'Content-Type': 'application/json',
  };

  // Build request body - check if latest API requires different fields
  const body: Record<string, any> = {
    title: params.title,
    min_withdrawable: params.min_withdrawable,
    max_withdrawable: params.max_withdrawable,
  };

  if (params.uses !== undefined) {
    body.uses = params.uses;
  }
  if (params.wait_time !== undefined) {
    body.wait_time = params.wait_time;
  }
  if (params.is_unique !== undefined) {
    body.is_unique = params.is_unique;
  }

  // Both API versions use the same format for withdraw links
  // The withdraw extension API is consistent across versions

  const response = await fetch(`${normalizedUrl}/withdraw/api/v1/links`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create withdraw link: ${errorText}`);
  }

  const data = await response.json();

  // Normalize response
  return {
    id: data.id || data.link_id || data.withdraw_id,
    lnurl: data.lnurl || data.lnurlw,
    title: data.title,
    uses: data.uses,
    max_withdrawable: data.max_withdrawable || data.maxWithdrawable,
  };
}

/**
 * Get withdraw link details
 */
export async function getWithdrawLink(
  config: LNbitsConfig,
  linkId: string,
  version?: LNbitsApiVersion
): Promise<any> {
  const apiVersion = version || await detectLNbitsVersion(config);
  const normalizedUrl = config.url.replace(/\/$/, '');

  const headers: Record<string, string> = {
    'X-Api-Key': config.adminKey,
    'Content-Type': 'application/json',
  };

  // Use invoice key if available (read-only access)
  const apiKey = config.invoiceKey || config.adminKey;

  const response = await fetch(`${normalizedUrl}/withdraw/api/v1/links/${linkId}`, {
    method: 'GET',
    headers: {
      ...headers,
      'X-Api-Key': apiKey,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get withdraw link: ${errorText}`);
  }

  return await response.json();
}

/**
 * List withdraw links
 */
export async function listWithdrawLinks(
  config: LNbitsConfig,
  version?: LNbitsApiVersion
): Promise<any[]> {
  const apiVersion = version || await detectLNbitsVersion(config);
  const normalizedUrl = config.url.replace(/\/$/, '');

  // Use invoice key if available (read-only access)
  const apiKey = config.invoiceKey || config.adminKey;

  const response = await fetch(`${normalizedUrl}/withdraw/api/v1/links`, {
    method: 'GET',
    headers: {
      'X-Api-Key': apiKey,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to list withdraw links: ${errorText}`);
  }

  const data = await response.json();
  
  // Normalize response format (might be array or object with data property)
  return Array.isArray(data) ? data : (data.data || data.links || []);
}

