import { BridgeFilePayload } from "@/lib/nostr/push-repo-to-nostr";
import { checkBridgeExists } from "@/lib/utils/repo-status";

interface PushBridgeParams {
  ownerPubkey: string;
  repoSlug: string;
  entity: string;
  branch?: string;
  files: BridgeFilePayload[];
  commitDate?: number; // Unix timestamp in seconds (from lastNostrEventCreatedAt)
}

// CRITICAL: Chunk files to avoid 413 Request Entity Too Large errors
// nginx has a default client_max_body_size limit (usually 1MB, but can be configured)
// We'll chunk files into smaller batches to stay under the limit
// Using smaller chunks to be safe - each chunk should be well under 10MB
const CHUNK_SIZE = 30; // Number of files per chunk (conservative to avoid 413 errors)
const MAX_CHUNK_SIZE_BYTES = 8 * 1024 * 1024; // 8MB per chunk (safety margin below typical 10MB nginx limit)

function chunkFiles(files: BridgeFilePayload[]): BridgeFilePayload[][] {
  const chunks: BridgeFilePayload[][] = [];
  let currentChunk: BridgeFilePayload[] = [];
  let currentChunkSize = 0;

  for (const file of files) {
    // Estimate file size (content length + overhead for JSON encoding)
    const estimatedSize = file.content 
      ? (file.content.length * 1.5) + 500 // Base64 is ~1.33x, JSON overhead ~500 bytes
      : 1000; // Metadata only

    // If adding this file would exceed the limit, start a new chunk
    if (currentChunk.length > 0 && 
        (currentChunk.length >= CHUNK_SIZE || currentChunkSize + estimatedSize > MAX_CHUNK_SIZE_BYTES)) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentChunkSize = 0;
    }

    currentChunk.push(file);
    currentChunkSize += estimatedSize;
  }

  // Add the last chunk if it has files
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

export async function pushFilesToBridge({
  ownerPubkey,
  repoSlug,
  entity,
  branch = "main",
  files,
  commitDate,
}: PushBridgeParams) {
  // CRITICAL: Allow empty files array - we'll still create a commit with --allow-empty
  // This ensures every push creates a new commit with the current timestamp
  // Only skip if files is null/undefined (not if it's an empty array)
  if (!ownerPubkey || !repoSlug || files === null || files === undefined) {
    return { skipped: true };
  }
  
  // files can be an empty array [] - that's valid, we'll create an empty commit

  // CRITICAL: Chunk files to avoid 413 Request Entity Too Large errors
  const chunks = chunkFiles(files);
  console.log(`📦 [Bridge Push] Chunking ${files.length} files into ${chunks.length} chunk(s)`);

  if (chunks.length === 0) {
    // Empty files array - create empty commit
    chunks.push([]);
  }

  // CRITICAL: Each chunk gets its own timeout (5 minutes per chunk)
  // This ensures each chunk has a full 5-minute window, not a cumulative timeout
  const BRIDGE_PUSH_TIMEOUT_PER_CHUNK = 300000; // 5 minutes per chunk

  try {
    let allRefs: Array<{ ref: string; commit: string }> = [];
    let lastResult: any = null;

    // Push chunks sequentially to avoid overwhelming the server
    // CRITICAL: Each chunk must commit because each API call uses a new temp directory
    // Multiple commits are fine - they'll all be in the repo
    // NOTE: Empty chunks are allowed - they create empty commits (--allow-empty)
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      // CRITICAL: Allow empty chunks - they're used for empty commits
      // Don't skip them, just log that they're empty
      if (!chunk) {
        console.warn(`⚠️ [Bridge Push] Skipping null chunk ${i + 1}/${chunks.length}`);
        continue;
      }
      
      if (chunk.length === 0) {
        console.log(`📤 [Bridge Push] Pushing empty chunk ${i + 1}/${chunks.length} (will create empty commit)...`);
      } else {
        console.log(`📤 [Bridge Push] Pushing chunk ${i + 1}/${chunks.length} (${chunk.length} files)...`);
      }

      // CRITICAL: Create a new AbortController and timeout for each chunk
      // This ensures each chunk gets its own 5-minute window, not a cumulative timeout
      const chunkController = new AbortController();
      const chunkTimeoutId = setTimeout(() => chunkController.abort(), BRIDGE_PUSH_TIMEOUT_PER_CHUNK);

      try {
        const response = await fetch("/api/nostr/repo/push", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ownerPubkey,
            repo: repoSlug,
            branch,
            files: chunk,
            commitDate, // Pass commitDate to API (Unix timestamp in seconds)
            // CRITICAL: Commit each chunk because each API call uses a new temp directory
            // The last chunk will have the final state, previous chunks are intermediate commits
            createCommit: true, // Always commit - each chunk is a separate API call
            chunkIndex: i,
            totalChunks: chunks.length,
          }),
          signal: chunkController.signal,
        });

        // Check content type before parsing JSON
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          const text = await response.text();
          console.error(`❌ [Bridge Push] Chunk ${i + 1} returned non-JSON response:`, {
            status: response.status,
            contentType,
            preview: text.substring(0, 200),
          });
          throw new Error(`Bridge API returned HTML instead of JSON (status: ${response.status}). The endpoint may not exist or returned an error page.`);
        }

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || `Bridge push failed for chunk ${i + 1} (status: ${response.status})`);
        }

        lastResult = data;
        
        // CRITICAL: Always update refs with the current chunk's refs
        // Each chunk returns the complete refs (all commits in the repo after this chunk)
        // Each chunk should have refs because it commits and pushes
        // Missing refs from intermediate chunks is a problem because:
        // - Chunk 1 returns refs with commit SHA1 (has files 1-30)
        // - Chunk 2 should return refs with commit SHA2 (has files 1-60)
        // - If chunk 2 doesn't return refs, we keep chunk 1's refs (SHA1), which lacks files from chunk 2
        // - This breaks the contract that each chunk accumulates all previous files
        if (data.refs && Array.isArray(data.refs)) {
          allRefs = data.refs; // Update with current chunk's refs
        } else {
          // CRITICAL: Warn for ANY chunk missing refs, not just the last one
          // Missing refs from intermediate chunks causes stale commit SHAs in state events
          const isLastChunk = i === chunks.length - 1;
          console.warn(`⚠️ [Bridge Push] Chunk ${i + 1}/${chunks.length} (${isLastChunk ? 'last' : 'intermediate'}) did not return refs. ${isLastChunk ? 'Using refs from previous chunk.' : 'This may cause stale commit SHAs in state events - chunk may not have committed properly.'}`);
          
          // For intermediate chunks, this is more critical - we need accurate refs
          // But we don't fail here because the last chunk might still return valid refs
          // The final refs logic will handle the fallback
        }

        console.log(`✅ [Bridge Push] Chunk ${i + 1}/${chunks.length} pushed successfully`);
      } catch (chunkError: any) {
        clearTimeout(chunkTimeoutId);
        if (chunkError.name === 'AbortError') {
          throw new Error(`Bridge push timeout for chunk ${i + 1} after ${BRIDGE_PUSH_TIMEOUT_PER_CHUNK / 1000} seconds. The chunk may be too large.`);
        }
        throw chunkError;
      } finally {
        // Always clear the timeout for this chunk
        clearTimeout(chunkTimeoutId);
      }
    }

    // CRITICAL: Return the last chunk's result with the most recent refs
    // Priority: lastResult.refs (if valid) > allRefs (last known good) > empty array
    // The last chunk should have the final refs, but we use allRefs as fallback
    // in case lastResult.refs is missing or invalid
    const finalRefs = (lastResult?.refs && Array.isArray(lastResult.refs)) 
      ? lastResult.refs 
      : (allRefs.length > 0 ? allRefs : []);
    
    const finalResult = {
      ...lastResult,
      refs: finalRefs,
    };

    try {
      await checkBridgeExists(ownerPubkey, repoSlug, entity);
    } catch (error) {
      console.warn("Failed to verify bridge sync:", error);
    }

    return finalResult;
  } catch (error: any) {
    // Error handling is done per-chunk above, so this is just for unexpected errors
    if (error.name === 'AbortError') {
      throw new Error(`Bridge push timeout. The repository may be too large.`);
    }
    throw error;
  }
}

