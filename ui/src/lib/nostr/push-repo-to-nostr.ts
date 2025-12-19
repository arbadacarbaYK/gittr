/**
 * Push local repository to Nostr
 * Gathers all repo data and publishes complete repository event
 */

import { createRepositoryEvent, KIND_REPOSITORY, KIND_REPOSITORY_NIP34 } from "./events";
import { publishWithConfirmation, storeRepoEventId } from "./publish-with-confirmation";
import { setRepoStatus } from "../utils/repo-status";
import { getGraspServers } from "../utils/grasp-servers";
import { loadStoredRepos, loadRepoOverrides, type StoredRepo } from "../repos/storage";

export interface BridgeFilePayload {
  path: string;
  content?: string;
  isBinary?: boolean;
}

export interface PushRepoOptions {
  repoSlug: string;
  entity: string;
  publish: (event: any, relays: string[]) => void;
  subscribe: (
    filters: any[],
    relays: string[],
    onEvent: (event: any, isAfterEose: boolean, relayURL?: string) => void,
    maxDelayms?: number,
    onEose?: (relayUrl: string, minCreatedAt: number) => void,
    options?: any
  ) => () => void;
  defaultRelays: string[];
  privateKey?: string; // Optional - will use NIP-07 if available
  pubkey: string;
  onProgress?: (message: string) => void;
}

/**
 * Push repository to Nostr with all current state
 */
export async function pushRepoToNostr(options: PushRepoOptions): Promise<{
  success: boolean;
  eventId?: string; // Announcement event ID (kind 30617)
  stateEventId?: string; // State event ID (kind 30618) - only present if both events published
  confirmed: boolean;
  error?: string;
  filesForBridge?: BridgeFilePayload[];
}> {
  const { repoSlug, entity, publish, subscribe, defaultRelays, privateKey, pubkey, onProgress } = options;
  
  // Check for NIP-07 first
  const hasNip07 = typeof window !== "undefined" && window.nostr;

  try {
    // Step 1: Set status to "pushing" and record timestamp
    setRepoStatus(repoSlug, entity, "pushing");
    // Record push attempt timestamp to detect stuck status
    try {
      const repos = loadStoredRepos();
      const repoIndex = repos.findIndex((r: any) => 
        (r.slug === repoSlug || r.repo === repoSlug) && r.entity === entity
      );
      if (repoIndex >= 0) {
        (repos[repoIndex] as any).lastPushAttempt = Date.now();
        localStorage.setItem("gittr_repos", JSON.stringify(repos));
      }
    } catch (e) {
      console.warn("Failed to record push attempt timestamp:", e);
    }
    onProgress?.("Gathering repository data...");

    // Step 2: Load all repo data from localStorage
    const repos = loadStoredRepos();
    const repo = repos.find((r) => 
      (r.slug === repoSlug || r.repo === repoSlug) && r.entity === entity
    ) as StoredRepo & {
      gitSshBase?: string;
      releases?: unknown[];
      logoUrl?: string;
      requiredApprovals?: number;
      zapPolicy?: string;
      publicRead?: boolean;
    };

    if (!repo) {
      throw new Error("Repository not found");
    }

    // CRITICAL: Use repositoryName from repo data (exact name used by git-nostr-bridge)
    // Priority: repositoryName > repo > slug > repoSlug (parameter)
    // This ensures we use the exact name that matches what's stored in git-nostr-bridge
    const repoDataAny = repo as any; // Type assertion for dynamic fields
    let actualRepositoryName = repoDataAny?.repositoryName || repoDataAny?.repo || repoDataAny?.slug || repoSlug;
    
    // Extract repo name (handle paths like "gitnostr.com/gitworkshop")
    if (actualRepositoryName.includes('/')) {
      const parts = actualRepositoryName.split('/');
      actualRepositoryName = parts[parts.length - 1] || actualRepositoryName;
    }
    actualRepositoryName = actualRepositoryName.replace(/\.git$/, '');

    // Step 3: Gather all related data (PRs, issues, etc.)
    onProgress?.("Loading pull requests and issues...");
    
    // Step 4: Build clone URLs array
    // CRITICAL: Include clone URLs for ALL known git servers so clients know where to look
    // This follows NIP-34 best practices - clients will try all clone URLs until one works
    // Valid git servers: GRASP servers, GitHub/GitLab/Codeberg, or explicitly configured git server
    const cloneUrls: string[] = [];
    const addCloneUrl = (url: string | null | undefined) => {
      if (!url || typeof url !== "string") return;
      const trimmed = url.trim();
      if (!trimmed) return;
      // Filter unusable localhost URLs - they don't help remote clients
      if (trimmed.includes("localhost") || trimmed.includes("127.0.0.1")) {
        console.warn(`⚠️ [Push Repo] Skipping localhost clone URL: ${trimmed}`);
        return;
      }
      if (!cloneUrls.includes(trimmed)) {
        cloneUrls.push(trimmed);
      }
    };
    
    // CRITICAL: Validate pubkey format for GRASP server URLs
    if (!pubkey || !/^[0-9a-f]{64}$/i.test(pubkey)) {
      console.warn(`⚠️ [Push Repo] Invalid pubkey format, cannot generate GRASP clone URLs:`, pubkey);
    }
    
    // Priority 1: Add configured git server URL (primary server)
    // NOTE: In Next.js, NEXT_PUBLIC_* env vars are embedded at build time
    // For dev mode, they must be in .env.local and server must be restarted
    const configuredGitServerUrl = process.env.NEXT_PUBLIC_GIT_SERVER_URL;
    console.log(`🔍 [Push Repo] Checking NEXT_PUBLIC_GIT_SERVER_URL:`, {
      value: configuredGitServerUrl,
      type: typeof configuredGitServerUrl,
      isSet: !!configuredGitServerUrl,
      trimmed: configuredGitServerUrl?.trim(),
    });
    
    if (configuredGitServerUrl && configuredGitServerUrl.trim() && pubkey && /^[0-9a-f]{64}$/i.test(pubkey)) {
      const trimmedUrl = configuredGitServerUrl.trim();
      // Remove any quotes that might have been added accidentally
      const cleanUrl = trimmedUrl.replace(/^["']|["']$/g, '');
      
      // CRITICAL: For GRASP servers, construct the full clone URL with ownerPubkey and repo name
      // NIP-34 spec: clone tag includes [http|https]://<grasp-path>/<valid-npub>/<string>.git
      // MUST use npub format in GRASP clone URLs, not hex pubkey
      // Add BOTH HTTPS and SSH URLs per NIP-34 spec
      const { isGraspServer } = await import("../utils/grasp-servers");
      if (isGraspServer(cleanUrl)) {
        // Extract domain from URL (remove protocol)
        const urlWithoutProtocol = cleanUrl.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '');
        const serverDomain = urlWithoutProtocol.split('/')[0];
        
        // Only proceed if we have a valid server domain and pubkey
        if (serverDomain && typeof serverDomain === 'string' && serverDomain.length > 0 && pubkey && /^[0-9a-f]{64}$/i.test(pubkey)) {
          // NIP-34: Convert hex pubkey to npub format for GRASP clone URLs
          const { nip19 } = await import("nostr-tools");
          let npub: string;
          try {
            npub = nip19.npubEncode(pubkey);
          } catch (e) {
            console.warn(`⚠️ [Push Repo] Failed to encode pubkey to npub for GRASP clone URL, using hex as fallback:`, e);
            npub = pubkey; // Fallback to hex if encoding fails (shouldn't happen)
          }
          
          // Add HTTPS URL (NIP-34 format: <grasp-path>/<valid-npub>/<string>.git)
          const httpsCloneUrl = `https://${serverDomain}/${npub}/${actualRepositoryName}.git`;
          addCloneUrl(httpsCloneUrl);
          console.log(`🔗 [Push Repo] Added primary GRASP server HTTPS clone URL (npub format): ${httpsCloneUrl}`);
          
          // Add SSH URL (for users with SSH keys)
          // Note: SSH URLs may still use hex in some implementations, but we use npub for consistency
          const gitSshBase = repo.gitSshBase || (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_GIT_SSH_BASE) || "gittr.space";
          const sshHost = (serverDomain === "git.gittr.space" || serverDomain.includes("gittr.space")) ? gitSshBase : serverDomain;
          const sshCloneUrl = `git@${sshHost}:${npub}/${actualRepositoryName}.git`;
          addCloneUrl(sshCloneUrl);
          console.log(`🔗 [Push Repo] Added primary GRASP server SSH clone URL (npub format): ${sshCloneUrl}`);
        } else {
          console.warn(`⚠️ [Push Repo] Could not extract server domain from URL or invalid pubkey:`, { cleanUrl, pubkey });
        }
      } else {
        addCloneUrl(cleanUrl);
        console.log(`🔗 [Push Repo] Added configured git server URL: ${cleanUrl}`);
      }
    } else if (!configuredGitServerUrl || !configuredGitServerUrl.trim()) {
      // Log warning if no git server URL is configured (repos created locally need this)
      console.error(`❌ [Push Repo] NEXT_PUBLIC_GIT_SERVER_URL is not set or empty!`, {
        rawValue: configuredGitServerUrl,
        allEnvVars: Object.keys(process.env).filter(k => k.includes('GIT') || k.includes('NOSTR')),
      });
      onProgress?.("⚠️ Warning: No git server URL configured. Other clients may not be able to fetch files.");
    }
    
    // Priority 2: Add clone URLs for ALL known GRASP git servers
    // CRITICAL: Only include actual GRASP git servers (NOT regular Nostr relays)
    // GRASP servers serve git repos via HTTPS/SSH and can be cloned with standard git commands
    // Regular Nostr relays (like relay.damus.io, nos.lol) are NOT git servers and should NOT be in clone URLs
    if (pubkey && /^[0-9a-f]{64}$/i.test(pubkey)) {
      const { GRASP_SERVERS_FOR_PUSHING } = await import("../utils/grasp-servers");
      // Use only the GRASP servers that accept repos from any user (excludes read-only servers like git.jb55.com)
      // This list excludes regular Nostr relays that don't serve git repos AND servers that only host their own repos
      const knownGitServers = [
        ...GRASP_SERVERS_FOR_PUSHING, // Only servers that accept repos from any user
      ];
    
      // Remove duplicates and filter out the primary server (already added above)
      const primaryServerDomain = configuredGitServerUrl 
        ? configuredGitServerUrl.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '').split('/')[0]
        : null;
      
      const uniqueServers = [...new Set(knownGitServers)]
        .filter(server => server !== primaryServerDomain);
      
      // Generate clone URLs for all known servers
      // CRITICAL: Add BOTH HTTPS and SSH URLs per NIP-34 spec (supports https://, git://, ssh://)
      // NIP-34 spec: clone tag includes [http|https]://<grasp-path>/<valid-npub>/<string>.git
      // MUST use npub format in GRASP clone URLs, not hex pubkey
      // This allows clients to choose the appropriate format (SSH for push/pull with keys, HTTPS for read-only)
      const { nip19 } = await import("nostr-tools");
      let npub: string;
      try {
        npub = nip19.npubEncode(pubkey);
      } catch (e) {
        console.warn(`⚠️ [Push Repo] Failed to encode pubkey to npub for GRASP clone URLs, using hex as fallback:`, e);
        npub = pubkey; // Fallback to hex if encoding fails (shouldn't happen)
      }
      
      const gitSshBase = repo.gitSshBase || (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_GIT_SSH_BASE) || "gittr.space";
      
      uniqueServers.forEach(server => {
        // Add HTTPS URL (works for everyone, read-only or with credentials)
        // NIP-34 format: <grasp-path>/<valid-npub>/<string>.git
        const httpsCloneUrl = `https://${server}/${npub}/${actualRepositoryName}.git`;
        addCloneUrl(httpsCloneUrl);
        console.log(`🔗 [Push Repo] Added HTTPS clone URL (npub format): ${httpsCloneUrl}`);
        
        // Add SSH URL (for users with SSH keys - allows push/pull)
        // Use gitSshBase if server matches, otherwise use server domain directly
        // Note: SSH URLs use npub format for consistency with NIP-34 spec
        const sshHost = (server === "git.gittr.space" || server.includes("gittr.space")) ? gitSshBase : server;
        const sshCloneUrl = `git@${sshHost}:${npub}/${actualRepositoryName}.git`;
        addCloneUrl(sshCloneUrl);
        console.log(`🔗 [Push Repo] Added SSH clone URL (npub format): ${sshCloneUrl}`);
      });
      
      console.log(`✅ [Push Repo] Added ${uniqueServers.length * 2} clone URLs (HTTPS + SSH) for ${uniqueServers.length} GRASP servers (total: ${cloneUrls.length})`);
    } else {
      console.warn(`⚠️ [Push Repo] Cannot add GRASP server clone URLs - invalid pubkey format`);
    }
    
    // NOTE: nostr:// URLs are NOT added to clone tags per NIP-34 spec
    // NIP-34 clone tags must contain standard git clone URLs (https://, git://, ssh://)
    // Clients like gitworkshop.dev generate nostr:// URLs from event metadata (pubkey + repo name + relays)
    // We do NOT include nostr:// URLs in clone tags - they are client-generated, not event-stored
    
    if (repo.sourceUrl) {
      // CRITICAL: Normalize SSH URLs (git@host:path) to HTTPS format before checking
      let normalizedSourceUrl = repo.sourceUrl;
      const sshMatch = repo.sourceUrl.match(/^git@([^:]+):(.+)$/);
      if (sshMatch) {
        const [, host, path] = sshMatch;
        normalizedSourceUrl = `https://${host}/${path}`;
        console.log(`🔄 [Push Repo] Normalized SSH sourceUrl to HTTPS: ${normalizedSourceUrl}`);
      }
      
      // Check if sourceUrl is GitHub/GitLab/Codeberg and add it to clone URLs
      const isGitHub = normalizedSourceUrl.includes('github.com');
      const isGitLab = normalizedSourceUrl.includes('gitlab.com');
      const isCodeberg = normalizedSourceUrl.includes('codeberg.org');
      if (isGitHub || isGitLab || isCodeberg) {
        // Convert sourceUrl to clone URL format (add .git if needed)
        let cloneUrl = normalizedSourceUrl;
        if (!cloneUrl.endsWith('.git')) {
          cloneUrl = `${cloneUrl}.git`;
        }
        // Only add if not already in array
        addCloneUrl(cloneUrl);
      }
    }

    // Step 5: Merge file overrides (user edits) into files array
    onProgress?.("Merging file overrides...");
    const savedOverrides = typeof window !== 'undefined' 
      ? loadRepoOverrides(entity, repoSlug)
      : {};
    
    // CRITICAL: Filter out deleted files before pushing to Nostr
    // Deleted files are tracked separately in deletedPaths and should NOT be included in the event
    const { loadRepoDeletedPaths } = await import("../repos/storage");
    const deletedPaths = typeof window !== 'undefined' 
      ? loadRepoDeletedPaths(entity, repoSlug)
      : [];
    
    // Start with repo files (or empty array if none), excluding deleted files
    // CRITICAL: Normalize paths for comparison (deletedPaths are normalized)
    const { normalizeFilePath } = await import("../repos/storage");
    const allFiles = (repo.files && Array.isArray(repo.files)) ? [...repo.files] : [];
    const normalizedDeletedPaths = deletedPaths.map(p => normalizeFilePath(p));
    
    // CRITICAL: Also check if any deleted paths match files by partial match (for cases where path normalization differs)
    const baseFiles = allFiles.filter((file: any) => {
      const filePath = normalizeFilePath(file.path || "");
      // Check exact match
      if (normalizedDeletedPaths.includes(filePath)) {
        return false;
      }
      // Check if any deleted path is contained in file path or vice versa (for edge cases)
      const isDeleted = normalizedDeletedPaths.some(deletedPath => {
        return filePath === deletedPath || 
               filePath.includes(deletedPath) || 
               deletedPath.includes(filePath);
      });
      return !isDeleted;
    });
    
    if (deletedPaths.length > 0) {
      const filteredCount = allFiles.length - baseFiles.length;
      if (filteredCount > 0) {
        onProgress?.(`📝 Filtered out ${filteredCount} deleted file(s) from push`);
        console.log(`🗑️ [Push Repo] Filtered deleted files:`, {
          deletedPaths,
          normalizedDeletedPaths,
          filteredCount,
          remainingFiles: baseFiles.map(f => f.path),
        });
      } else {
        console.warn(`⚠️ [Push Repo] Deleted paths exist but no files were filtered:`, {
          deletedPaths,
          normalizedDeletedPaths,
          allFilePaths: allFiles.map(f => f.path),
        });
      }
    }
    
    // Helper function to detect if a file is binary
    const isBinaryFile = (path: string): boolean => {
      const ext = path.split('.').pop()?.toLowerCase() || '';
      const binaryExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'pdf', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp4', 'mp3', 'wav', 'avi', 'mov', 'zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar', 'exe', 'dll', 'so', 'dylib', 'bin'];
      return binaryExts.includes(ext);
    };
    
    // Merge overrides into files
    // CRITICAL: NIP-34 architecture - files should be stored on git servers, NOT in Nostr events
    // - Binary files: Exclude content, only include metadata (path, type, size, sha)
    // - Small text files (< 10KB): Include content (for README, config files, etc.)
    // - Large text files: Exclude content, only include metadata
    // Files must be pushed to git-nostr-bridge via git push before publishing Nostr event
    const MAX_TEXT_FILE_SIZE_KB = 10; // Only include content for small text files
    
    const bridgeFilesMap = new Map<string, BridgeFilePayload>();

    const setBridgeEntry = (path: string, content: string | undefined, isBinary: boolean) => {
      if (!path) return;
      const existing = bridgeFilesMap.get(path);
      if (!existing) {
        bridgeFilesMap.set(path, { path, content, isBinary });
        return;
      }
      if (content && !existing.content) {
        bridgeFilesMap.set(path, { path, content, isBinary });
      } else if (existing.isBinary !== isBinary) {
        bridgeFilesMap.set(path, { ...existing, isBinary });
      }
    };

    const filesWithOverrides = baseFiles.map((file: any) => {
      const filePath = file.path || "";
              // CRITICAL: Normalize path before processing
              const normalizedPath = normalizeFilePath(filePath);
              
              // Skip invalid paths (empty after normalization, like "/")
              if (!normalizedPath) {
                return null;
              }
              
              const isBinary = file.isBinary !== undefined ? file.isBinary : isBinaryFile(normalizedPath);
              
              // Get content from overrides (check both original and normalized path)
              const fileContent = savedOverrides[filePath] !== undefined 
                ? savedOverrides[filePath] 
                : (savedOverrides[normalizedPath] !== undefined
                  ? savedOverrides[normalizedPath]
                  : (file.content || ""));
              
              // Calculate content size (base64 is ~33% larger than raw)
              const contentSizeBytes = fileContent ? (fileContent.length * 3) / 4 : 0;
              const contentSizeKB = contentSizeBytes / 1024;
              
              // For binary files: Always exclude content (only metadata)
              // For text files: Include content only if small (< 10KB)
              const shouldIncludeContent = !isBinary && contentSizeKB < MAX_TEXT_FILE_SIZE_KB;
              
      const fileEntry: any = {
          ...file,
                path: normalizedPath, // CRITICAL: Use normalized path in event
                // Only include content for small text files
                content: shouldIncludeContent ? fileContent : undefined,
                isBinary: isBinary,
                // Keep metadata (type, size, sha, url) for all files
              };
              
              // CRITICAL: For binary files without content, ensure we have at least path and isBinary flag
              // Other clients will fetch these from git servers using clone URLs
              if (isBinary && !fileEntry.content) {
                // Ensure binary files have proper metadata for client discovery
                // Clients will use clone URLs to fetch the actual file content
                fileEntry.type = fileEntry.type || "file";
              }
              
      // CRITICAL: For bridge push, we need the actual content (including binary files)
      // Binary files are stored as base64 in overrides, so we must include them for bridge push
      // Even though they're excluded from the Nostr event (metadata-only), they need to be in the bridge
      // Check multiple sources in order of reliability:
      // 1. savedOverrides (via fileContent - already checked above)
      // 2. file.content directly
      // 3. file.data (alternative field name)
      // 4. Check overrides again with normalized path (in case path wasn't normalized when stored)
      let bridgeContent = fileContent; // This already checks savedOverrides[filePath] and savedOverrides[normalizedPath]
      
      if (!bridgeContent || bridgeContent === "") {
        // Try file.content directly
        bridgeContent = (file.content && typeof file.content === "string" && file.content.length > 0) 
          ? file.content 
          : undefined;
      }
      
      if (!bridgeContent || bridgeContent === "") {
        // Try file.data (alternative field name)
        bridgeContent = ((file as any).data && typeof (file as any).data === "string" && (file as any).data.length > 0)
          ? (file as any).data
          : undefined;
      }
      
      // For binary files, we MUST have content for bridge push (base64 encoded)
      // Without it, other clients can't fetch the file from the git server
      if (isBinary) {
        if (bridgeContent && bridgeContent.length > 0) {
          // CRITICAL: Ensure binary content is pure base64 (no data: URL prefix)
          // FileReader.readAsDataURL returns "data:image/png;base64,..." but we need just the base64 part
          const cleanBase64 = bridgeContent.includes(',') 
            ? bridgeContent.split(',')[1] || bridgeContent
            : bridgeContent;
          setBridgeEntry(normalizedPath, cleanBase64, isBinary);
          console.log(`✅ [Push Repo] Binary file ${normalizedPath} included in bridge push (${cleanBase64.length} chars base64)`);
        } else {
          // CRITICAL: Binary files without content can't be pushed to bridge
          // This means other clients won't be able to fetch the file
          console.error(`❌ [Push Repo] Binary file ${normalizedPath} has NO content for bridge push - other clients will NOT be able to fetch this file!`);
          console.error(`   Checked sources: savedOverrides[${filePath}], savedOverrides[${normalizedPath}], file.content, file.data`);
          // Still add to map but mark as missing content (will be in missingFiles array)
          setBridgeEntry(normalizedPath, undefined, isBinary);
        }
      } else {
        setBridgeEntry(normalizedPath, bridgeContent, isBinary);
      }

      return fileEntry;
            }).filter((f: any) => f !== null); // Filter out null entries (invalid paths)
    
    // Add any new files from overrides that aren't in the base files
            // CRITICAL: Also filter out deleted files from overrides
    for (const [overridePath, overrideContent] of Object.entries(savedOverrides)) {
              // Normalize override path for comparison
              const normalizedOverridePath = normalizeFilePath(overridePath);
              
              // Skip invalid paths (empty after normalization, like "/")
              if (!normalizedOverridePath) {
                continue;
              }
              
              // Skip if file is marked as deleted (check exact match and partial matches)
              const isDeleted = normalizedDeletedPaths.some(deletedPath => {
                return normalizedOverridePath === deletedPath || 
                       normalizedOverridePath.includes(deletedPath) || 
                       deletedPath.includes(normalizedOverridePath);
              });
              if (isDeleted) {
                console.log(`🗑️ [Push Repo] Skipping deleted file from overrides: ${overridePath} (normalized: ${normalizedOverridePath})`);
                continue;
              }
              
              // Skip if already in filesWithOverrides
              if (!filesWithOverrides.find((f: any) => normalizeFilePath(f.path || "") === normalizedOverridePath)) {
                const isBinary = isBinaryFile(normalizedOverridePath);
                const contentSizeBytes = overrideContent ? (overrideContent.length * 3) / 4 : 0;
                const contentSizeKB = contentSizeBytes / 1024;
                const shouldIncludeContent = !isBinary && contentSizeKB < MAX_TEXT_FILE_SIZE_KB;
                
                const newFileEntry: any = {
          type: "file",
                  path: normalizedOverridePath, // CRITICAL: Use normalized path in event
                  // Only include content for small text files
                  content: shouldIncludeContent ? overrideContent : undefined,
                  isBinary: isBinary,
                };
                
                // CRITICAL: For binary files without content, ensure proper metadata
                // Other clients will fetch these from git servers using clone URLs
                if (isBinary && !newFileEntry.content) {
                  // Binary file metadata is sufficient - clients will fetch from git server
                }
                
        setBridgeEntry(normalizedOverridePath, overrideContent, isBinary);
                filesWithOverrides.push(newFileEntry);
      }
    }
    
    // CRITICAL: Per NIP-34, files should NOT be included in Nostr events
    // Files are stored on git servers (via git-nostr-bridge), not in Nostr events
    // The files array is only used for bridge push, not for the Nostr event content
    const totalFiles = filesWithOverrides.length;
    
    if (totalFiles > 0) {
      onProgress?.(`📦 Preparing ${totalFiles} file(s) for bridge push (files are NOT included in Nostr event per NIP-34)`);
    }

    // CRITICAL: Files should already be in localStorage from import/create workflow
    // However, for imported repos, files might be on the bridge already but not in localStorage
    // We'll try to fetch missing content from the bridge API as a fallback
    // Filter out files without content - these can't be pushed to bridge
    // Directories (no extension, no content) are automatically excluded
    const filesForBridge: any[] = [];
    const filesNeedingContent: any[] = [];
    
    for (const file of Array.from(bridgeFilesMap.values())) {
      // Skip directories (they don't have content and shouldn't be in the push)
      if (!file.path || file.path.endsWith('/')) {
        continue;
      }
      
      // Check if it's a directory by checking if it has no extension and no content
      const hasExtension = file.path.includes('.') && file.path.split('.').pop()?.length && file.path.split('.').pop()!.length < 10;
      if (!hasExtension && (!file.content || file.content.length === 0)) {
        // Likely a directory - skip
        continue;
      }
      
      // Files with content are ready to push
      if (file.content && file.content.length > 0) {
        filesForBridge.push(file);
      } else {
        // File needs content - try to fetch from bridge API
        filesNeedingContent.push(file);
      }
    }
    
    // Try to fetch missing content from bridge API (for imported repos where files are already on bridge)
    // CRITICAL: Add timeout to prevent hanging on large repos
    if (filesNeedingContent.length > 0) {
      onProgress?.(`🔍 Fetching ${filesNeedingContent.length} file(s) from bridge API (missing from localStorage)...`);
      onProgress?.(`⏱️ This may take a moment for large repos - timeout after 2 minutes`);
      
      // Helper function to add timeout to fetch
      const fetchWithTimeout = async (url: string, timeoutMs: number = 30000): Promise<Response> => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(url, { signal: controller.signal });
          clearTimeout(timeoutId);
          return response;
        } catch (error: any) {
          clearTimeout(timeoutId);
          if (error.name === 'AbortError') {
            throw new Error(`Request timeout after ${timeoutMs}ms`);
          }
          throw error;
        }
      };
      
      // Limit concurrent fetches to avoid overwhelming the API
      const BATCH_SIZE = 5;
      const FILE_FETCH_TIMEOUT = 30000; // 30 seconds per file
      const TOTAL_FETCH_TIMEOUT = 120000; // 2 minutes total for all files
      const fetchStartTime = Date.now();
      
      for (let i = 0; i < filesNeedingContent.length; i += BATCH_SIZE) {
        // Check if we've exceeded total timeout
        if (Date.now() - fetchStartTime > TOTAL_FETCH_TIMEOUT) {
          console.warn(`⚠️ [Push Repo] File fetch timeout after ${TOTAL_FETCH_TIMEOUT}ms - skipping remaining files`);
          onProgress?.(`⚠️ File fetch timeout - skipping remaining files. Files should be in localStorage from import.`);
          break;
        }
        
        const batch = filesNeedingContent.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (file) => {
          try {
            const response = await fetchWithTimeout(
              `/api/nostr/repo/file-content?ownerPubkey=${encodeURIComponent(pubkey)}&repo=${encodeURIComponent(actualRepositoryName)}&path=${encodeURIComponent(file.path)}&branch=${encodeURIComponent(repo.defaultBranch || "main")}`,
              FILE_FETCH_TIMEOUT
            );
            
            if (response.ok) {
              const data = await response.json();
              if (data.content && data.content.length > 0) {
                // For binary files, ensure content is base64 (bridge API returns base64 for binary)
                if (file.isBinary) {
                  // Bridge API should already return base64 for binary files
                  file.content = data.content;
                } else {
                  file.content = data.content;
                }
                filesForBridge.push(file);
                console.log(`✅ [Push Repo] Fetched content for ${file.path} from bridge API`);
                return;
              }
            } else if (response.status === 404) {
              // File doesn't exist on bridge yet - will be excluded
              console.warn(`⚠️ [Push Repo] File ${file.path} not found on bridge (404)`);
            }
          } catch (err: any) {
            if (err.message && err.message.includes('timeout')) {
              console.warn(`⏱️ [Push Repo] Timeout fetching ${file.path} from bridge API (${FILE_FETCH_TIMEOUT}ms)`);
            } else {
              console.warn(`⚠️ [Push Repo] Failed to fetch ${file.path} from bridge API:`, err);
            }
          }
          
          // If we couldn't fetch from bridge, exclude the file
          console.warn(`⚠️ [Push Repo] Excluding file from bridge push (no content available): ${file.path}`);
          console.warn(`   💡 This file should have been loaded during import/create. If it's missing, re-import the repository.`);
        }));
      }
    }
    
    if (filesForBridge.length === 0 && bridgeFilesMap.size > 0) {
      console.warn(`⚠️ [Push Repo] No files with content to push to bridge (${bridgeFilesMap.size} files excluded due to missing content)`);
      onProgress?.("⚠️ No files with content to push to bridge - files should be in localStorage from import/create");
      onProgress?.("💡 If files are missing, re-import the repository to load all files into localStorage");
    } else if (filesForBridge.length > 0) {
      onProgress?.(`✅ ${filesForBridge.length} file(s) ready for bridge push (from localStorage)`);
    }

    // Step 6: Create repository event with ALL current state
    onProgress?.("Creating repository event...");
    
    let repoEvent: any;
    
    if (hasNip07 && window.nostr) {
      // Use NIP-07 - create unsigned event, hash it, then sign with extension
      const { getEventHash } = await import("nostr-tools");
      const signerPubkey = await window.nostr.getPublicKey();
      
      // NIP-34: Build tags array with required metadata
      const nip34Tags: string[][] = [
        ["d", actualRepositoryName], // NIP-34: Use repo name only (not entity/repo)
      ];
      
      // NIP-34: Add name tag
      // CRITICAL: Always include "name" tag for discoverability by other clients
      const repoName = repo.name || actualRepositoryName;
      if (repoName) {
        nip34Tags.push(["name", repoName]);
      }
      
      // NIP-34: Add description tag
      // CRITICAL: Always include "description" tag (other clients expect it)
      const description = repo.description || `Repository: ${repoName || actualRepositoryName}`;
      if (description) {
        nip34Tags.push(["description", description]);
      }
      
      // NIP-34: Add clone tags
      // CRITICAL: Per NIP-34 spec, clone tags must contain standard git clone URLs (https://, git://, ssh://)
      // DO NOT include nostr:// URLs - clients generate those from event metadata
      // Prioritize HTTP/HTTPS URLs first, then other formats (SSH, etc.)
      const httpCloneUrls = cloneUrls.filter(url => 
        url && typeof url === "string" && (url.startsWith('http://') || url.startsWith('https://')) && !url.startsWith('nostr://')
      );
      const otherCloneUrls = cloneUrls.filter(url => 
        url && typeof url === "string" && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('nostr://')
      );
      const prioritizedCloneUrls = [...httpCloneUrls, ...otherCloneUrls];
      
      console.log(`🔍 [Push Repo] Adding clone tags (prioritized: ${httpCloneUrls.length} HTTP, ${otherCloneUrls.length} other). cloneUrls array:`, prioritizedCloneUrls);
      prioritizedCloneUrls.forEach(url => {
        if (url && typeof url === "string" && url.trim().length > 0) {
          const trimmedUrl = url.trim();
          nip34Tags.push(["clone", trimmedUrl]);
          console.log(`   ✅ Added clone tag: ${trimmedUrl}`);
        } else {
          console.warn(`   ⚠️ Skipping invalid clone URL:`, url);
        }
      });
      
      // Log all tags for debugging
      const cloneTagsInTags = nip34Tags.filter(t => t[0] === "clone");
      console.log(`📋 [Push Repo] Clone tags in nip34Tags: ${cloneTagsInTags.length}`, cloneTagsInTags.map(t => t[1]));
      
      // Validate: Ensure at least one clone URL exists
      if (cloneUrls.length === 0 || cloneUrls.every(url => !url || typeof url !== "string" || url.trim().length === 0)) {
        const errorMsg = "⚠️ Warning: No clone URLs provided. Repository may not be discoverable by other NIP-34 clients. Set NEXT_PUBLIC_GIT_SERVER_URL in .env.local and restart the dev server.";
        onProgress?.(errorMsg);
        console.error(`❌ [Push Repo] ${errorMsg}`, {
          configuredGitServerUrl,
          cloneUrls,
          hasSourceUrl: !!repo.sourceUrl,
          envVar: process.env.NEXT_PUBLIC_GIT_SERVER_URL,
        });
      } else {
        console.log(`✅ [Push Repo] Clone URLs configured (${cloneUrls.length}):`, cloneUrls);
      }
      
      // NIP-34: Add relays tags
      // CRITICAL: Only include GRASP/git relays, not regular Nostr relays
      // Regular relays (like jb55) don't host git repos and shouldn't be listed
      const { getGraspServers } = await import("../utils/grasp-servers");
      const graspRelays = getGraspServers(defaultRelays);
      console.log(`🔍 [Push Repo] Filtering relays: ${defaultRelays.length} total, ${graspRelays.length} GRASP/git relays`);
      graspRelays.forEach(relay => {
        nip34Tags.push(["relays", relay]);
      });
      
      // NIP-34: Add topics
      if (repo.topics && repo.topics.length > 0) {
        repo.topics.forEach(topic => {
          nip34Tags.push(["t", topic]);
        });
      }
      
      // NIP-34: Add web tags (from logoUrl or links)
      if (repo.logoUrl && (repo.logoUrl.startsWith("http://") || repo.logoUrl.startsWith("https://"))) {
        nip34Tags.push(["web", repo.logoUrl]);
      }
      if (repo.links && Array.isArray(repo.links)) {
        repo.links.forEach(link => {
          if (link.url && (link.url.startsWith("http://") || link.url.startsWith("https://"))) {
            nip34Tags.push(["web", link.url]);
          }
        });
      }
      
      // NIP-34: Add maintainers tags (from contributors + owner)
      // CRITICAL: Always include event publisher (owner) as maintainer for discoverability
      const maintainerPubkeys = new Set<string>();
      
      // Add event publisher (owner) as maintainer
      if (signerPubkey && /^[0-9a-f]{64}$/i.test(signerPubkey)) {
        maintainerPubkeys.add(signerPubkey);
      }
      
      // Add contributors as maintainers
      if (repo.contributors && Array.isArray(repo.contributors)) {
        repo.contributors.forEach((c: any) => {
          const pubkey = c.pubkey;
          if (pubkey && /^[0-9a-f]{64}$/i.test(pubkey)) {
            maintainerPubkeys.add(pubkey);
          }
        });
      }
      
      // Add all maintainers to tags
      // CRITICAL: Use npub format per NIP-34 best practices (Dan Conway feedback)
      // Convert hex pubkeys to npub format for maintainers tags
      const { nip19 } = await import("nostr-tools");
      maintainerPubkeys.forEach(pubkey => {
        try {
          const npub = nip19.npubEncode(pubkey);
          nip34Tags.push(["maintainers", npub]);
        } catch (e) {
          // Fallback to hex if encoding fails (shouldn't happen with valid pubkeys)
          console.warn(`⚠️ [Push Repo] Failed to encode pubkey to npub, using hex:`, e);
        nip34Tags.push(["maintainers", pubkey]);
        }
      });
      
      // NIP-34: Add "r" tag with "euc" marker for earliest unique commit (optional but recommended)
      // This helps identify repos among forks and group related repos
      // For repos created on our platform, we can use the first commit if available
      // NOTE: If no commits exist yet, we skip this tag (it's optional per NIP-34)
      if (repo.commits && Array.isArray(repo.commits) && repo.commits.length > 0) {
        // Use the first commit (oldest) as the earliest unique commit
        const firstCommit = repo.commits[0] as any; // Type assertion for dynamic commit structure
        if (firstCommit && typeof firstCommit === 'object' && firstCommit.id && typeof firstCommit.id === 'string') {
          nip34Tags.push(["r", firstCommit.id, "euc"]);
          console.log(`✅ [Push Repo] Added earliest unique commit tag: ${firstCommit.id}`);
        }
      } else {
        console.log(`ℹ️ [Push Repo] No commits found - skipping "r" tag with "euc" marker (optional per NIP-34)`);
      }
      
      // NIP-34: Add "t" tag for "personal-fork" if this is a fork (optional)
      // We don't currently track this, but could add it if needed
      
      // Keep legacy tags for backward compatibility (source, forkedFrom)
      if (repo.sourceUrl) {
        nip34Tags.push(["source", repo.sourceUrl]);
      }
      if (repo.forkedFrom) {
        nip34Tags.push(["forkedFrom", repo.forkedFrom]);
      }
      if (repo.links && Array.isArray(repo.links)) {
        repo.links.forEach((link: any) => {
          if (!link || typeof link.url !== "string") {
            return;
          }
          const trimmedUrl = link.url.trim();
          if (!trimmedUrl) return;
          const linkType = (link.type || "other").toString();
          const linkTag: string[] = ["link", linkType, trimmedUrl];
          if (link.label && typeof link.label === "string" && link.label.trim().length > 0) {
            linkTag.push(link.label.trim());
          }
          nip34Tags.push(linkTag);
        });
      }
      
      // NIP-34: Content field MUST be empty per spec
      // All metadata goes in tags, not in content
      // Bridge compatibility: We still send metadata to bridge via /api/nostr/repo/event endpoint
      repoEvent = {
        kind: KIND_REPOSITORY_NIP34, // NIP-34: Use kind 30617
        created_at: Math.floor(Date.now() / 1000),
        tags: nip34Tags,
        content: "", // NIP-34: Content MUST be empty - all metadata in tags
        pubkey: signerPubkey,
        id: "",
        sig: "",
      };
      
      // Hash event
      repoEvent.id = getEventHash(repoEvent);
      
      // CRITICAL: Log event structure before signing to verify clone tags are present
      const cloneTagsInEvent = repoEvent.tags.filter((t: any[]) => Array.isArray(t) && t[0] === "clone");
      console.log(`🔍 [Push Repo] Event structure before signing:`, {
        eventId: repoEvent.id,
        kind: repoEvent.kind,
        pubkey: repoEvent.pubkey ? `${repoEvent.pubkey.substring(0, 8)}...` : 'none',
        totalTags: repoEvent.tags.length,
        cloneTagsCount: cloneTagsInEvent.length,
        cloneTags: cloneTagsInEvent.map((t: any[]) => t[1]),
        dTag: repoEvent.tags.find((t: any[]) => Array.isArray(t) && t[0] === "d")?.[1],
        nameTag: repoEvent.tags.find((t: any[]) => Array.isArray(t) && t[0] === "name")?.[1],
        descriptionTag: repoEvent.tags.find((t: any[]) => Array.isArray(t) && t[0] === "description")?.[1],
        maintainersCount: repoEvent.tags.filter((t: any[]) => Array.isArray(t) && t[0] === "maintainers").length,
      });
      
      // Check event size before signing (Nostr events typically have ~100KB limit)
      // Note: Binary files should already be excluded, but check anyway
      const eventJson = JSON.stringify(repoEvent);
      const eventSizeBytes = new Blob([eventJson]).size;
      const eventSizeKB = eventSizeBytes / 1024;
      const MAX_EVENT_SIZE_KB = 95; // Leave some buffer below 100KB limit
      
      if (eventSizeKB > MAX_EVENT_SIZE_KB) {
        // This shouldn't happen if binary files are excluded, but handle it anyway
        throw new Error(
          `Event size (${eventSizeKB.toFixed(1)}KB) exceeds Nostr limit (~100KB). ` +
          `Please remove large files from the repository or push files to git-nostr-bridge via git push first. ` +
          `According to NIP-34, files should be stored on git servers, not in Nostr events.`
        );
      } else if (eventSizeKB > 80) {
        // Warn if getting close to limit
        onProgress?.(`⚠️ Event size is ${eventSizeKB.toFixed(1)}KB (close to 100KB limit)`);
      }
      
      // Sign with NIP-07
      // Handle user cancellation gracefully
      console.log(`✍️ [Push Repo] Signing event with NIP-07...`);
      try {
      repoEvent = await window.nostr.signEvent(repoEvent);
        
        // CRITICAL: Verify clone tags are still present after signing
        const cloneTagsAfterSign = repoEvent.tags.filter((t: any[]) => Array.isArray(t) && t[0] === "clone");
        console.log(`✅ [Push Repo] Event signed successfully. Event ID: ${repoEvent.id}`);
        console.log(`🔍 [Push Repo] Event structure after signing:`, {
          eventId: repoEvent.id,
          cloneTagsCount: cloneTagsAfterSign.length,
          cloneTags: cloneTagsAfterSign.map((t: any[]) => t[1]),
          totalTags: repoEvent.tags.length,
          hasSig: !!repoEvent.sig,
        });
      } catch (signError: any) {
        // User canceled signing or error occurred
        const errorMessage = signError?.message || signError?.toString() || "Unknown error";
        console.error(`❌ [Push Repo] Signing failed:`, errorMessage);
        if (errorMessage.includes("cancel") || errorMessage.includes("reject") || errorMessage.includes("User rejected")) {
          throw new Error("Signing canceled by user");
        }
        throw new Error(`Signing failed: ${errorMessage}`);
      }
    } else if (privateKey) {
      // Use private key (fallback)
      repoEvent = createRepositoryEvent(
        {
          repositoryName: actualRepositoryName, // Use exact name from repo data
          name: repo.name || actualRepositoryName, // CRITICAL: Pass name for NIP-34 tag
          publicRead: repo.publicRead !== false,
          publicWrite: false,
          description: repo.description || "",
          sourceUrl: repo.sourceUrl,
          forkedFrom: repo.forkedFrom,
          readme: repo.readme,
          // CRITICAL: Per NIP-34, files should NOT be in Nostr events - they should be stored on git servers
          // Files are pushed to git-nostr-bridge separately via /api/nostr/repo/push
          // Only include metadata that helps clients discover and access the repository
          stars: repo.stars,
          forks: repo.forks,
          languages: repo.languages,
          topics: repo.topics || [],
          contributors: (repo.contributors || []).map(c => ({
            ...c,
            weight: c.weight ?? 0,
          })),
          defaultBranch: repo.defaultBranch || "main",
          branches: ((): Array<{ name: string; commit?: string }> => {
            if (!Array.isArray(repo.branches)) return [];
            if (repo.branches.length === 0) return [];
            // Check if first element is a string (old format)
            if (typeof repo.branches[0] === "string") {
              return (repo.branches as string[]).map(name => ({ name }));
            }
            // Otherwise, filter to ensure correct format
            const result: Array<{ name: string; commit?: string }> = [];
            for (const b of repo.branches) {
              if (typeof b === "object" && b !== null && "name" in b && typeof (b as { name: unknown }).name === "string") {
                result.push(b as { name: string; commit?: string });
              }
            }
            return result;
          })(),
          releases: Array.isArray(repo.releases) ? repo.releases.filter((r): r is { tag: string; name: string; description?: string; createdAt?: number } => 
            typeof r === "object" && r !== null && "tag" in r && "name" in r
          ) : [],
          logoUrl: repo.logoUrl,
          requiredApprovals: repo.requiredApprovals,
          zapPolicy: typeof repo.zapPolicy === "string" ? undefined : (repo.zapPolicy as { splits: Array<{ pubkey: string; weight: number }> } | undefined),
          links: repo.links,
          // GRASP-01: Add clone and relays tags
          // CRITICAL: Include both git server URL and GitHub/GitLab/Codeberg sourceUrl in clone array
          clone: cloneUrls, // Include both git server URL and GitHub/GitLab/Codeberg sourceUrl
          relays: defaultRelays,
        },
        privateKey
      );
      
      // Check event size (same check as NIP-07 path)
      // Note: Binary files should already be excluded, but check anyway
      const eventJson = JSON.stringify(repoEvent);
      const eventSizeBytes = new Blob([eventJson]).size;
      const eventSizeKB = eventSizeBytes / 1024;
      const MAX_EVENT_SIZE_KB = 95; // Leave some buffer below 100KB limit
      
      if (eventSizeKB > MAX_EVENT_SIZE_KB) {
        // This shouldn't happen if binary files are excluded, but handle it anyway
        throw new Error(
          `Event size (${eventSizeKB.toFixed(1)}KB) exceeds Nostr limit (~100KB). ` +
          `Please remove large files from the repository or push files to git-nostr-bridge via git push first. ` +
          `According to NIP-34, files should be stored on git servers, not in Nostr events.`
        );
      } else if (eventSizeKB > 80) {
        // Warn if getting close to limit
        onProgress?.(`⚠️ Event size is ${eventSizeKB.toFixed(1)}KB (close to 100KB limit)`);
      }
    } else {
      throw new Error("No signing method available. Please use NIP-07 extension or configure a private key.");
    }

    // Step 6: Publish with confirmation
    // CRITICAL: NIP-34 (kind 30617) events are standard Nostr events
    // Publish to ALL default relays for maximum discoverability by other clients
    // Other NIP-34 clients query all relays, not just GRASP servers
    const publishRelays = defaultRelays.length > 0 ? defaultRelays : [];
    
    if (publishRelays.length === 0) {
      throw new Error("No relays available for publishing.");
    }
    
    // Log relay distribution for debugging
    const graspRelays = getGraspServers(defaultRelays);
    const regularRelays = defaultRelays.filter(r => !graspRelays.includes(r));
    onProgress?.(`Publishing to ${publishRelays.length} relay${publishRelays.length > 1 ? 's' : ''} (${graspRelays.length} GRASP, ${regularRelays.length} regular) for maximum discoverability...`);
    
    // CRITICAL: Log event one more time before publishing to verify structure
    const finalCloneTags = repoEvent.tags.filter((t: any[]) => Array.isArray(t) && t[0] === "clone");
    console.log(`🚀 [Push Repo] About to publish event:`, {
      eventId: repoEvent.id,
      kind: repoEvent.kind,
      cloneTagsCount: finalCloneTags.length,
      cloneTags: finalCloneTags.map((t: any[]) => t[1]),
      relaysToPublish: publishRelays.length,
      relayList: publishRelays,
    });
    
    const result = await publishWithConfirmation(
      publish,
      subscribe,
      repoEvent,
      publishRelays, // Publish to ALL relays for maximum discoverability
      15000 // 15 second timeout for push
    );

    console.log(`📊 [Push Repo] Publish result:`, {
      eventId: result.eventId,
      confirmed: result.confirmed,
      confirmedRelays: result.confirmedRelays,
    });
    
    // CRITICAL: Send announcement event directly to bridge API for immediate processing
    // This avoids waiting for relay propagation which can take 10-60 seconds
    if (result.eventId && repoEvent.kind === KIND_REPOSITORY_NIP34) {
      onProgress?.("📡 Sending event directly to bridge for immediate processing...");
      try {
        const bridgeResponse = await fetch("/api/nostr/repo/event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(repoEvent),
        });
        if (bridgeResponse.ok) {
          const bridgeResult = await bridgeResponse.json();
          console.log(`✅ [Push Repo] Event sent directly to bridge:`, bridgeResult);
          onProgress?.("✅ Bridge received event - processing immediately!");
        } else {
          console.warn(`⚠️ [Push Repo] Bridge API returned ${bridgeResponse.status} - bridge will receive via relay subscription`);
        }
      } catch (bridgeError: any) {
        // Don't fail - bridge will receive via relay subscription
        console.warn(`⚠️ [Push Repo] Failed to send to bridge API (will receive via relay):`, bridgeError?.message);
      }
    }
    
    // CRITICAL: Log event structure for debugging - verify clone tags are present
    const publishedCloneTags = repoEvent.tags.filter((t: any[]) => Array.isArray(t) && t[0] === "clone");
    console.log(`🔍 [Push Repo] Published event structure:`, {
      eventId: result.eventId,
      kind: repoEvent.kind,
      cloneTagsCount: publishedCloneTags.length,
      cloneTags: publishedCloneTags.map((t: any[]) => t[1]),
      allTagNames: repoEvent.tags.map((t: any[]) => t[0]),
      eventUrl: `https://nostr.watch/e/${result.eventId}`,
      note: "Verify clone tags on nostr.watch or gitworkshop.dev - they should match the URLs above",
    });

    // CRITICAL: Continue to second signature even if first event isn't confirmed yet
    // As long as the event was published (has eventId), we should continue to publish the state event
    // The final confirmed status will reflect whether BOTH events are confirmed
    if (result.eventId) {
      // Step 7: Store event ID and update status
      storeRepoEventId(repoSlug, entity, result.eventId, result.confirmed);
      if (result.confirmed) {
      setRepoStatus(repoSlug, entity, "live");
      onProgress?.("✅ Published to Nostr!");
      } else {
        onProgress?.("⚠️ First event published but awaiting confirmation - continuing to second signature...");
      }
      
      // Step 7.5: Push files to bridge and get commit SHAs (non-blocking)
      // CRITICAL: We're NOT waiting for relay confirmation - we proceed as soon as first event is published
      // We're waiting for the bridge to process files and return commit SHAs for the state event
      // However, the state event CAN be published with empty commits - bridge will update it later
      // So we don't block the second signature on bridge push completion
      let refs: Array<{ ref: string; commit: string }> = [];
      
      if (filesForBridge && filesForBridge.length > 0) {
        onProgress?.(`📤 Pushing ${filesForBridge.length} file(s) to bridge...`);
        onProgress?.(`⏱️ This may take several minutes for large repos (timeout: 5 minutes)`);
        
        // CRITICAL: For large repos, start bridge push but don't block second signature
        // We'll try to get refs after a short wait, then proceed with second signature
        // The bridge push will continue in background
        const { pushFilesToBridge } = await import("./push-to-bridge");
        const bridgePushPromise = pushFilesToBridge({
          ownerPubkey: pubkey,
          repoSlug: actualRepositoryName,
          entity,
          branch: repo.defaultBranch || "main",
          files: filesForBridge,
        }).catch((error: any) => {
          console.error("❌ [Push Repo] Bridge push failed:", error);
          onProgress?.("⚠️ Bridge push failed - state event may have empty commits");
          return null;
        });
        
        // CRITICAL: Don't block second signature on bridge push
        // The state event can be published with empty commits - bridge will update it later
        // We'll try to get refs quickly, but proceed with second signature regardless
        onProgress?.("⏳ Trying to get commit SHAs from bridge (non-blocking)...");
        try {
          // Try to get refs quickly (10 seconds max) - don't block second signature
          const QUICK_REF_TIMEOUT = 10000; // 10 seconds
          const timeoutPromise = new Promise((resolve) => setTimeout(resolve, QUICK_REF_TIMEOUT));
          const pushResult = await Promise.race([bridgePushPromise, timeoutPromise.then(() => null)]);
          
          if (pushResult && pushResult.refs && Array.isArray(pushResult.refs)) {
            refs = pushResult.refs;
            const refsWithCommits = refs.filter(r => r.commit && r.commit.length > 0).length;
            console.log(`✅ [Push Repo] Got ${refs.length} refs with ${refsWithCommits} commit SHAs from push endpoint`);
            if (refsWithCommits > 0) {
              onProgress?.(`✅ Got ${refsWithCommits} refs with commit SHAs - ready to publish state event!`);
            }
          } else {
            // Push still running - try fetching from bridge API (quick check)
            try {
              const refsResponse = await fetch(
                `/api/nostr/repo/refs?ownerPubkey=${encodeURIComponent(pubkey)}&repo=${encodeURIComponent(actualRepositoryName)}`
              );
              if (refsResponse.ok) {
                const refsData = await refsResponse.json();
                if (refsData.refs && Array.isArray(refsData.refs)) {
                  const fetchedRefs = refsData.refs;
                  const refsWithCommits = fetchedRefs.filter((r: any) => r.commit && r.commit.length > 0).length;
                  if (refsWithCommits > 0) {
                    refs = fetchedRefs;
                    console.log(`✅ [Push Repo] Got ${refs.length} refs (${refsWithCommits} with commit SHAs) from bridge API`);
                    onProgress?.(`✅ Got ${refsWithCommits} refs with commit SHAs - proceeding with second signature!`);
                  } else {
                    console.log(`⚠️ [Push Repo] Bridge API returned refs but no commit SHAs yet - bridge still processing`);
                    onProgress?.("⚠️ Bridge still processing - state event will have empty commits (bridge will update later)");
                  }
                }
              }
            } catch (fallbackError) {
              console.warn(`⚠️ [Push Repo] Bridge API fetch failed:`, fallbackError);
              onProgress?.("⚠️ Cannot fetch refs yet - proceeding with second signature (state event will have empty commits, bridge will update later)");
            }
          }
          
          // Continue bridge push in background (don't await)
          bridgePushPromise.then((result) => {
            if (result && result.refs && Array.isArray(result.refs)) {
              const finalRefs = result.refs;
              const refsWithCommits = finalRefs.filter((r: any) => r.commit && r.commit.length > 0).length;
              if (refsWithCommits > 0 && refs.length === 0) {
                console.log(`✅ [Push Repo] Bridge push completed - got ${refsWithCommits} refs with commit SHAs`);
                // Update refs if we didn't have them before
                refs = finalRefs;
              }
            }
            onProgress?.("✅ Bridge push completed in background");
          }).catch(() => {
            // Already logged above
          });
          
        } catch (bridgeError: any) {
          console.error("❌ [Push Repo] Bridge push error:", bridgeError);
          onProgress?.("⚠️ Bridge push error - proceeding with second signature anyway");
          // Continue anyway - we'll try to get refs, but may fail
        }
      } else {
        // No files pushed - try to get existing refs (for repos that already exist on bridge)
        onProgress?.("⏳ No new files to push - checking for existing refs on bridge...");
        try {
          const refsResponse = await fetch(
            `/api/nostr/repo/refs?ownerPubkey=${encodeURIComponent(pubkey)}&repo=${encodeURIComponent(actualRepositoryName)}`
          );
          if (refsResponse.ok) {
            const refsData = await refsResponse.json();
            if (refsData.refs && Array.isArray(refsData.refs)) {
              refs = refsData.refs;
              const refsWithCommits = refs.filter(r => r.commit && r.commit.length > 0).length;
              console.log(`✅ [Push Repo] Got ${refs.length} existing refs (${refsWithCommits} with commit SHAs)`);
              if (refsWithCommits > 0) {
                onProgress?.(`✅ Got ${refsWithCommits} existing refs with commit SHAs`);
              }
            }
          }
        } catch (refsError) {
          console.warn(`⚠️ [Push Repo] Error fetching existing refs:`, refsError);
        }
      }
      
      // Step 8: Publish state event (kind 30618) - REQUIRED per NIP-34 for ngit clients
      // This is MANDATORY for "Nostr state" recognition - contains repository refs/branches
      // CRITICAL: NIP-07 cannot batch sign events - each event needs its own signature
      // This means you'll see TWO signature prompts (one for announcement, one for state)
      // Both events are REQUIRED for full NIP-34 compliance and ngit client recognition
      onProgress?.("📦 Preparing state event (kind 30618) - required for ngit clients...");
      onProgress?.("⚠️ IMPORTANT: A second signature prompt will appear shortly");
      onProgress?.("⚠️ Please stay on this page - do not close or navigate away!");
      
      // If we still don't have refs, create minimal state event with branch names
      // This should only happen if bridge is unavailable or repo has no branches
      if (refs.length === 0 && repo.branches && Array.isArray(repo.branches) && repo.branches.length > 0) {
        const defaultBranch = repo.defaultBranch || "main";
        refs = repo.branches.map((b: any) => {
          const branchName = typeof b === "string" ? b : b.name || defaultBranch;
      return {
            ref: `refs/heads/${branchName}`,
            commit: "", // Empty commit - last resort fallback
          };
        }).filter((r: any) => r.ref);
        console.log(`📝 [Push Repo] Created fallback state event with ${refs.length} branch refs (no commit SHAs - bridge unavailable)`);
      }
      
      // Ensure we have at least the default branch (last resort)
      if (refs.length === 0) {
        const defaultBranch = repo.defaultBranch || "main";
        refs = [{ ref: `refs/heads/${defaultBranch}`, commit: "" }];
        console.log(`📝 [Push Repo] Creating minimal fallback state event with default branch: ${defaultBranch}`);
      }
      
      // Final check - CRITICAL: gitworkshop.dev REQUIRES commit SHAs in state event
      // If we don't have commit SHAs, we MUST retry fetching refs or fail the push
      const refsWithCommits = refs.filter(r => r.commit && r.commit.length > 0).length;
      if (refsWithCommits === 0) {
        // CRITICAL: gitworkshop.dev will NOT recognize state without commit SHAs
        // Try one more time to fetch refs from bridge (may need a moment to process)
        onProgress?.("⚠️ No commit SHAs found - retrying refs fetch from bridge...");
        try {
          // Wait a moment for bridge to process the push
          await new Promise(resolve => setTimeout(resolve, 3000));
          const retryRefsResponse = await fetch(
            `/api/nostr/repo/refs?ownerPubkey=${encodeURIComponent(pubkey)}&repo=${encodeURIComponent(actualRepositoryName)}`
          );
          if (retryRefsResponse.ok) {
            const retryRefsData = await retryRefsResponse.json();
            if (retryRefsData.refs && Array.isArray(retryRefsData.refs)) {
              const retryRefsWithCommits = retryRefsData.refs.filter((r: any) => r.commit && r.commit.length > 0).length;
              if (retryRefsWithCommits > 0) {
                refs = retryRefsData.refs;
                onProgress?.(`✅ Got ${retryRefsWithCommits} refs with commit SHAs after retry!`);
              } else {
                onProgress?.("❌ CRITICAL: Still no commit SHAs after retry");
                onProgress?.("❌ State event will be published but gitworkshop.dev will NOT recognize it");
                onProgress?.("💡 Bridge may need more time - you may need to push again later");
              }
            }
          }
        } catch (retryError) {
          console.warn(`⚠️ [Push Repo] Retry refs fetch failed:`, retryError);
          onProgress?.("❌ CRITICAL: Cannot get commit SHAs - state event will have empty commits");
          onProgress?.("❌ other clients will NOT recognize this state event");
        }
      } else {
        onProgress?.(`✅ State event ready with ${refsWithCommits} refs containing commit SHAs`);
      }
      
      // Publish state event (even with empty commits if bridge push is still running)
      // CRITICAL: This is REQUIRED per NIP-34 - ngit clients need this to recognize "Nostr state"
      // NOTE: This will trigger a second NIP-07 signature prompt - both events are required
      // NOTE: The bridge doesn't update the state event - it returns refs that we use to publish it
      // If published with empty commits, other clients might not recognize it until republished with commit SHAs
      onProgress?.("📤 Signing state event (kind 30618) - required for ngit clients...");
      
      const { KIND_REPOSITORY_STATE } = await import("./events");
      let stateEvent: any;
      
      if (hasNip07 && window.nostr) {
        const { getEventHash } = await import("nostr-tools");
        const signerPubkey = await window.nostr.getPublicKey();
        
        // Create unsigned state event
        // Per NIP-34: ref path is the tag name, commit-id is the tag value
        // Format: ["refs/heads/main", "commit-id"]
        let defaultBranchName: string | null = null;
        const stateTags: string[][] = [
          ["d", actualRepositoryName],
        ];
        
        // Add refs as tags (ref path is tag name, commit is value)
        refs.forEach(r => {
          if (r.ref && typeof r.ref === "string") {
            stateTags.push([r.ref, r.commit || ""]);
            // Track default branch name for HEAD tag
            if (r.ref.startsWith("refs/heads/") && !defaultBranchName) {
              defaultBranchName = r.ref.replace("refs/heads/", "");
            }
          }
        });
        
        // Add HEAD tag pointing to default branch (NIP-34 requirement)
        // Format: ["HEAD", "ref: refs/heads/<branch-name>"]
        // Always use repo.defaultBranch as source of truth, not first ref encountered
        const defaultBranch = repo.defaultBranch || "main";
        const headTagValue = `ref: refs/heads/${defaultBranch}`;
        stateTags.push(["HEAD", headTagValue]);
        
        // Log state event structure for debugging
        console.log(`📝 [Push Repo] State event structure:`, {
          kind: KIND_REPOSITORY_STATE,
          dTag: actualRepositoryName,
          refsCount: refs.length,
          refsWithCommits: refs.filter(r => r.commit && r.commit.length > 0).length,
          headTag: headTagValue,
          author: signerPubkey.slice(0, 16) + "...",
        });
        
        stateEvent = {
          kind: KIND_REPOSITORY_STATE,
          created_at: Math.floor(Date.now() / 1000),
          tags: stateTags,
          content: "", // NIP-34: state event content is empty
          pubkey: signerPubkey,
          id: "",
          sig: "",
        };
        
        stateEvent.id = getEventHash(stateEvent);
        
        // CRITICAL: Log state event BEFORE signing to verify format
        console.log(`📝 [Push Repo] State event BEFORE signing:`, {
          kind: stateEvent.kind,
          id: stateEvent.id,
          pubkey: stateEvent.pubkey.slice(0, 16) + "...",
          created_at: stateEvent.created_at,
          tags: stateEvent.tags.map((t: any[]) => [t[0], t[1]?.slice(0, 16) + "..." || ""]),
          content: stateEvent.content,
        });
        
        // Sign state event - REQUIRED, not optional
        // If user cancels, we must fail the entire push (state event is mandatory)
        // NOTE: State event content is empty per NIP-34 spec (kind 30618)
        // The event data is in the tags (refs, HEAD, etc.), not in content
        // This is correct per spec: https://github.com/nostr-protocol/nips/blob/master/34.md#repository-state-announcements
        onProgress?.("📝 Signing repository state event (kind 30618)...");
        onProgress?.("   Note: Content is empty per NIP-34 spec - data is in tags (refs, branches, commits)");
        try {
          // NIP-07 signEvent returns the full signed event object (same as announcement event)
          const signedStateEvent = await window.nostr.signEvent(stateEvent);
          // Replace stateEvent with signed version (signEvent returns complete signed event)
          stateEvent = signedStateEvent;
          console.log(`✅ [Push Repo] State event signed successfully:`, {
            id: stateEvent.id,
            sig: typeof stateEvent.sig === 'string' && stateEvent.sig.length > 0 ? stateEvent.sig.slice(0, 16) + "..." : "invalid",
          });
        } catch (signError: any) {
          const isUserCancel = signError?.message?.includes("cancel") || 
                               signError?.message?.includes("reject") ||
                               signError?.message?.includes("User rejected");
          if (isUserCancel) {
            console.error(`❌ [Push Repo] State event signature cancelled - state event is REQUIRED per NIP-34`);
            onProgress?.("❌ State event is required - push incomplete");
            // Revert status since push is incomplete
            setRepoStatus(repoSlug, entity, "local");
            return {
              success: false,
        eventId: result.eventId,
              confirmed: false,
              error: "State event signature cancelled - both announcement and state events are required per NIP-34",
        filesForBridge,
      };
          }
          throw signError; // Re-throw if not a cancellation
        }
      } else if (privateKey) {
        const { createRepositoryStateEvent } = await import("./events");
        // Include all refs, even those without commits
        // Pass default branch ref for HEAD tag (NIP-34 requirement)
        const defaultBranch = repo.defaultBranch || "main";
        const defaultBranchRef = `refs/heads/${defaultBranch}`;
        stateEvent = createRepositoryStateEvent(actualRepositoryName, refs, privateKey, defaultBranchRef);
    } else {
        throw new Error("Cannot sign state event - no NIP-07 or private key available");
      }
      
      if (!stateEvent) {
        throw new Error("Failed to create state event");
      }
      
      // Publish state event - REQUIRED
      // CRITICAL: Must publish to same relays as announcement for ngit clients to find it
      onProgress?.("✅ Ready to publish state event!");
      onProgress?.("🔐 Second signature prompt appearing now - please sign to complete push");
      console.log(`📊 [Push Repo] Publishing state event to ${publishRelays.length} relays...`);
      const stateResult = await publishWithConfirmation(
        publish,
        subscribe,
        stateEvent,
        publishRelays, // Use same relays as announcement
        15000 // 15 second timeout for state event (longer since it's critical)
      );
      
      console.log(`📊 [Push Repo] State event published:`, {
        eventId: stateResult.eventId,
        confirmed: stateResult.confirmed,
        refsCount: refs.length,
        hasCommits: refs.some(r => r.commit && r.commit.length > 0),
        defaultBranch: repo.defaultBranch || "main",
        stateEventTags: stateEvent.tags.map((t: any[]) => t[0]),
      });
      
      // CRITICAL: Verify state event is queryable on relays (for gitworkshop.dev)
      // Query for the state event we just published to ensure it's findable
      // IMPORTANT: Use ALL default relays, not just publishRelays, since gitworkshop.dev may use different relays
      if (stateResult.eventId && stateResult.confirmed) {
        onProgress?.("🔍 Verifying state event is queryable on relays (checking multiple relays for gitworkshop.dev compatibility)...");
        try {
          const { KIND_REPOSITORY_STATE } = await import("./events");
          // Use ALL default relays for verification (gitworkshop.dev may use different relays)
          // defaultRelays already contains all relays (both GRASP and regular)
          const allRelaysForVerification = defaultRelays;
          
          let foundStateEvent = false;
          let foundOnRelays: string[] = [];
          const verifyUnsub = subscribe(
            [{
              kinds: [KIND_REPOSITORY_STATE],
              authors: [pubkey],
              "#d": [actualRepositoryName],
              limit: 1,
            }],
            allRelaysForVerification, // CRITICAL: Use all relays, not just publishRelays
            (event, isAfterEose, relayURL) => {
              if (event.id === stateResult.eventId) {
                foundStateEvent = true;
                if (relayURL && !foundOnRelays.includes(relayURL)) {
                  foundOnRelays.push(relayURL);
                }
                const refsWithCommits = event.tags.filter((t: any[]) => 
                  t[0] && t[0].startsWith("refs/") && t[1] && t[1].length > 0
                ).length;
                console.log(`✅ [Push Repo] State event verified on relay ${relayURL || 'unknown'}:`, {
                  eventId: event.id.slice(0, 16) + "...",
                  refsWithCommits,
                  hasHEAD: event.tags.some((t: any[]) => t[0] === "HEAD"),
                  allTags: event.tags.map((t: any[]) => t[0]),
                });
              }
            },
            10000 // 10 second timeout for verification (longer to allow relay sync)
          );
          
          // Wait longer for verification (relays may need time to sync)
          await new Promise(resolve => setTimeout(resolve, 5000));
          verifyUnsub();
          
          // NIP-34: Use npub format for gitworkshop.dev URLs (follows clone URL pattern)
          // Convert once and reuse for both success and fallback messages
          const { nip19 } = await import("nostr-tools");
          let npub: string;
          try {
            npub = nip19.npubEncode(pubkey);
          } catch (e) {
            npub = pubkey; // Fallback to hex if encoding fails
          }
          const gitworkshopUrl = `https://gitworkshop.dev/${npub}/${actualRepositoryName}`;
          
          if (foundStateEvent) {
            const refsWithCommits = refs.filter(r => r.commit && r.commit.length > 0).length;
            if (refsWithCommits > 0) {
              onProgress?.("✅ State event published and verified on relay(s)!");
              onProgress?.(`   Found on ${foundOnRelays.length} relay(s): ${foundOnRelays.slice(0, 2).join(", ")}${foundOnRelays.length > 2 ? "..." : ""}`);
              onProgress?.("✅ ngit clients (like gitworkshop.dev) should now recognize Nostr state.");
              onProgress?.(`🔗 View on gitworkshop.dev: ${gitworkshopUrl}`);
            } else {
              onProgress?.("⚠️ State event published but has no commit SHAs");
              onProgress?.("💡 gitworkshop.dev may not recognize it until bridge processes files");
              onProgress?.("💡 Bridge should update the state event automatically once commits are ready");
            }
          } else {
            onProgress?.("⚠️ State event published but not yet queryable on checked relays");
            onProgress?.("💡 It may take a few minutes for relays to sync");
            onProgress?.("💡 gitworkshop.dev may use different relays - check manually in a few minutes");
            onProgress?.(`🔗 Check on gitworkshop.dev: ${gitworkshopUrl}`);
          }
        } catch (verifyError) {
          console.warn(`⚠️ [Push Repo] Error verifying state event:`, verifyError);
          onProgress?.("⚠️ Could not verify state event on relays (this is OK - it may still be syncing)");
        }
      } else {
        onProgress?.("⚠️ State event published but awaiting confirmation");
        onProgress?.("💡 It may take a few minutes for gitworkshop.dev to sync");
      }
      
      // CRITICAL: Store state event ID in localStorage (both events are required for "live" status)
      if (stateResult.eventId) {
        storeRepoEventId(repoSlug, entity, result.eventId, result.confirmed, stateResult.eventId);
      }
      
      return {
        success: true,
        eventId: result.eventId, // Announcement event ID (for backward compatibility)
        stateEventId: stateResult.eventId, // State event ID (for verification)
        confirmed: result.confirmed && stateResult.confirmed, // Both events must be confirmed
        filesForBridge,
      };
    } else {
      // First event was published but we couldn't continue to second signature
      // This should only happen if there was an error, not just lack of confirmation
      storeRepoEventId(repoSlug, entity, result.eventId, result.confirmed);
      setRepoStatus(repoSlug, entity, "local"); // Revert to local if not confirmed
      onProgress?.("⚠️ First event published but second signature could not proceed");
      
      return {
        success: true,
        eventId: result.eventId,
        confirmed: false,
        filesForBridge,
      };
    }
  } catch (error: any) {
    // Revert status on error (including user cancellation)
    setRepoStatus(repoSlug, entity, "local");
    onProgress?.("❌ Failed to push");
    
    // Provide user-friendly error message
    const errorMessage = error?.message || error?.toString() || "Unknown error";
    const isUserCancel = errorMessage.includes("cancel") || errorMessage.includes("reject") || errorMessage.includes("User rejected");
    
    return {
      success: false,
      confirmed: false,
      error: isUserCancel ? "Push canceled" : errorMessage,
      filesForBridge: [],
    };
  }
}

