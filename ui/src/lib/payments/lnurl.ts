// LNURL Pay protocol implementation
// LNURL is a bech32-encoded URL that resolves to payment endpoints

import { bech32 } from "bech32";

export interface LNURLPayResponse {
  callback: string;
  minSendable?: number;
  maxSendable?: number;
  metadata: string;
  tag: "payRequest";
  commentAllowed?: number; // Max comment length (0 = comments not allowed)
}

export interface LNURLPayCallbackResponse {
  pr: string; // BOLT11 invoice
  routes?: any[];
}

/**
 * Decode LNURL from bech32 format (e.g., "LNURL1DP68G...")
 */
export function decodeLNURL(lnurl: string): string {
  if (!lnurl) {
    throw new Error("Empty LNURL");
  }

  // Remove "lightning:" or "LIGHTNING:" prefix if present
  const clean = lnurl.replace(/^lightning:/i, "");

  // If it's already a URL, return it
  if (clean.startsWith("http://") || clean.startsWith("https://")) {
    return clean;
  }

  try {
    const decoded = bech32.decode(clean.toUpperCase(), 1500);
    const words = bech32.fromWords(decoded.words);
    // Convert words array (numbers 0-255) to Uint8Array, then to string
    // This works in both Node.js and browser environments
    // bech32.fromWords returns an array of numbers (bytes)
    const bytes = new Uint8Array(words);
    // Convert bytes to string using TextDecoder (works everywhere)
    if (typeof TextDecoder !== "undefined") {
      return new TextDecoder("utf-8").decode(bytes);
    }
    // Fallback for very old browsers (shouldn't be needed)
    let url = "";
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i];
      if (byte !== undefined) {
        url += String.fromCharCode(byte);
      }
    }
    return url;
  } catch (error: any) {
    throw new Error(`Failed to decode LNURL: ${error.message}`);
  }
}

/**
 * Resolve LNURL to get payment parameters
 */
export async function resolveLNURL(lnurl: string): Promise<LNURLPayResponse> {
  const url = decodeLNURL(lnurl);
  
  const response = await fetch(url);
  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    console.error("LNURL resolution failed:", response.status, response.statusText);
    throw new Error(`LNURL resolution failed: ${response.statusText}`);
  }
  
  const data = await response.json();
  
  if (data.status === "ERROR") {
    throw new Error(`LNURL error: ${data.reason || "Unknown error"}`);
  }
  
  if (data.tag !== "payRequest") {
    throw new Error(`Unsupported LNURL tag: ${data.tag || "unknown"}`);
  }
  
  return data as LNURLPayResponse;
}

/**
 * Create invoice from LNURL/LUD-16 address
 * LUD-16 format: name@domain.com
 */
export async function createInvoiceFromLightningAddress(
  lud16: string,
  amount: number, // millisats
  comment?: string
): Promise<string> {
  // LUD-16 format: name@domain.com
  // Convert to LNURL: https://domain.com/.well-known/lnurlp/name
  const [name, domain] = lud16.split("@");
  if (!name || !domain) {
    throw new Error(`Invalid LUD-16 format: ${lud16}`);
  }
  
  const lnurl = `https://${domain}/.well-known/lnurlp/${name}`;
  return createInvoiceFromLNURL(lnurl, amount, comment);
}

/**
 * Create invoice from LNURL by calling the callback
 */
export async function createInvoiceFromLNURL(
  lnurl: string,
  amount: number, // millisats
  comment?: string
): Promise<string> {
  // Resolve LNURL if it's bech32 encoded
  let resolvedUrl = lnurl;
  if (!lnurl.startsWith("http://") && !lnurl.startsWith("https://")) {
    resolvedUrl = decodeLNURL(lnurl);
  }
  
  const payResponse = await resolveLNURL(resolvedUrl);
  
  if (!payResponse.callback) {
    throw new Error("LNURL callback not found");
  }
  
  if (payResponse.minSendable && amount < payResponse.minSendable) {
    throw new Error(`Amount too low. Minimum: ${payResponse.minSendable} msats (requested: ${amount} msats)`);
  }
  if (payResponse.maxSendable && amount > payResponse.maxSendable) {
    throw new Error(`Amount too high. Maximum: ${payResponse.maxSendable} msats (requested: ${amount} msats)`);
  }
  
  const commentAllowed = payResponse.commentAllowed ?? 0;
  const callbackUrl = new URL(payResponse.callback);
  callbackUrl.searchParams.set("amount", String(amount));
  
  // Add comment if provided and allowed
  // Some LNbits versions expect the comment parameter to be present even if empty
  if (commentAllowed > 0 && comment) {
    // Truncate comment to allowed length
    const truncatedComment = comment.length > commentAllowed 
      ? comment.substring(0, commentAllowed) 
      : comment;
    callbackUrl.searchParams.set("comment", truncatedComment);
  } else if (commentAllowed > 0) {
    // LNbits compatibility: include empty comment parameter if comments are allowed
    // This ensures compatibility with newer LNbits versions that expect the parameter
    callbackUrl.searchParams.set("comment", "");
  }
  // If commentAllowed === 0, don't include comment parameter at all (Alby compatibility)
  
  const finalCallbackUrl = callbackUrl.toString();
  
  const callbackResponse = await fetch(finalCallbackUrl, {
    method: "GET",
    headers: {
      "Accept": "application/json",
    }
  });
  
  if (!callbackResponse.ok) {
    const errorText = await callbackResponse.text();
    let errorMessage = `LNURL callback failed: ${callbackResponse.status} ${callbackResponse.statusText}`;
    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.reason || errorJson.message) {
        errorMessage += ` - ${errorJson.reason || errorJson.message}`;
      }
    } catch {
      if (errorText && errorText.length > 0) {
        errorMessage += ` - ${errorText.substring(0, 200)}`;
      }
    }
    throw new Error(errorMessage);
  }
  
  const callbackData = await callbackResponse.json() as LNURLPayCallbackResponse;
  
  if (callbackData.pr) {
    return callbackData.pr;
  }
  
  throw new Error("No invoice (pr) in LNURL callback response");
}

