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
// nginx client_max_body_size is now set to 10M on the server
// Using chunks of 8MB max to stay safely under the limit
const CHUNK_SIZE = 30; // Number of files per chunk
const MAX_CHUNK_SIZE_BYTES = 8 * 1024 * 1024; // 8MB per chunk (safe margin below 10MB nginx limit)

function chunkFiles(files: BridgeFilePayload[]): BridgeFilePayload[][] {
  const chunks: BridgeFilePayload[][] = [];
  let currentChunk: BridgeFilePayload[] = [];
  let currentChunkSize = 0;

  for (const file of files) {
    // Estimate file size (content length + overhead for JSON encoding)
    // CRITICAL: Base64 encoding increases size by ~33%, plus JSON structure overhead
    // JSON overhead includes: keys ("path", "content", "isBinary"), quotes, commas, brackets
    // For a typical file: {"path":"...","content":"...","isBinary":false} adds ~50-100 bytes
    // Base64 content: original_size * 1.33 + JSON overhead (~100 bytes per file)
    const estimatedSize = file.content
      ? file.content.length * 1.4 + 200 // Base64 is ~1.33x, JSON overhead ~200 bytes per file (more conservative)
      : 500; // Metadata only (path, isBinary) - minimal overhead

    // CRITICAL: Check if adding this file would exceed limits BEFORE adding it
    // This ensures single large files are properly handled (even in empty chunks)
    // Check both: file count limit AND size limit
    const wouldExceedFileLimit = currentChunk.length >= CHUNK_SIZE;
    const wouldExceedSizeLimit =
      currentChunkSize + estimatedSize > MAX_CHUNK_SIZE_BYTES;

    // If current chunk is not empty AND would exceed limits, start a new chunk
    if (
      currentChunk.length > 0 &&
      (wouldExceedFileLimit || wouldExceedSizeLimit)
    ) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentChunkSize = 0;
    }

    // CRITICAL: If a single file exceeds MAX_CHUNK_SIZE_BYTES, add it anyway
    // This prevents infinite loops and ensures progress (even if it violates the limit)
    // The nginx 10MB limit should catch this, but we log a warning
    if (estimatedSize > MAX_CHUNK_SIZE_BYTES) {
      console.warn(
        `⚠️ [Bridge Push] File ${file.path} estimated size (${Math.round(
          estimatedSize / 1024
        )}KB) exceeds chunk limit (${Math.round(
          MAX_CHUNK_SIZE_BYTES / 1024
        )}KB). Adding as single-file chunk.`
      );
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
  console.log(
    `📦 [Bridge Push] Chunking ${files.length} files into ${chunks.length} chunk(s)`
  );

  if (chunks.length === 0) {
    // Empty files array - create empty commit
    chunks.push([]);
  }

  // CRITICAL: Generate a push session ID that all chunks will share
  // This allows the backend to reuse the same working directory for all chunks
  // Instead of cloning the repo for each chunk, we clone once and reuse
  const pushSessionId = `${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 9)}`;
  console.log(
    `🔑 [Bridge Push] Push session ID: ${pushSessionId} (shared across ${chunks.length} chunks)`
  );

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
        console.warn(
          `⚠️ [Bridge Push] Skipping null chunk ${i + 1}/${chunks.length}`
        );
        continue;
      }

      if (chunk.length === 0) {
        console.log(
          `📤 [Bridge Push] Pushing empty chunk ${i + 1}/${
            chunks.length
          } (will create empty commit)...`
        );
      } else {
        console.log(
          `📤 [Bridge Push] Pushing chunk ${i + 1}/${chunks.length} (${
            chunk.length
          } files)...`
        );
        // Log first few file paths in this chunk for debugging
        const filePaths = chunk
          .slice(0, 10)
          .map((f) => f.path)
          .join(", ");
        const moreFiles =
          chunk.length > 10 ? ` (+${chunk.length - 10} more)` : "";
        console.log(
          `📋 [Bridge Push] Chunk ${i + 1} files: ${filePaths}${moreFiles}`
        );
      }

      // CRITICAL: Create a new AbortController and timeout for each chunk
      // This ensures each chunk gets its own 5-minute window, not a cumulative timeout
      const chunkController = new AbortController();
      const chunkTimeoutId = setTimeout(
        () => chunkController.abort(),
        BRIDGE_PUSH_TIMEOUT_PER_CHUNK
      );
      const chunkStartTime = Date.now();

      // Add a heartbeat to show the request is still alive (log every 30 seconds)
      const heartbeatInterval = setInterval(() => {
        console.log(
          `💓 [Bridge Push] Chunk ${i + 1}/${
            chunks.length
          } still processing... (${Math.floor(
            (Date.now() - chunkStartTime) / 1000
          )}s elapsed)`
        );
      }, 30000);

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
            // CRITICAL: Use push session ID to share working directory across chunks
            // Only commit on the last chunk - all previous chunks just add files
            pushSessionId, // Shared session ID for all chunks in this push
            createCommit: i === chunks.length - 1, // Only commit on last chunk
            chunkIndex: i,
            totalChunks: chunks.length,
          }),
          signal: chunkController.signal,
        });

        // CRITICAL: Handle 413 errors FIRST - nginx rejects large bodies before they reach Next.js
        // nginx returns HTML for 413 errors, not JSON, so we need to check status before parsing
        if (response.status === 413) {
          const filePaths = chunk
            .slice(0, 10)
            .map((f) => f.path)
            .join(", ");
          const moreFiles =
            chunk.length > 10 ? ` (+${chunk.length - 10} more)` : "";
          const text = await response.text().catch(() => "");
          console.error(
            `❌ [Bridge Push] Chunk ${i + 1}/${
              chunks.length
            } rejected by nginx (413):`,
            {
              filePaths: `${filePaths}${moreFiles}`,
              chunkSize: chunk.length,
              nginxResponse: text.substring(0, 200),
            }
          );
          throw new Error(
            `Chunk ${i + 1}/${
              chunks.length
            } is too large (413 Request Entity Too Large). Nginx rejected the request. Files: ${filePaths}${moreFiles}. The chunk size limit needs to be reduced further.`
          );
        }

        // Check content type before parsing JSON
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          const text = await response.text();
          console.error(
            `❌ [Bridge Push] Chunk ${i + 1} returned non-JSON response:`,
            {
              status: response.status,
              contentType,
              preview: text.substring(0, 200),
            }
          );
          throw new Error(
            `Bridge API returned HTML instead of JSON (status: ${response.status}). The endpoint may not exist or returned an error page.`
          );
        }

        const data = await response.json();
        if (!response.ok) {
          throw new Error(
            data.error ||
              `Bridge push failed for chunk ${i + 1} (status: ${
                response.status
              })`
          );
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
        // CRITICAL: Check both that refs exists AND has length > 0 (empty arrays are truthy but invalid)
        if (data.refs && Array.isArray(data.refs) && data.refs.length > 0) {
          allRefs = data.refs; // Update with current chunk's refs
        } else {
          // CRITICAL: Warn for ANY chunk missing refs, not just the last one
          // Missing refs from intermediate chunks causes stale commit SHAs in state events
          const isLastChunk = i === chunks.length - 1;
          if (data.refs && Array.isArray(data.refs) && data.refs.length === 0) {
            console.warn(
              `⚠️ [Bridge Push] Chunk ${i + 1}/${chunks.length} (${
                isLastChunk ? "last" : "intermediate"
              }) returned empty refs array. ${
                isLastChunk
                  ? "Using refs from previous chunk."
                  : "This may cause stale commit SHAs in state events - chunk may not have committed properly."
              }`
            );
          } else {
            console.warn(
              `⚠️ [Bridge Push] Chunk ${i + 1}/${chunks.length} (${
                isLastChunk ? "last" : "intermediate"
              }) did not return refs. ${
                isLastChunk
                  ? "Using refs from previous chunk."
                  : "This may cause stale commit SHAs in state events - chunk may not have committed properly."
              }`
            );
          }

          // For intermediate chunks, this is more critical - we need accurate refs
          // But we don't fail here because the last chunk might still return valid refs
          // The final refs logic will handle the fallback
        }

        clearInterval(heartbeatInterval);
        const elapsed = Math.floor((Date.now() - chunkStartTime) / 1000);
        console.log(
          `✅ [Bridge Push] Chunk ${i + 1}/${
            chunks.length
          } pushed successfully (took ${elapsed}s)`
        );
      } catch (chunkError: any) {
        clearTimeout(chunkTimeoutId);
        clearInterval(heartbeatInterval);

        // CRITICAL: Clean up shared working directory on chunk failure
        // If a chunk fails (network timeout, connection loss, etc.), the backend won't know to clean up
        // Send a cleanup request to prevent orphaned temp directories from accumulating
        if (chunks.length > 1 && pushSessionId) {
          try {
            console.log(
              `🧹 [Bridge Push] Attempting to clean up working directory after chunk failure...`
            );
            await fetch("/api/nostr/repo/push-cleanup", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ pushSessionId }),
            }).catch((cleanupError) => {
              // Non-critical - cleanup failure shouldn't prevent error propagation
              console.warn(
                `⚠️ [Bridge Push] Failed to send cleanup request (non-critical):`,
                cleanupError?.message
              );
            });
          } catch (cleanupError) {
            // Non-critical - cleanup failure shouldn't prevent error propagation
            console.warn(
              `⚠️ [Bridge Push] Cleanup request failed (non-critical):`,
              cleanupError
            );
          }
        }

        if (chunkError.name === "AbortError") {
          const filePaths = chunk
            .slice(0, 10)
            .map((f) => f.path)
            .join(", ");
          const moreFiles =
            chunk.length > 10 ? ` (+${chunk.length - 10} more)` : "";
          throw new Error(
            `Bridge push timeout for chunk ${i + 1}/${chunks.length} after ${
              BRIDGE_PUSH_TIMEOUT_PER_CHUNK / 1000
            } seconds. Files in chunk: ${filePaths}${moreFiles}. The chunk may be too large or the backend may be stuck.`
          );
        }
        const filePaths = chunk
          .slice(0, 10)
          .map((f) => f.path)
          .join(", ");
        const moreFiles =
          chunk.length > 10 ? ` (+${chunk.length - 10} more)` : "";
        console.error(
          `❌ [Bridge Push] Chunk ${i + 1}/${chunks.length} failed:`,
          chunkError
        );
        console.error(
          `❌ [Bridge Push] Files in failed chunk: ${filePaths}${moreFiles}`
        );
        throw chunkError;
      } finally {
        // Always clear the timeout for this chunk
        clearTimeout(chunkTimeoutId);
      }
    }

    // CRITICAL: Return the last chunk's result with the most recent refs
    // Priority: lastResult.refs (if valid and non-empty) > allRefs (only if last chunk failed) > empty array
    // CRITICAL: Only fall back to allRefs if lastResult is null/undefined (chunk failed completely)
    // If lastResult exists but refs is empty, the push succeeded but refs couldn't be retrieved
    // Using stale refs from an earlier chunk would reference a commit missing files from the last chunk
    // This is a critical error - we should use empty refs rather than stale refs
    let finalRefs: Array<{ ref: string; commit: string }> = [];
    if (
      lastResult?.refs &&
      Array.isArray(lastResult.refs) &&
      lastResult.refs.length > 0
    ) {
      // Last chunk returned valid refs - use them
      finalRefs = lastResult.refs;
    } else if (!lastResult) {
      // Last chunk failed completely - fall back to allRefs from earlier chunks
      finalRefs = allRefs.length > 0 ? allRefs : [];
      console.warn(
        `⚠️ [Bridge Push] Last chunk failed completely - using refs from earlier chunks (may be incomplete)`
      );
    } else {
      // Last chunk succeeded but returned empty refs - this is a critical error
      // The push succeeded, so files from the last chunk ARE in the repo
      // But we can't get the commit SHA - using stale refs would reference the wrong commit
      console.error(
        `❌ [Bridge Push] CRITICAL: Last chunk push succeeded but returned empty refs! Files from last chunk are in repo but state event will have empty commits. This should not happen.`
      );
      finalRefs = []; // Use empty refs rather than stale refs
    }

    const finalResult = {
      ...lastResult,
      refs: finalRefs,
    };

    // CRITICAL: Bridge processes events asynchronously from Nostr relays
    // Add a delay before checking to give bridge time to process the events
    // The bridge needs to receive the announcement event (kind 30617) from relays first
    try {
      // Wait 2 seconds for bridge to process events from relays
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await checkBridgeExists(ownerPubkey, repoSlug, entity);
    } catch (error) {
      console.warn("Failed to verify bridge sync:", error);
    }

    return finalResult;
  } catch (error: any) {
    // Error handling is done per-chunk above, so this is just for unexpected errors
    // CRITICAL: Clean up shared working directory on unexpected errors
    // This ensures cleanup even if error occurs outside the chunk loop
    if (chunks.length > 1 && pushSessionId) {
      try {
        console.log(
          `🧹 [Bridge Push] Attempting to clean up working directory after unexpected error...`
        );
        await fetch("/api/nostr/repo/push-cleanup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pushSessionId }),
        }).catch((cleanupError) => {
          console.warn(
            `⚠️ [Bridge Push] Failed to send cleanup request (non-critical):`,
            cleanupError?.message
          );
        });
      } catch (cleanupError) {
        console.warn(
          `⚠️ [Bridge Push] Cleanup request failed (non-critical):`,
          cleanupError
        );
      }
    }

    if (error.name === "AbortError") {
      throw new Error(`Bridge push timeout. The repository may be too large.`);
    }
    throw error;
  }
}
