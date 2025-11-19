/**
 * Push local repository to Nostr
 * Gathers all repo data and publishes complete repository event
 */

import { createRepositoryEvent, KIND_REPOSITORY } from "./events";
import { publishWithConfirmation, storeRepoEventId } from "./publish-with-confirmation";
import { setRepoStatus } from "../utils/repo-status";
import { getGraspServers } from "../utils/grasp-servers";
import { loadStoredRepos, loadRepoOverrides, type StoredRepo } from "../repos/storage";

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
}> {
  const { repoSlug, entity, publish, subscribe, defaultRelays, privateKey, pubkey, onProgress } = options;
  
  // Check for NIP-07 first
  const hasNip07 = typeof window !== "undefined" && window.nostr;

  try {
    // Step 1: Set status to "pushing"
    setRepoStatus(repoSlug, entity, "pushing");
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
    
    // Step 4: Get git server URL
    // CRITICAL: Don't use localhost as a clone URL - it's not a real git server
    // For localhost dev, use the production URL (gittr.space) or configured URL
    const gitServerUrl = process.env.NEXT_PUBLIC_GIT_SERVER_URL || 
      (typeof window !== 'undefined' && !window.location.hostname.includes('localhost') 
        ? `${window.location.protocol}//${window.location.host}` 
        : 'https://gittr.space');
    
    // Step 4b: Build clone URLs array - include both git server URL and sourceUrl if it's GitHub/GitLab/Codeberg
    // CRITICAL: Include GitHub/GitLab/Codeberg sourceUrl in clone array so it's preserved when syncing from Nostr
    const cloneUrls: string[] = [gitServerUrl];
    if (repo.sourceUrl) {
      // Check if sourceUrl is GitHub/GitLab/Codeberg and add it to clone URLs
      const isGitHub = repo.sourceUrl.includes('github.com');
      const isGitLab = repo.sourceUrl.includes('gitlab.com');
      const isCodeberg = repo.sourceUrl.includes('codeberg.org');
      if (isGitHub || isGitLab || isCodeberg) {
        // Convert sourceUrl to clone URL format (add .git if needed)
        let cloneUrl = repo.sourceUrl;
        if (!cloneUrl.endsWith('.git')) {
          cloneUrl = `${cloneUrl}.git`;
        }
        // Only add if not already in array
        if (!cloneUrls.includes(cloneUrl)) {
          cloneUrls.push(cloneUrl);
        }
      }
    }

    // Step 5: Merge file overrides (user edits) into files array
    onProgress?.("Merging file overrides...");
    const savedOverrides = typeof window !== 'undefined' 
      ? loadRepoOverrides(entity, repoSlug)
      : {};
    
    // Start with repo files (or empty array if none)
    const baseFiles = (repo.files && Array.isArray(repo.files)) ? [...repo.files] : [];
    
    // Merge overrides into files
    const filesWithOverrides = baseFiles.map((file: any) => {
      const filePath = file.path || "";
      if (savedOverrides[filePath] !== undefined) {
        return {
          ...file,
          content: savedOverrides[filePath] || "",
        };
      }
      return file;
    });
    
    // Add any new files from overrides that aren't in the base files
    for (const [overridePath, overrideContent] of Object.entries(savedOverrides)) {
      if (!filesWithOverrides.find((f: any) => (f.path || "") === overridePath)) {
        filesWithOverrides.push({
          type: "file",
          path: overridePath,
          content: overrideContent || "",
        });
      }
    }

    // Step 6: Create repository event with ALL current state
    onProgress?.("Creating repository event...");
    
    let repoEvent: any;
    
    if (hasNip07 && window.nostr) {
      // Use NIP-07 - create unsigned event, hash it, then sign with extension
      const { getEventHash } = await import("nostr-tools");
      const signerPubkey = await window.nostr.getPublicKey();
      
      repoEvent = {
        kind: KIND_REPOSITORY,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["d", `${entity}/${actualRepositoryName}`],
          ["repo", entity, actualRepositoryName],
          ...(repo.sourceUrl ? [["source", repo.sourceUrl]] : []),
          ...(repo.forkedFrom ? [["forkedFrom", repo.forkedFrom]] : []),
          ...(defaultRelays.map(relay => ["relay", relay])),
          ...(repo.contributors || []).map((c: any) => ["p", c.pubkey || c.githubLogin || "", c.weight || 0, c.role || ""]),
        ],
        content: JSON.stringify({
          repositoryName: actualRepositoryName, // Bridge expects 'repositoryName' - use exact name from repo data
          name: repo.name || actualRepositoryName, // Keep 'name' for frontend compatibility
          description: repo.description || `Repository: ${repo.name || actualRepositoryName}`,
          publicRead: repo.publicRead !== false,
          publicWrite: false,
          gitSshBase: repo.gitSshBase || "", // Bridge expects this field
          readme: repo.readme,
          files: filesWithOverrides, // Use files with overrides merged in
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
      
      // Sign with NIP-07
      repoEvent = await window.nostr.signEvent(repoEvent);
    } else if (privateKey) {
      // Use private key (fallback)
      repoEvent = createRepositoryEvent(
        {
          repositoryName: actualRepositoryName, // Use exact name from repo data
          publicRead: repo.publicRead !== false,
          publicWrite: false,
          description: repo.description || `Repository: ${repo.name || actualRepositoryName}`,
          sourceUrl: repo.sourceUrl,
          forkedFrom: repo.forkedFrom,
          readme: repo.readme,
          files: filesWithOverrides, // Use files with overrides merged in
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
    } else {
      throw new Error("No signing method available. Please use NIP-07 extension or configure a private key.");
    }

    // Step 6: Publish with confirmation
    // CRITICAL: Kind 51 (repository events) must be published ONLY to GRASP servers
    // Normal Nostr relays don't support kind 51 - only GRASP servers (git/relay combos) can handle them
    const graspRelays = getGraspServers(defaultRelays);
    if (graspRelays.length === 0) {
      throw new Error("No GRASP servers available. Kind 51 events require GRASP servers.");
    }
    
    onProgress?.(`Publishing to ${graspRelays.length} GRASP servers...`);
    
    const result = await publishWithConfirmation(
      publish,
      subscribe,
      repoEvent,
      graspRelays, // Only publish to GRASP servers for kind 51
      15000 // 15 second timeout for push
    );

    if (result.confirmed) {
      // Step 7: Store event ID and update status
      storeRepoEventId(repoSlug, entity, result.eventId, true);
      setRepoStatus(repoSlug, entity, "live");
      onProgress?.("✅ Published to Nostr!");
      
      return {
        success: true,
        eventId: result.eventId,
        confirmed: true,
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
      };
    }
  } catch (error: any) {
    // Revert status on error
    setRepoStatus(repoSlug, entity, "local");
    onProgress?.("❌ Failed to push");
    
    return {
      success: false,
      confirmed: false,
      error: error.message || "Unknown error",
    };
  }
}

