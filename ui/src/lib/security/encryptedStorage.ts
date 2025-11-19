/**
 * Encrypted storage wrapper for sensitive localStorage data
 * Automatically encrypts/decrypts using Web Crypto API
 */

import {
  getEncryptedItem,
  setEncryptedItem,
  removeEncryptedItem,
  isEncryptionEnabled as checkEncryptionEnabled,
} from "./encryption";

/**
 * Get the encryption password from session memory (set after unlock)
 */
function getSessionPassword(): string | null {
  if (typeof window === "undefined") return null;
  return (window as any).__gittr_encryption_password || null;
}

/**
 * Store sensitive data (encrypted if encryption is enabled)
 */
export async function setSecureItem(key: string, value: string): Promise<void> {
  if (checkEncryptionEnabled()) {
    const password = getSessionPassword();
    if (!password) {
      // Encryption is enabled but password not in session - prompt user
      throw new Error("Encryption password required. Please unlock encryption in Settings.");
    }
    await setEncryptedItem(key, value, password);
  } else {
    // Store plaintext (with warning in console for development)
    if (process.env.NODE_ENV === "development") {
    }
    localStorage.setItem(key, value);
  }
}

/**
 * Get sensitive data (decrypted if encryption is enabled)
 */
export async function getSecureItem(key: string): Promise<string | null> {
  if (checkEncryptionEnabled()) {
    const password = getSessionPassword();
    if (!password) {
      // Encryption is enabled but password not in session
      console.warn(`Encryption password required for ${key}. Returning null.`);
      return null;
    }
    try {
      const decrypted = await getEncryptedItem(key, password);
      return decrypted;
    } catch (error) {
      console.error(`Failed to decrypt ${key}:`, error);
      return null;
    }
  } else {
    // Get plaintext
    return localStorage.getItem(key);
  }
}

/**
 * Remove sensitive data (works for both encrypted and plaintext)
 */
export function removeSecureItem(key: string): void {
  if (checkEncryptionEnabled()) {
    removeEncryptedItem(key);
    // Also remove plaintext version if it exists (migration cleanup)
    localStorage.removeItem(key);
  } else {
    localStorage.removeItem(key);
  }
}

/**
 * Helper specifically for Nostr private key
 */
export async function getNostrPrivateKey(): Promise<string | null> {
  return getSecureItem("nostr:privkey");
}

/**
 * Helper specifically for Nostr private key
 */
export async function setNostrPrivateKey(privateKey: string): Promise<void> {
  await setSecureItem("nostr:privkey", privateKey);
}

/**
 * Helper specifically for Nostr private key
 */
export function removeNostrPrivateKey(): void {
  removeSecureItem("nostr:privkey");
}

/**
 * Check if encryption is enabled
 */
export function isEncryptionEnabled(): boolean {
  return checkEncryptionEnabled();
}

/**
 * Check if we can access encrypted data (password is in session)
 */
export function isEncryptionUnlocked(): boolean {
  return !checkEncryptionEnabled() || !!getSessionPassword();
}

