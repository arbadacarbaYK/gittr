/**
 * Input validation utilities for API endpoints and user inputs
 * Prevents injection attacks, validates data types, enforces limits
 */

// Payment amount validation
export function validatePaymentAmount(amount: number | string): { valid: boolean; error?: string } {
  const num = typeof amount === "string" ? Number(amount) : amount;
  
  if (!Number.isInteger(num)) {
    return { valid: false, error: "Amount must be an integer" };
  }
  
  if (num <= 0) {
    return { valid: false, error: "Amount must be positive" };
  }
  
  if (num > 10000000) {
    return { valid: false, error: "Amount exceeds maximum (10,000,000 sats)" };
  }
  
  return { valid: true };
}

// URL validation
export function validateUrl(url: string, allowedProtocols: string[] = ["https:", "http:", "wss:", "ws:"]): { valid: boolean; error?: string } {
  if (!url || typeof url !== "string") {
    return { valid: false, error: "URL is required" };
  }
  
  if (url.length > 2000) {
    return { valid: false, error: "URL too long" };
  }
  
  try {
    const parsed = new URL(url);
    if (!allowedProtocols.includes(parsed.protocol)) {
      return { valid: false, error: `Protocol not allowed. Allowed: ${allowedProtocols.join(", ")}` };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }
}

// Lightning address validation (LUD-16)
export function validateLightningAddress(address: string): { valid: boolean; error?: string } {
  if (!address || typeof address !== "string") {
    return { valid: false, error: "Lightning address is required" };
  }
  
  if (address.length > 200) {
    return { valid: false, error: "Lightning address too long" };
  }
  
  // LUD-16 format: name@domain
  const lud16Regex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!lud16Regex.test(address)) {
    return { valid: false, error: "Lightning address must be in format: name@domain" };
  }
  
  return { valid: true };
}

// Pubkey/npub validation
export function validatePubkey(pubkey: string): { valid: boolean; error?: string } {
  if (!pubkey || typeof pubkey !== "string") {
    return { valid: false, error: "Pubkey is required" };
  }
  
  // Hex pubkey (64 chars) or npub (bech32, starts with npub1)
  if (pubkey.startsWith("npub1")) {
    if (pubkey.length > 100) {
      return { valid: false, error: "Invalid npub format" };
    }
    return { valid: true };
  }
  
  // Hex pubkey
  if (/^[0-9a-f]{64}$/i.test(pubkey)) {
    return { valid: true };
  }
  
  return { valid: false, error: "Invalid pubkey format (must be hex or npub)" };
}

// Repository name validation
export function validateRepoName(name: string): { valid: boolean; error?: string } {
  if (!name || typeof name !== "string") {
    return { valid: false, error: "Repository name is required" };
  }
  
  if (name.length < 1 || name.length > 100) {
    return { valid: false, error: "Repository name must be between 1 and 100 characters" };
  }
  
  // Alphanumeric, hyphens, underscores, dots
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    return { valid: false, error: "Repository name can only contain letters, numbers, dots, hyphens, and underscores" };
  }
  
  return { valid: true };
}

// Text content validation (for comments, descriptions, etc.)
export function validateTextContent(content: string, maxLength: number = 10000, fieldName: string = "Content"): { valid: boolean; error?: string } {
  if (content === undefined || content === null) {
    return { valid: false, error: `${fieldName} is required` };
  }
  
  if (typeof content !== "string") {
    return { valid: false, error: `${fieldName} must be a string` };
  }
  
  if (content.length > maxLength) {
    return { valid: false, error: `${fieldName} must be ${maxLength} characters or less` };
  }
  
  // Check for potential script tags (basic XSS prevention)
  if (/<script[\s\S]*?>[\s\S]*?<\/script>/gi.test(content)) {
    return { valid: false, error: `${fieldName} contains invalid content` };
  }
  
  return { valid: true };
}

// Sanitize HTML content (basic)
export function sanitizeHtml(html: string): string {
  // Remove script tags
  let sanitized = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
  
  // Remove event handlers
  sanitized = sanitized.replace(/\son\w+\s*=\s*["'][^"']*["']/gi, "");
  
  return sanitized;
}

// Validate GitHub URL
export function validateGitHubUrl(url: string): { valid: boolean; error?: string } {
  const urlValidation = validateUrl(url, ["https:"]);
  if (!urlValidation.valid) {
    return urlValidation;
  }
  
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("github.com")) {
      return { valid: false, error: "Must be a GitHub URL" };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid GitHub URL format" };
  }
}

// Validate LNURL
export function validateLNURL(lnurl: string): { valid: boolean; error?: string } {
  if (!lnurl || typeof lnurl !== "string") {
    return { valid: false, error: "LNURL is required" };
  }
  
  if (lnurl.length > 500) {
    return { valid: false, error: "LNURL too long" };
  }
  
  // LNURL can be: lnurl1..., https://..., or just a URL
  if (lnurl.startsWith("lnurl1") || lnurl.startsWith("LNURL1")) {
    return { valid: true };
  }
  
  const urlValidation = validateUrl(lnurl);
  return urlValidation;
}

// Validate NWC string
export function validateNWCString(nwc: string): { valid: boolean; error?: string } {
  if (!nwc || typeof nwc !== "string") {
    return { valid: false, error: "NWC string is required" };
  }
  
  if (nwc.length > 500) {
    return { valid: false, error: "NWC string too long" };
  }
  
  // NWC format: nostr+walletconnect://...
  if (!nwc.startsWith("nostr+walletconnect://")) {
    return { valid: false, error: "NWC string must start with 'nostr+walletconnect://'" };
  }
  
  return { valid: true };
}

// Validate tag array
export function validateTags(tags: any): { valid: boolean; error?: string; sanitized?: string[] } {
  if (!Array.isArray(tags)) {
    return { valid: false, error: "Tags must be an array" };
  }
  
  if (tags.length > 20) {
    return { valid: false, error: "Maximum 20 tags allowed" };
  }
  
  const sanitized: string[] = [];
  for (const tag of tags) {
    if (typeof tag !== "string") {
      return { valid: false, error: "All tags must be strings" };
    }
    
    if (tag.length > 50) {
      return { valid: false, error: "Each tag must be 50 characters or less" };
    }
    
    // Alphanumeric, hyphens, underscores only
    if (!/^[a-zA-Z0-9_-]+$/.test(tag)) {
      return { valid: false, error: "Tags can only contain letters, numbers, hyphens, and underscores" };
    }
    
    sanitized.push(tag.toLowerCase());
  }
  
  return { valid: true, sanitized };
}

