/**
 * Pending Changes Tracking System
 * 
 * Tracks file edits, deletions, and uploads that should be included in a PR
 */

export interface PendingEdit {
  path: string;
  before: string;
  after: string;
  type: "edit" | "delete";
  timestamp: number;
}

export interface PendingUpload {
  path: string;
  content: string; // For text files: text content, for binary files: base64-encoded string
  timestamp: number;
  isBinary?: boolean; // Flag to indicate binary files (images, PDFs, etc.)
  mimeType?: string; // Preserve MIME type so we can render preview (png, jpg, etc.)
}

const getPendingEditsKey = (entity: string, repo: string, pubkey: string) => 
  `gittr_pending_edits__${entity}__${repo}__${pubkey}`;

const getPendingUploadsKey = (entity: string, repo: string, pubkey: string) => 
  `gittr_pending_uploads__${entity}__${repo}__${pubkey}`;

/**
 * Get all pending edits for a user in a repository
 */
export function getPendingEdits(entity: string, repo: string, pubkey: string): PendingEdit[] {
  try {
    const key = getPendingEditsKey(entity, repo, pubkey);
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/**
 * Add or update a pending edit
 */
export function addPendingEdit(entity: string, repo: string, pubkey: string, edit: PendingEdit): void {
  try {
    const key = getPendingEditsKey(entity, repo, pubkey);
    const existing = getPendingEdits(entity, repo, pubkey);
    // Remove existing edit for same path, add new one
    const filtered = existing.filter(e => e.path !== edit.path);
    filtered.push(edit);
    localStorage.setItem(key, JSON.stringify(filtered));
  } catch (error) {
    console.error("Failed to save pending edit:", error);
  }
}

/**
 * Remove a pending edit
 */
export function removePendingEdit(entity: string, repo: string, pubkey: string, path: string): void {
  try {
    const key = getPendingEditsKey(entity, repo, pubkey);
    const existing = getPendingEdits(entity, repo, pubkey);
    const filtered = existing.filter(e => e.path !== path);
    localStorage.setItem(key, JSON.stringify(filtered));
  } catch (error) {
    console.error("Failed to remove pending edit:", error);
  }
}

/**
 * Clear all pending edits (typically after PR creation)
 */
export function clearPendingEdits(entity: string, repo: string, pubkey: string): void {
  try {
    const key = getPendingEditsKey(entity, repo, pubkey);
    localStorage.removeItem(key);
  } catch (error) {
    console.error("Failed to clear pending edits:", error);
  }
}

/**
 * Get all pending uploads for a user in a repository
 */
export function getPendingUploads(entity: string, repo: string, pubkey: string): PendingUpload[] {
  try {
    const key = getPendingUploadsKey(entity, repo, pubkey);
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/**
 * Add a pending upload
 */
export function addPendingUpload(entity: string, repo: string, pubkey: string, upload: PendingUpload): void {
  try {
    const key = getPendingUploadsKey(entity, repo, pubkey);
    const existing = getPendingUploads(entity, repo, pubkey);
    // Remove existing upload for same path, add new one
    const filtered = existing.filter(u => u.path !== upload.path);
    filtered.push(upload);
    localStorage.setItem(key, JSON.stringify(filtered));
  } catch (error) {
    console.error("Failed to save pending upload:", error);
  }
}

/**
 * Remove a pending upload
 */
export function removePendingUpload(entity: string, repo: string, pubkey: string, path: string): void {
  try {
    const key = getPendingUploadsKey(entity, repo, pubkey);
    const existing = getPendingUploads(entity, repo, pubkey);
    const filtered = existing.filter(u => u.path !== path);
    localStorage.setItem(key, JSON.stringify(filtered));
  } catch (error) {
    console.error("Failed to remove pending upload:", error);
  }
}

/**
 * Clear all pending uploads
 */
export function clearPendingUploads(entity: string, repo: string, pubkey: string): void {
  try {
    const key = getPendingUploadsKey(entity, repo, pubkey);
    localStorage.removeItem(key);
  } catch (error) {
    console.error("Failed to clear pending uploads:", error);
  }
}

/**
 * Get all pending changes (edits + uploads) for a user
 */
export function getAllPendingChanges(entity: string, repo: string, pubkey: string): {
  edits: PendingEdit[];
  uploads: PendingUpload[];
} {
  return {
    edits: getPendingEdits(entity, repo, pubkey),
    uploads: getPendingUploads(entity, repo, pubkey),
  };
}

/**
 * Clear all pending changes (edits + uploads)
 */
export function clearAllPendingChanges(entity: string, repo: string, pubkey: string): void {
  clearPendingEdits(entity, repo, pubkey);
  clearPendingUploads(entity, repo, pubkey);
}

