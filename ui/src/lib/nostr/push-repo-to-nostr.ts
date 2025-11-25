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
  eventId?: string;
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
      // NIP-34 clone URLs should be the full URL that can be used directly with `git clone`
      const { isGraspServer } = await import("../utils/grasp-servers");
      if (isGraspServer(cleanUrl)) {
        const fullCloneUrl = `${cleanUrl}/${pubkey}/${actualRepositoryName}.git`;
        addCloneUrl(fullCloneUrl);
        console.log(`🔗 [Push Repo] Added primary GRASP server clone URL: ${fullCloneUrl}`);
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
      const { KNOWN_GRASP_DOMAINS } = await import("../utils/grasp-servers");
      // Use only the verified GRASP git servers from KNOWN_GRASP_DOMAINS
      // This list excludes regular Nostr relays that don't serve git repos
      const knownGitServers = [
        ...KNOWN_GRASP_DOMAINS, // All domains in this list are verified GRASP git servers
      ];
    
      // Remove duplicates and filter out the primary server (already added above)
      const primaryServerDomain = configuredGitServerUrl 
        ? configuredGitServerUrl.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '').split('/')[0]
        : null;
      
      const uniqueServers = [...new Set(knownGitServers)]
        .filter(server => server !== primaryServerDomain);
      
      // Generate clone URLs for all known servers
      uniqueServers.forEach(server => {
        // Use HTTPS for git clone (GRASP servers support HTTPS)
        const fullCloneUrl = `https://${server}/${pubkey}/${actualRepositoryName}.git`;
        addCloneUrl(fullCloneUrl);
        console.log(`🔗 [Push Repo] Added known GRASP server clone URL: ${fullCloneUrl}`);
      });
      
      console.log(`✅ [Push Repo] Added ${uniqueServers.length} additional GRASP server clone URLs (total: ${cloneUrls.length})`);
    } else {
      console.warn(`⚠️ [Push Repo] Cannot add GRASP server clone URLs - invalid pubkey format`);
    }
    
    // Priority 3: Add nostr:// format URLs for compatibility with gitworkshop.dev and other clients
    // Format: nostr://{author-name}@{relay-domain}/{repo-name}
    // This is the de-facto standard format used by gitworkshop.dev and other NIP-34 clients
    // We include this alongside standard NIP-34 clone URLs for maximum compatibility
    if (pubkey && /^[0-9a-f]{64}$/i.test(pubkey) && defaultRelays.length > 0) {
      try {
        // Try to get author's display name from Nostr metadata (if available in browser context)
        let authorName: string | null = null;
        if (typeof window !== "undefined") {
          // Try to get from localStorage session data or metadata cache
          try {
            // Check session storage first
            const sessionData = localStorage.getItem("nostr_session");
            if (sessionData) {
              const session = JSON.parse(sessionData);
              if (session?.name && session.name.trim().length > 0 && session.name !== "Anonymous Nostrich") {
                authorName = session.name;
              }
            }
            
            // If no session name, try metadata cache
            if (!authorName) {
              const metadataCache = localStorage.getItem("nostr_metadata_cache");
              if (metadataCache) {
                const cache = JSON.parse(metadataCache);
                const userMeta = cache[pubkey.toLowerCase()] || cache[pubkey];
                if (userMeta) {
                  authorName = userMeta.name || userMeta.display_name;
                }
              }
            }
          } catch (e) {
            // Ignore cache errors - will use fallback
            console.warn(`⚠️ [Push Repo] Failed to get author name from cache:`, e);
          }
        }
        
        // Fallback: Use npub prefix if no name available
        if (!authorName || authorName.trim().length === 0 || authorName === "Anonymous Nostrich") {
          try {
            const { nip19 } = await import("nostr-tools");
            const npub = nip19.npubEncode(pubkey);
            // Use first part of npub as fallback (e.g., "npub1abc..." -> "npub1abc")
            authorName = npub.substring(0, 12);
          } catch {
            // Last resort: use pubkey prefix
            authorName = pubkey.substring(0, 8);
          }
        }
        
        // Extract relay domains from defaultRelays (wss:// or https://)
        const relayDomains = defaultRelays
          .map(relay => {
            // Extract domain from wss://relay.example.com or https://relay.example.com
            const match = relay.match(/^(?:wss?|https?):\/\/([^\/]+)/i);
            return match ? match[1] : null;
          })
          .filter((domain): domain is string => typeof domain === "string" && domain.length > 0)
          .slice(0, 3); // Limit to first 3 relays to avoid too many URLs
        
        // Generate nostr:// URLs for each relay domain
        relayDomains.forEach(domain => {
          if (!domain) return;
          // Sanitize author name for URL (remove spaces, special chars)
          const sanitizedName = authorName
            ? authorName
                .toLowerCase()
                .replace(/[^a-z0-9]/g, "")
                .substring(0, 32) // Limit length
            : pubkey.substring(0, 8);
          
          const nostrUrl = `nostr://${sanitizedName}@${domain}/${actualRepositoryName}`;
          addCloneUrl(nostrUrl);
          console.log(`🔗 [Push Repo] Added nostr:// format URL for compatibility: ${nostrUrl}`);
        });
        
        console.log(`✅ [Push Repo] Added ${relayDomains.length} nostr:// format URLs for ecosystem compatibility`);
      } catch (error) {
        console.warn(`⚠️ [Push Repo] Failed to generate nostr:// URLs:`, error);
        // Continue without nostr:// URLs - standard clone URLs are more important
      }
    }
    
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

    const filesForBridge = Array.from(bridgeFilesMap.values());

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
      // CRITICAL: At least one clone tag is required for NIP-34 compliance
      // Other clients need clone URLs to access the repository
      // NOTE: We publish standard git clone URLs (https://, git://, SSH) per NIP-34 spec
      // Some clients (like gitworkshop.dev) may generate their own nostr:// format URLs from event metadata,
      // but we follow the NIP-34 standard which specifies standard git clone URLs in clone tags
      // CRITICAL: Prioritize HTTP/HTTPS clone URLs first (before SSH) so clients prefer them
      const httpCloneUrls = cloneUrls.filter(url => 
        url && typeof url === "string" && (url.startsWith('http://') || url.startsWith('https://'))
      );
      const otherCloneUrls = cloneUrls.filter(url => 
        url && typeof url === "string" && !url.startsWith('http://') && !url.startsWith('https://')
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
      defaultRelays.forEach(relay => {
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
      maintainerPubkeys.forEach(pubkey => {
        nip34Tags.push(["maintainers", pubkey]);
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
      
      repoEvent = {
        kind: KIND_REPOSITORY_NIP34, // NIP-34: Use kind 30617
        created_at: Math.floor(Date.now() / 1000),
        tags: nip34Tags,
        content: JSON.stringify({
          repositoryName: actualRepositoryName, // Bridge expects 'repositoryName' - use exact name from repo data
          name: repo.name || actualRepositoryName, // Keep 'name' for frontend compatibility
          description: repo.description || "",
          publicRead: repo.publicRead !== false,
          publicWrite: false,
          gitSshBase: repo.gitSshBase || (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_GIT_SSH_BASE) || "gittr.space", // Bridge expects this field - use env var or default
          // CRITICAL: Per NIP-34, files should NOT be in Nostr events - they should be stored on git servers
          // Files are pushed to git-nostr-bridge separately via /api/nostr/repo/push
          // Only include metadata that helps clients discover and access the repository
          readme: repo.readme, // README is small metadata, acceptable to include
          stars: repo.stars,
          forks: repo.forks,
          languages: repo.languages,
          topics: repo.topics || [],
          defaultBranch: repo.defaultBranch || "main",
          branches: repo.branches || [],
          releases: repo.releases || [],
          logoUrl: repo.logoUrl,
          requiredApprovals: repo.requiredApprovals,
          zapPolicy: repo.zapPolicy,
          links: repo.links,
          clone: cloneUrls, // Include both git server URL and GitHub/GitLab/Codeberg sourceUrl
        }),
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
        const filesWithContent = filesWithOverrides.filter((f: any) => f.content);
        const totalContentSizeKB = filesWithContent.reduce((sum: number, f: any) => {
          const base64Size = f.content ? (f.content.length * 3) / 4 : 0;
          return sum + (base64Size / 1024);
        }, 0);
        
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
        const filesWithContent = filesWithOverrides.filter((f: any) => f.content);
        const totalContentSizeKB = filesWithContent.reduce((sum: number, f: any) => {
          const base64Size = f.content ? (f.content.length * 3) / 4 : 0;
          return sum + (base64Size / 1024);
        }, 0);
        
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

    // Step 6.5: Send event directly to bridge for immediate processing (optional optimization)
    // This eliminates relay propagation delay - bridge will process immediately
    // If this fails, bridge will still receive event via relay subscription
    // CRITICAL: Use the confirmed event ID from relays (result.eventId) to ensure consistency
    try {
      onProgress?.("Sending event to bridge for immediate processing...");
      
      // Ensure we're using the confirmed event ID from relays
      const eventToSend = {
        ...repoEvent,
        id: result.eventId || repoEvent.id, // Use confirmed ID from relays
      };
      
      // Log event structure before sending to bridge
      console.log(`🔍 [Push Repo] Sending event to bridge:`, {
        eventId: eventToSend.id,
        kind: eventToSend.kind,
        pubkey: eventToSend.pubkey ? `${eventToSend.pubkey.slice(0, 8)}...` : "missing",
        sig: eventToSend.sig ? `${eventToSend.sig.slice(0, 16)}...` : "missing",
        created_at: eventToSend.created_at,
        tagsCount: Array.isArray(eventToSend.tags) ? eventToSend.tags.length : 0,
        contentLength: typeof eventToSend.content === "string" ? eventToSend.content.length : 0,
      });
      
      const bridgeResponse = await fetch("/api/nostr/repo/event", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(eventToSend),
      });
      
      if (bridgeResponse.ok) {
        const bridgeResult = await bridgeResponse.json();
        console.log(`✅ [Push Repo] Event sent directly to bridge: ${bridgeResult.status || "accepted"}`);
        onProgress?.("✅ Event processed by bridge immediately!");
      } else {
        const errorText = await bridgeResponse.text();
        console.warn(`⚠️ [Push Repo] Bridge direct submission failed (will receive via relay): ${errorText}`);
        // Don't fail - bridge will get it via relay subscription
      }
    } catch (bridgeError: any) {
      console.warn(`⚠️ [Push Repo] Bridge direct submission error (will receive via relay):`, bridgeError?.message || bridgeError);
      // Don't fail - bridge will get it via relay subscription
    }

    if (result.confirmed) {
      // Step 7: Store event ID and update status
      storeRepoEventId(repoSlug, entity, result.eventId, true);
      setRepoStatus(repoSlug, entity, "live");
      onProgress?.("✅ Published to Nostr!");
      
      return {
        success: true,
        eventId: result.eventId,
        confirmed: true,
        filesForBridge,
      };
    } else {
      // Still store event ID even if not confirmed (might be delayed)
      storeRepoEventId(repoSlug, entity, result.eventId, false);
      setRepoStatus(repoSlug, entity, "local"); // Revert to local if not confirmed
      onProgress?.("⚠️ Published but awaiting confirmation");
      
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

