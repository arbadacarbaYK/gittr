/**
 * Client-side encryption for sensitive localStorage data
 * Uses Web Crypto API with AES-GCM encryption
 *
 * Security Notes:
 * - Encryption password is derived from user input using PBKDF2
 * - Salt is stored with encrypted data (not sensitive, prevents rainbow table attacks)
 * - IV (initialization vector) is generated per encryption (prevents same plaintext → same ciphertext)
 * - Keys are never stored, only derived on-demand from password
 */

// Storage key prefix for encrypted data
const ENCRYPTED_PREFIX = "gittr:encrypted:";
const SALT_KEY = "gittr:encryption:salt";
const PASSWORD_KEY = "gittr:encryption:password_hash"; // Hashed password for verification

// Key derivation parameters (PBKDF2)
const PBKDF2_ITERATIONS = 100000; // OWASP recommends 600k+, but 100k is faster for web
const PBKDF2_KEY_LENGTH = 256; // 256 bits = 32 bytes for AES-256

/**
 * Derive encryption key from password using PBKDF2
 */
async function deriveKey(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );

  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    passwordKey,
    { name: "AES-GCM", length: PBKDF2_KEY_LENGTH },
    false,
    ["encrypt", "decrypt"]
  );

  return key;
}

/**
 * Generate a salt for key derivation
 */
function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

/**
 * Generate an IV (initialization vector) for AES-GCM
 */
function generateIV(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(12)); // 12 bytes for GCM
}

/**
 * Hash password for verification (doesn't store actual password)
 */
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Encrypt sensitive data
 */
export async function encryptData(
  plaintext: string,
  password: string
): Promise<string> {
  try {
    // Generate salt and IV
    const salt = generateSalt();
    const iv = generateIV();

    // Derive encryption key from password
    const key = await deriveKey(password, salt);

    // Encrypt data
    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);
    const encrypted = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv as BufferSource,
      },
      key,
      data
    );

    // Combine salt + iv + ciphertext
    const saltArray = Array.from(salt);
    const ivArray = Array.from(iv);
    const ciphertextArray = Array.from(new Uint8Array(encrypted));

    // Encode as base64 for storage
    const combined = new Uint8Array([
      ...saltArray,
      ...ivArray,
      ...ciphertextArray,
    ]);
    const base64 = btoa(String.fromCharCode(...combined));

    return base64;
  } catch (error) {
    console.error("Encryption error:", error);
    throw new Error("Failed to encrypt data");
  }
}

/**
 * Decrypt sensitive data
 */
export async function decryptData(
  ciphertext: string,
  password: string
): Promise<string> {
  try {
    // Decode from base64
    const combined = new Uint8Array(
      atob(ciphertext)
        .split("")
        .map((c) => c.charCodeAt(0))
    );

    // Extract salt, IV, and ciphertext
    const salt = combined.slice(0, 16);
    const iv = combined.slice(16, 28);
    const encryptedData = combined.slice(28);

    // Derive decryption key
    const key = await deriveKey(password, salt);

    // Decrypt data
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv as BufferSource,
      },
      key,
      encryptedData
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (error) {
    console.error("Decryption error:", error);
    throw new Error("Failed to decrypt data. Wrong password?");
  }
}

/**
 * Check if encryption is enabled (password set)
 */
export function isEncryptionEnabled(): boolean {
  return !!localStorage.getItem(PASSWORD_KEY);
}

/**
 * Set encryption password (first time setup)
 */
export async function setEncryptionPassword(password: string): Promise<void> {
  // Store password hash for verification (not the password itself)
  const passwordHash = await hashPassword(password);
  localStorage.setItem(PASSWORD_KEY, passwordHash);

  // Store salt separately (for future key derivation if needed)
  // We'll regenerate salt per encryption, but store one for password verification
  const salt = generateSalt();
  localStorage.setItem(SALT_KEY, btoa(String.fromCharCode(...salt)));
}

/**
 * Verify encryption password
 */
export async function verifyEncryptionPassword(
  password: string
): Promise<boolean> {
  const storedHash = localStorage.getItem(PASSWORD_KEY);
  if (!storedHash) return false;

  const computedHash = await hashPassword(password);
  return storedHash === computedHash;
}

/**
 * Clear encryption password (disable encryption)
 */
export function clearEncryptionPassword(): void {
  localStorage.removeItem(PASSWORD_KEY);
  localStorage.removeItem(SALT_KEY);

  // Remove all encrypted data keys
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(ENCRYPTED_PREFIX)) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => localStorage.removeItem(key));
}

/**
 * Store encrypted sensitive data
 */
export async function setEncryptedItem(
  key: string,
  value: string,
  password: string
): Promise<void> {
  if (!isEncryptionEnabled()) {
    throw new Error(
      "Encryption not enabled. Call setEncryptionPassword() first."
    );
  }

  const encrypted = await encryptData(value, password);
  localStorage.setItem(`${ENCRYPTED_PREFIX}${key}`, encrypted);
}

/**
 * Get and decrypt sensitive data
 */
export async function getEncryptedItem(
  key: string,
  password: string
): Promise<string | null> {
  if (!isEncryptionEnabled()) {
    return null;
  }

  const encrypted = localStorage.getItem(`${ENCRYPTED_PREFIX}${key}`);
  if (!encrypted) {
    return null;
  }

  try {
    return await decryptData(encrypted, password);
  } catch (error) {
    console.error("Failed to decrypt item:", key, error);
    return null;
  }
}

/**
 * Remove encrypted item
 */
export function removeEncryptedItem(key: string): void {
  localStorage.removeItem(`${ENCRYPTED_PREFIX}${key}`);
}

/**
 * Migrate existing plaintext data to encrypted storage
 * Call this when user first enables encryption
 */
export async function migrateToEncrypted(
  key: string,
  password: string,
  migrateCallback?: () => string | null
): Promise<void> {
  // Check if plaintext version exists
  const plaintext = migrateCallback
    ? migrateCallback()
    : localStorage.getItem(key);
  if (!plaintext) {
    return; // Nothing to migrate
  }

  // Encrypt and store
  await setEncryptedItem(key, plaintext, password);

  // Remove plaintext version
  localStorage.removeItem(key);
}
