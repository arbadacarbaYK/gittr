/**
 * Payment settings encryption
 * Encrypts sensitive payment configuration before storing in localStorage
 */

// Use the encryption library functions
import { encryptData, decryptData } from "./encryption";

const PAYMENT_SETTINGS_KEY = "gittr_payment_settings_encrypted";
const ENCRYPTION_KEY_DERIVATION = "payment-settings-key";

/**
 * Get encryption key for payment settings (derived from user's encryption password)
 */
async function getPaymentEncryptionKey(password: string): Promise<CryptoKey> {
  // Use the same encryption library, but with a different key derivation
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );
  
  const salt = encoder.encode(ENCRYPTION_KEY_DERIVATION);
  
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt payment settings
 */
export async function encryptPaymentSettings(
  settings: {
    lnurl?: string;
    lnaddress?: string;
    nwcRecv?: string;
    nwcSend?: string;
    lnbitsUrl?: string;
    lnbitsAdminKey?: string;
  },
  password: string
): Promise<string> {
  const settingsJson = JSON.stringify(settings);
  const encrypted = await encryptData(settingsJson, password);
  return encrypted;
}

/**
 * Decrypt payment settings
 */
export async function decryptPaymentSettings(
  encryptedData: string,
  password: string
): Promise<{
  lnurl?: string;
  lnaddress?: string;
  nwcRecv?: string;
  nwcSend?: string;
  lnbitsUrl?: string;
  lnbitsAdminKey?: string;
} | null> {
  try {
    const decrypted = await decryptData(encryptedData, password);
    return JSON.parse(decrypted);
  } catch (error) {
    console.error("Failed to decrypt payment settings:", error);
    return null;
  }
}

/**
 * Store encrypted payment settings in localStorage
 */
export async function storeEncryptedPaymentSettings(
  settings: {
    lnurl?: string;
    lnaddress?: string;
    nwcRecv?: string;
    nwcSend?: string;
    lnbitsUrl?: string;
    lnbitsAdminKey?: string;
  },
  password: string
): Promise<void> {
  const encrypted = await encryptPaymentSettings(settings, password);
  localStorage.setItem(PAYMENT_SETTINGS_KEY, encrypted);
}

/**
 * Load and decrypt payment settings from localStorage
 */
export async function loadEncryptedPaymentSettings(
  password: string
): Promise<{
  lnurl?: string;
  lnaddress?: string;
  nwcRecv?: string;
  nwcSend?: string;
  lnbitsUrl?: string;
  lnbitsAdminKey?: string;
} | null> {
  const encrypted = localStorage.getItem(PAYMENT_SETTINGS_KEY);
  if (!encrypted) {
    return null;
  }
  
  return decryptPaymentSettings(encrypted, password);
}

/**
 * Check if payment settings are encrypted
 */
export function hasEncryptedPaymentSettings(): boolean {
  return localStorage.getItem(PAYMENT_SETTINGS_KEY) !== null;
}

/**
 * Remove encrypted payment settings
 */
export function clearEncryptedPaymentSettings(): void {
  localStorage.removeItem(PAYMENT_SETTINGS_KEY);
}

