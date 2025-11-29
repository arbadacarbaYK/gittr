"use client";

/**
 * Git Source Fetcher
 * 
 * Handles fetching files from multiple git sources according to NIP-34:
 * - Nostr git servers (grasp servers): https://relay.ngit.dev/npub/.../repo.git
 * - GitHub: https://github.com/user/repo.git
 * - Codeberg: https://codeberg.org/user/repo.git
 * - GitLab: https://gitlab.com/user/repo.git
 * - Other git servers
 * 
 * Based on NIP-34: https://github.com/nostr-protocol/nips/blob/master/34.md
 */

// CRITICAL: Shared cache for bridge API calls to prevent duplicate requests
// All nostr-git sources for the same repo hit the same bridge API endpoint
// Key: `${ownerPubkey}:${repo}:${branch}`
const bridgeApiCache = new Map<string, Promise<Array<{ type: string; path: string; size?: number }> | null>>();

// CRITICAL: Shared cache for clone API calls to prevent duplicate clone triggers
// Key: `${ownerPubkey}:${repo}`
const cloneTriggerCache = new Map<string, Promise<any>>();

export type GitSourceType = 
  | "nostr-git"      // Nostr git server (grasp): https://relay.ngit.dev/npub/.../repo.git
  | "github"         // GitHub: https://github.com/user/repo.git
  | "codeberg"       // Codeberg: https://codeberg.org/user/repo.git
  | "gitlab"         // GitLab: https://gitlab.com/user/repo.git
  | "unknown";       // Unknown git server

export interface GitSource {
  type: GitSourceType;
  url: string;
  displayName: string;
  owner?: string;
  repo?: string;
  npub?: string; // For nostr-git sources
}

export interface FetchStatus {
  source: GitSource;
  status: "pending" | "fetching" | "success" | "failed";
  files?: Array<{ type: string; path: string; size?: number }>;
  error?: string;
  fetchedAt?: number;
}

/**
 * Parse a clone URL and determine its source type
 */
export function parseGitSource(cloneUrl: string): GitSource {
  // Validate input
  if (!cloneUrl || typeof cloneUrl !== "string") {
    console.warn("⚠️ [Git Source] Invalid cloneUrl:", cloneUrl);
    return {
      type: "unknown",
      url: String(cloneUrl || ""),
      displayName: "Invalid URL",
    };
  }
  
  // CRITICAL: Convert SSH URLs (git@host:owner/repo) to https:// for processing
  // SSH format: git@github.com:owner/repo or git@github.com:owner/repo.git
  // We'll convert it to https:// for API calls
  let normalizedUrl = cloneUrl;
  let originalProtocol = "https";
  const sshMatch = cloneUrl.match(/^git@([^:]+):(.+)$/);
  if (sshMatch) {
    const [, host, path] = sshMatch;
    normalizedUrl = `https://${host}/${path}`;
    originalProtocol = "ssh";
    console.log(`🔄 [Git Source] Converting SSH URL to HTTPS for processing: ${normalizedUrl}`);
  } else if (cloneUrl.startsWith("git://")) {
    // CRITICAL: Convert git:// URLs to https:// for processing
    // git:// protocol is used by some git servers (e.g., git://jb55.com/damus)
    // We'll convert it to https:// for the clone API, but preserve original for display
    normalizedUrl = cloneUrl.replace(/^git:\/\//, "https://");
    originalProtocol = "git";
    console.log(`🔄 [Git Source] Converting git:// to https:// for processing: ${normalizedUrl}`);
  } else if (cloneUrl.startsWith("nostr://")) {
    // CRITICAL: Convert nostr:// URLs to https:// for processing
    // Format: nostr://npub...@host/repo or nostr://npub...@host/repo.git
    // We'll convert it to https:// for the clone API
    const nostrMatch = cloneUrl.match(/^nostr:\/\/([^@]+)@([^\/]+)\/(.+)$/);
    if (nostrMatch) {
      const [, npub, host, repo] = nostrMatch;
      normalizedUrl = `https://${host}/${npub}/${repo}`;
      originalProtocol = "nostr";
      console.log(`🔄 [Git Source] Converting nostr:// URL to HTTPS for processing: ${normalizedUrl}`);
    } else {
      // Unknown nostr:// format - mark as unknown
      console.warn(`⚠️ [Git Source] Unknown nostr:// URL format: ${cloneUrl}`);
      return {
        type: "unknown",
        url: cloneUrl,
        displayName: "Unknown nostr:// URL",
      };
    }
  }
  
  // Remove .git suffix if present
  const url = normalizedUrl.replace(/\.git$/, "");
  
  // Import GRASP server detection (includes known GRASP servers)
  const { isGraspServer: isGraspServerFn, KNOWN_GRASP_DOMAINS } = require("@/lib/utils/grasp-servers");
  
  // Known git server domains (GRASP servers + custom git servers)
  const knownGitServers = [
    ...KNOWN_GRASP_DOMAINS,
    "git.vanderwarker.family",
    "jb55.com", // Custom git server (not GRASP, but supports git)
  ];
  
  // Nostr git server (grasp) pattern: https://relay.ngit.dev/npub.../repo
  // or: https://ngit.danconwaydev.com/npub.../repo
  // or: https://git.gittr.space/8dac122d92c1a00b74a16c2ee8bcb5e0d173a4ce3787c550ff665a570fc98d37/repo (pubkey instead of npub)
  // or: https://git.vanderwarker.family/nostr/repo (without npub in path)
  const nostrGitMatch = url.match(/^https?:\/\/([^\/]+)\/(npub[a-z0-9]+)\/([^\/]+)$/i);
  if (nostrGitMatch) {
    const [, domain, npub, repo] = nostrGitMatch;
    if (domain && npub && repo) {
      return {
        type: "nostr-git",
        url: normalizedUrl, // Use normalized URL (https://) for API calls
        displayName: domain,
        npub,
        repo,
      };
    }
  }
  
  // Pattern for URLs with pubkey (64-char hex) instead of npub: https://git.gittr.space/8dac122d.../repo
  const pubkeyGitMatch = url.match(/^https?:\/\/([^\/]+)\/([0-9a-f]{64})\/([^\/]+)$/i);
  if (pubkeyGitMatch) {
    const [, domain, pubkey, repo] = pubkeyGitMatch;
    // Check if this is a known git server domain
    if (domain && knownGitServers.some(server => domain.includes(server) || server.includes(domain))) {
      // Convert pubkey to npub for bridge API (bridge expects npub)
      try {
        const { nip19 } = require("nostr-tools");
        const npub = nip19.npubEncode(pubkey);
        return {
          type: "nostr-git",
          url: normalizedUrl, // Use normalized URL (https://) for API calls
          displayName: domain,
          npub,
          repo,
        };
      } catch (e) {
        console.warn(`⚠️ [Git Source] Failed to convert pubkey to npub: ${pubkey ? pubkey.slice(0, 16) + '...' : 'unknown'}`);
        // Fall through to try as regular git server
      }
    }
  }
  
  // Alternative pattern for git servers without npub in path (e.g., git.vanderwarker.family/nostr/repo)
  // or custom git servers like git://jb55.com/damus
  // These are still considered nostr-git servers if they're known git server domains
  const gitServerMatch = url.match(/^https?:\/\/([^\/]+)\/([^\/]+)\/([^\/]+)$/i);
  if (gitServerMatch) {
    const [, domain, pathSegment, repo] = gitServerMatch;
    // Check if this is a known git server domain
    if (domain && knownGitServers.some(server => domain.includes(server) || server.includes(domain))) {
      return {
        type: "nostr-git",
        url: normalizedUrl, // Use normalized URL (https://) for API calls
        displayName: domain,
        npub: "", // No npub in path
        repo: `${pathSegment}/${repo}`, // Include path segment in repo name
      };
    }
  }
  
  // Pattern for simple git://domain/repo or https://domain/repo (single path segment)
  // e.g., git://jb55.com/damus or https://jb55.com/damus
  const simpleGitMatch = url.match(/^https?:\/\/([^\/]+)\/([^\/]+)$/i);
  if (simpleGitMatch) {
    const [, domain, repo] = simpleGitMatch;
    // Check if this is a known git server domain
    if (domain && knownGitServers.some(server => domain.includes(server) || server.includes(domain))) {
      return {
        type: "nostr-git",
        url: normalizedUrl, // Use normalized URL (https://) for API calls
        displayName: domain,
        npub: "", // No npub in path
        repo: repo,
      };
    }
  }
  
  // GitHub pattern: https://github.com/owner/repo or https://github.com/owner/repo.git
  const githubMatch = url.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?$/i);
  if (githubMatch) {
    const [, owner, repo] = githubMatch;
    if (!owner || !repo) {
      return {
        type: "unknown",
        url: cloneUrl,
        displayName: "Invalid GitHub URL",
      };
    }
    return {
      type: "github",
      url: cloneUrl,
      displayName: "github.com",
      owner,
      repo: repo.replace(/\.git$/, ""), // Remove .git suffix if present
    };
  }
  
  // Codeberg pattern: https://codeberg.org/owner/repo
  const codebergMatch = url.match(/^https?:\/\/codeberg\.org\/([^\/]+)\/([^\/]+)$/i);
  if (codebergMatch) {
    const [, owner, repo] = codebergMatch;
    return {
      type: "codeberg",
      url: cloneUrl,
      displayName: "codeberg.org",
      owner,
      repo,
    };
  }
  
  // GitLab pattern: https://gitlab.com/owner/repo
  const gitlabMatch = url.match(/^https?:\/\/gitlab\.com\/([^\/]+)\/([^\/]+)$/i);
  if (gitlabMatch) {
    const [, owner, repo] = gitlabMatch;
    return {
      type: "gitlab",
      url: cloneUrl,
      displayName: "gitlab.com",
      owner,
      repo,
    };
  }
  
  // Unknown source
  try {
    const urlObj = new URL(cloneUrl);
    return {
      type: "unknown",
      url: cloneUrl,
      displayName: urlObj.hostname || "Unknown Git Source",
    };
  } catch (e) {
    // Invalid URL - return safe fallback
    console.warn("⚠️ [Git Source] Invalid URL format:", cloneUrl);
    return {
      type: "unknown",
      url: String(cloneUrl || ""),
      displayName: "Invalid URL",
    };
  }
}

/**
 * Fetch file list from a GitHub repository
 * Uses server-side proxy to leverage platform OAuth token (if configured)
 * This avoids rate limits and doesn't require user login
 */
async function fetchFromGitHub(
  owner: string,
  repo: string,
  branch: string = "main"
): Promise<Array<{ type: string; path: string; size?: number }> | null> {
  try {
    // CRITICAL: First get the default branch from repo info
    // This ensures we use the correct branch (not always "main" - could be "master" or something else)
    let defaultBranch: string | null = null;
    try {
      const repoInfoEndpoint = `/repos/${owner}/${repo}`;
      const repoInfoProxyUrl = `/api/github/proxy?endpoint=${encodeURIComponent(repoInfoEndpoint)}`;
      const repoInfoResponse = await fetch(repoInfoProxyUrl);
      if (repoInfoResponse.ok) {
        const repoInfoText = await repoInfoResponse.text();
        const repoInfo: any = JSON.parse(repoInfoText);
        if (repoInfo.default_branch) {
          defaultBranch = repoInfo.default_branch;
          console.log(`✅ [Git Source] Got default branch from repo: ${defaultBranch}`);
        }
      }
    } catch (repoInfoError) {
      console.warn(`⚠️ [Git Source] Failed to get repo info, will try provided branch:`, repoInfoError);
    }
    
    // CRITICAL: Prioritize default branch from repo info (most reliable)
    // Then try provided branch, then main (more common), then master (older repos)
    const branchesToTry = [
      defaultBranch, // First: default branch from repo info (most reliable)
      branch,        // Second: provided branch parameter
      "main",        // Third: main (most common default)
      "master"       // Fourth: master (older repos)
    ].filter((b): b is string => !!b && typeof b === 'string')
     .filter((b, i, arr) => arr.indexOf(b) === i); // Remove duplicates
    
    let sha: string | null = null;
    let successfulBranch: string | null = null;
    
    for (const branchToTry of branchesToTry) {
      try {
        // Use server-side proxy which can use platform OAuth token from env
        // This avoids rate limits and doesn't require user login
        // Get the SHA of the branch first
        const branchEndpoint = `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branchToTry)}`;
        const branchProxyUrl = `/api/github/proxy?endpoint=${encodeURIComponent(branchEndpoint)}`;
        console.log(`🔍 [Git Source] Trying branch: ${branchToTry}`);
        const branchResponse = await fetch(branchProxyUrl);
        
        if (branchResponse.ok) {
          try {
            const branchText = await branchResponse.text();
            const branchData: any = JSON.parse(branchText);
            if (branchData.object?.sha) {
              const branchSha = branchData.object.sha;
              sha = branchSha;
              successfulBranch = branchToTry;
              console.log(`✅ [Git Source] Got branch SHA for ${branchToTry}: ${branchSha.slice(0, 8)}...`);
              break; // Success! Use this branch
            } else {
              console.warn(`⚠️ [Git Source] Branch response missing object.sha for ${branchToTry}`);
            }
          } catch (e) {
            console.warn(`⚠️ [Git Source] Failed to parse branch response for ${branchToTry}:`, e);
            continue; // Try next branch
          }
        } else {
          console.warn(`⚠️ [Git Source] Branch ${branchToTry} not found (${branchResponse.status}), trying next...`);
          continue; // Try next branch
        }
      } catch (branchError) {
        console.warn(`⚠️ [Git Source] Error fetching branch ${branchToTry}:`, branchError);
        continue; // Try next branch
      }
    }
    
    if (!sha || !successfulBranch) {
      console.error(`❌ [Git Source] Failed to get branch SHA for any branch. Tried: ${branchesToTry.join(", ")}`);
      return null;
    }
    
    // sha and successfulBranch are guaranteed to be non-null here
    const finalSha = sha;
    
    // Fetch tree recursively
    const treeEndpoint = `/repos/${owner}/${repo}/git/trees/${finalSha}?recursive=1`;
    const treeProxyUrl = `/api/github/proxy?endpoint=${encodeURIComponent(treeEndpoint)}`;
    const response = await fetch(treeProxyUrl);
    
    if (!response.ok) {
      let errorText = "";
      let errorData: any = {};
      try {
        errorText = await response.text();
        console.error(`❌ [Git Source] GitHub API error (${response.status}):`, errorText.substring(0, 200));
        if (errorText) {
          try {
            errorData = JSON.parse(errorText);
          } catch {
            // Not JSON, use as-is
          }
        }
      } catch (e) {
        console.error(`❌ [Git Source] Failed to read GitHub error response:`, e);
      }
      
      if (response.status === 403 && (errorData.message?.includes("rate limit") || errorText.includes("rate limit"))) {
        console.warn(`⚠️ [Git Source] GitHub rate limit exceeded. Try again later or use authenticated requests.`);
        throw new Error("GitHub API rate limit exceeded. Please try again later.");
      }
      
      console.warn(`⚠️ [Git Source] GitHub fetch failed: ${response.status} - ${errorData.message || errorText.substring(0, 100)}`);
      return null;
    }
    
    let data: any;
    try {
      const responseText = await response.text();
      console.log(`✅ [Git Source] GitHub API response received (${response.status}), length: ${responseText.length}`);
      data = JSON.parse(responseText);
    } catch (e) {
      console.error(`❌ [Git Source] Failed to parse GitHub API response:`, e);
      return null;
    }
    
    if (!data.tree || !Array.isArray(data.tree)) {
      console.warn(`⚠️ [Git Source] GitHub API response missing tree array:`, { hasTree: !!data.tree, treeIsArray: Array.isArray(data.tree), dataKeys: Object.keys(data) });
      return null;
    }
    
    console.log(`✅ [Git Source] GitHub API returned ${data.tree.length} items in tree`);
    
    const files = data.tree
      .filter((n: any) => n.type === "blob")
      .map((n: any) => ({ type: "file", path: n.path, size: n.size }));
    const dirs = data.tree
      .filter((n: any) => n.type === "tree")
      .map((n: any) => ({ type: "dir", path: n.path }));
    
    console.log(`✅ [Git Source] Processed ${files.length} files and ${dirs.length} dirs from GitHub`);
    
    // Add parent directories for files
    const allDirs = new Set<string>(dirs.map((d: any) => d.path));
    files.forEach((f: any) => {
      const parts = f.path.split("/");
      for (let i = 1; i < parts.length; i++) {
        const dirPath = parts.slice(0, i).join("/");
        if (dirPath && !allDirs.has(dirPath)) {
          allDirs.add(dirPath);
        }
      }
    });
    
    const allDirEntries = Array.from(allDirs).map(path => ({ type: "dir", path }));
    
    return [...allDirEntries, ...files];
  } catch (error: any) {
    console.error("❌ [Git Source] GitHub fetch error:", error);
    return null;
  }
}

/**
 * Fetch file list from a Codeberg repository
 */
async function fetchFromCodeberg(
  owner: string,
  repo: string,
  branch: string = "main"
): Promise<Array<{ type: string; path: string; size?: number }> | null> {
  try {
    // CRITICAL: First get the default branch from repo info
    let defaultBranch: string | null = null;
    try {
      const repoInfoUrl = `https://codeberg.org/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
      const repoInfoResponse = await fetch(repoInfoUrl, {
        headers: {
          "User-Agent": "gittr-space",
          "Accept": "application/json"
        } as any
      });
      if (repoInfoResponse.ok) {
        const repoInfo: any = await repoInfoResponse.json();
        if (repoInfo.default_branch) {
          defaultBranch = repoInfo.default_branch;
          console.log(`✅ [Git Source] Got default branch from Codeberg repo: ${defaultBranch}`);
        }
      }
    } catch (repoInfoError) {
      console.warn(`⚠️ [Git Source] Failed to get Codeberg repo info:`, repoInfoError);
    }
    
    // CRITICAL: Prioritize default branch from repo info (most reliable)
    // Then try provided branch, then main (more common), then master (older repos)
    const branchesToTry = [
      defaultBranch, // First: default branch from repo info (most reliable)
      branch,        // Second: provided branch parameter
      "main",        // Third: main (most common default)
      "master"       // Fourth: master (older repos)
    ].filter((b): b is string => !!b && typeof b === 'string')
     .filter((b, i, arr) => arr.indexOf(b) === i); // Remove duplicates
    
    let sha: string | null = null;
    let successfulBranch: string | null = null;
    
    for (const branchToTry of branchesToTry) {
      try {
        // Codeberg uses Gitea API (similar to GitHub)
        // CRITICAL: Encode owner and repo separately (don't encode the slash between them)
        const branchUrl = `https://codeberg.org/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${encodeURIComponent(branchToTry)}`;
        const branchResponse = await fetch(branchUrl, {
          headers: {
            "User-Agent": "gittr-space",
            "Accept": "application/json"
          } as any
        });
        
        if (branchResponse.ok) {
          const branchData: any = await branchResponse.json();
          
          // Gitea/Codeberg API might return:
          // 1. Single object: { object: { sha: "..." } }
          // 2. Array: [{ ref: "...", object: { sha: "..." } }]
          // 3. Direct sha: { sha: "..." }
          let branchSha: string | null = null;
          
          if (Array.isArray(branchData) && branchData.length > 0) {
            // Array response - get first matching ref
            const matchingRef = branchData.find((ref: any) => 
              ref.ref?.endsWith(`/${branchToTry}`) || ref.ref?.endsWith(`refs/heads/${branchToTry}`)
            ) || branchData[0];
            branchSha = matchingRef.object?.sha || matchingRef.sha;
          } else if (branchData.object?.sha) {
            // Single object with nested object.sha
            branchSha = branchData.object.sha;
          } else if (branchData.sha) {
            // Direct sha field
            branchSha = branchData.sha;
          }
          
          if (branchSha) {
            sha = branchSha;
            successfulBranch = branchToTry;
            console.log(`✅ [Git Source] Got Codeberg branch SHA for ${branchToTry}: ${branchSha.slice(0, 8)}...`);
            break; // Success! Use this branch
          } else {
            console.warn(`⚠️ [Git Source] Codeberg branch response missing object.sha for ${branchToTry}`, {
              responseType: Array.isArray(branchData) ? 'array' : typeof branchData,
              responseKeys: Array.isArray(branchData) ? `array[${branchData.length}]` : Object.keys(branchData || {}),
              responsePreview: JSON.stringify(branchData).substring(0, 200),
            });
            
            // Try alternative: get branch from commits API
            try {
              const commitsUrl = `https://codeberg.org/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(branchToTry)}?limit=1`;
              const commitsResponse = await fetch(commitsUrl, {
                headers: {
                  "User-Agent": "gittr-space",
                  "Accept": "application/json"
                } as any
              });
              if (commitsResponse.ok) {
                const commitsData: any = await commitsResponse.json();
                if (Array.isArray(commitsData) && commitsData.length > 0 && commitsData[0].sha) {
                  branchSha = commitsData[0].sha;
                  sha = branchSha;
                  successfulBranch = branchToTry;
                  console.log(`✅ [Git Source] Got Codeberg branch SHA from commits API for ${branchToTry}: ${branchSha?.slice(0, 8) || 'unknown'}...`);
                  break;
                } else if (commitsData.sha) {
                  branchSha = commitsData.sha;
                  sha = branchSha;
                  successfulBranch = branchToTry;
                  console.log(`✅ [Git Source] Got Codeberg branch SHA from commits API (single commit) for ${branchToTry}: ${branchSha?.slice(0, 8) || 'unknown'}...`);
                  break;
                }
              }
            } catch (commitsError) {
              console.warn(`⚠️ [Git Source] Failed to get branch SHA from commits API:`, commitsError);
            }
          }
        } else {
          console.warn(`⚠️ [Git Source] Codeberg branch ${branchToTry} not found (${branchResponse.status}), trying next...`);
          continue; // Try next branch
        }
      } catch (branchError) {
        console.warn(`⚠️ [Git Source] Error fetching Codeberg branch ${branchToTry}:`, branchError);
        continue; // Try next branch
      }
    }
    
    if (!sha || !successfulBranch) {
      console.error(`❌ [Git Source] Failed to get Codeberg branch SHA for any branch. Tried: ${branchesToTry.join(", ")}`);
      return null;
    }
    
    // sha and successfulBranch are guaranteed to be non-null here
    const finalSha = sha;
    
    // Fetch tree recursively
    // CRITICAL: Encode owner and repo separately (don't encode the slash between them)
    // This is required for Codeberg/Gitea API
    const treeUrl = `https://codeberg.org/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${finalSha}?recursive=1`;
    const response = await fetch(treeUrl, {
      headers: {
        "User-Agent": "gittr",
        "Accept": "application/json"
      } as any
    });
    
    if (!response.ok) {
      console.warn(`⚠️ [Git Source] Codeberg fetch failed: ${response.status}`);
      return null;
    }
    
    const data: any = await response.json();
    if (!data.tree || !Array.isArray(data.tree)) {
      return null;
    }
    
    const files = data.tree
      .filter((n: any) => n.type === "blob")
      .map((n: any) => ({ type: "file", path: n.path, size: n.size }));
    const dirs = data.tree
      .filter((n: any) => n.type === "tree")
      .map((n: any) => ({ type: "dir", path: n.path }));
    
    // Add parent directories
    const allDirs = new Set<string>(dirs.map((d: any) => d.path));
    files.forEach((f: any) => {
      const parts = f.path.split("/");
      for (let i = 1; i < parts.length; i++) {
        const dirPath = parts.slice(0, i).join("/");
        if (dirPath && !allDirs.has(dirPath)) {
          allDirs.add(dirPath);
        }
      }
    });
    
    const allDirEntries = Array.from(allDirs).map(path => ({ type: "dir", path }));
    
    return [...allDirEntries, ...files];
  } catch (error: any) {
    console.error("❌ [Git Source] Codeberg fetch error:", error);
    return null;
  }
}

/**
 * Fetch file list from a GitLab repository
 */
async function fetchFromGitLab(
  owner: string,
  repo: string,
  branch: string = "main"
): Promise<Array<{ type: string; path: string; size?: number }> | null> {
  try {
    // CRITICAL: First get the default branch from repo info
    let defaultBranch: string | null = null;
    const projectPath = encodeURIComponent(`${owner}/${repo}`);
    try {
      const repoInfoUrl = `https://gitlab.com/api/v4/projects/${projectPath}`;
      const repoInfoResponse = await fetch(repoInfoUrl, {
        headers: {
          "User-Agent": "gittr-space",
        } as any
      });
      if (repoInfoResponse.ok) {
        const repoInfo: any = await repoInfoResponse.json();
        if (repoInfo.default_branch) {
          defaultBranch = repoInfo.default_branch;
          console.log(`✅ [Git Source] Got default branch from GitLab repo: ${defaultBranch}`);
        }
      }
    } catch (repoInfoError) {
      console.warn(`⚠️ [Git Source] Failed to get GitLab repo info:`, repoInfoError);
    }
    
    // CRITICAL: Prioritize default branch from repo info (most reliable)
    // Then try provided branch, then main (more common), then master (older repos)
    const branchesToTry = [
      defaultBranch, // First: default branch from repo info (most reliable)
      branch,        // Second: provided branch parameter
      "main",        // Third: main (most common default)
      "master"       // Fourth: master (older repos)
    ].filter((b): b is string => !!b && typeof b === 'string')
     .filter((b, i, arr) => arr.indexOf(b) === i); // Remove duplicates
    
    for (const branchToTry of branchesToTry) {
      try {
        const treeUrl = `https://gitlab.com/api/v4/projects/${projectPath}/repository/tree?ref=${encodeURIComponent(branchToTry)}&recursive=true&per_page=100`;
        
        const response = await fetch(treeUrl, {
          headers: {
            "User-Agent": "gittr-space",
            "Accept": "application/json"
          } as any
        });
        
        if (response.ok) {
          const data: any = await response.json();
          if (Array.isArray(data) && data.length > 0) {
            console.log(`✅ [Git Source] Got GitLab files for branch ${branchToTry}: ${data.length} items`);
            const files = data
              .filter((n: any) => n.type === "blob")
              .map((n: any) => ({ type: "file", path: n.path, size: n.size }));
            const dirs = data
              .filter((n: any) => n.type === "tree")
              .map((n: any) => ({ type: "dir", path: n.path }));
            
            return [...dirs, ...files];
          }
        } else {
          console.warn(`⚠️ [Git Source] GitLab branch ${branchToTry} not found (${response.status}), trying next...`);
          continue; // Try next branch
        }
      } catch (branchError) {
        console.warn(`⚠️ [Git Source] Error fetching GitLab branch ${branchToTry}:`, branchError);
        continue; // Try next branch
      }
    }
    
    console.error(`❌ [Git Source] Failed to get GitLab files for any branch. Tried: ${branchesToTry.join(", ")}`);
    return null;
  } catch (error: any) {
    console.error("❌ [Git Source] GitLab fetch error:", error);
    return null;
  }
}

/**
 * Fetch file list from a Nostr git server (grasp server)
 * Uses git-nostr-bridge API and triggers clone if needed
 * 
 * CRITICAL: GRASP servers don't expose REST API endpoints - they only work via git protocol.
 * This function:
 * 1. Tries git-nostr-bridge API (reads from locally cloned repos)
 * 2. If 404, triggers clone via /api/nostr/repo/clone endpoint
 * 3. Retries bridge API after clone
 * 
 * @param npub - npub from clone URL (for clone API calls)
 * @param repo - repository name
 * @param branch - branch name
 * @param cloneUrl - full clone URL (must be HTTPS for GRASP servers)
 * @param eventPublisherPubkey - Optional: event publisher's pubkey (for bridge API - bridge stores repos by event publisher, not clone URL npub)
 */
async function fetchFromNostrGit(
  npub: string,
  repo: string,
  branch: string = "main",
  cloneUrl: string,
  eventPublisherPubkey?: string
): Promise<Array<{ type: string; path: string; size?: number }> | null> {
  // Import GRASP server detection function
  const { isGraspServer: isGraspServerFn } = require("@/lib/utils/grasp-servers");
  try {
    // Try git-nostr-bridge API first (if bridge has cloned the repo)
    // Format: /api/nostr/repo/files?ownerPubkey={pubkey}&repo={repo}&branch={branch}
    // CRITICAL: Bridge stores repos by event publisher's pubkey, not the npub from clone URL
    // So we should use eventPublisherPubkey if provided, otherwise decode npub from clone URL as fallback
    let ownerPubkey: string | null = null;
    
    if (eventPublisherPubkey && /^[0-9a-f]{64}$/i.test(eventPublisherPubkey)) {
      // Use event publisher's pubkey (preferred - this is what bridge uses)
      ownerPubkey = eventPublisherPubkey;
      console.log(`🔍 [Git Source] Using event publisher pubkey for bridge API: ${ownerPubkey.slice(0, 16)}...`);
    } else {
      // Fallback: decode npub from clone URL
      try {
        const { nip19 } = await import("nostr-tools");
        const decoded = nip19.decode(npub);
        if (decoded.type === "npub") {
          ownerPubkey = decoded.data as string;
          console.log(`🔍 [Git Source] Decoded npub from clone URL for bridge API: ${ownerPubkey.slice(0, 16)}...`);
        }
      } catch (e) {
        console.warn("⚠️ [Git Source] Failed to decode npub:", e);
      }
    }
    
    if (ownerPubkey) {
      // CRITICAL: Use shared cache for bridge API calls - all nostr-git sources share the same bridge
      const cacheKey = `${ownerPubkey}:${repo}:${branch}`;
      if (bridgeApiCache.has(cacheKey)) {
        console.log(`♻️ [Git Source] Reusing cached bridge API call for ${cacheKey.slice(0, 32)}...`);
        return await bridgeApiCache.get(cacheKey)!;
      }
      
      const bridgeUrl = `/api/nostr/repo/files?ownerPubkey=${encodeURIComponent(ownerPubkey)}&repo=${encodeURIComponent(repo)}&branch=${encodeURIComponent(branch)}`;
      console.log(`🔍 [Git Source] Trying git-nostr-bridge API:`, {
        npub: npub.slice(0, 16) + "...",
        ownerPubkey: ownerPubkey.slice(0, 16) + "...",
        repo,
        branch,
        url: bridgeUrl,
      });
      
      // Create shared promise for this bridge API call
      const bridgePromise = (async () => {
        try {
          const response = await fetch(bridgeUrl);
      
          if (response.ok) {
            const data = await response.json();
            if (data.files && Array.isArray(data.files) && data.files.length > 0) {
              console.log(`✅ [Git Source] Fetched ${data.files.length} files from git-nostr-bridge`);
              // Clear cache on success
              bridgeApiCache.delete(cacheKey);
              return data.files;
            } else {
              console.log(`⚠️ [Git Source] git-nostr-bridge API returned OK but no files:`, data);
            }
          } else {
            const errorText = await response.text().catch(() => "");
            console.log(`⚠️ [Git Source] git-nostr-bridge API failed: ${response.status} - ${errorText.substring(0, 200)}`);
            if (response.status === 404 || response.status === 500) {
              // 404: Repo not cloned yet
              // 500: Repo exists but is empty/corrupted (no valid branches, git command failed)
              const errorType = response.status === 404 ? "not cloned yet" : "empty or corrupted";
              console.log(`💡 [Git Source] Repository ${errorType} (${response.status}). Attempting to trigger clone...`);
              
              // Try to trigger clone via API endpoint
              // GRASP servers don't expose REST APIs - they only work via git protocol
              // So we need to clone via git protocol and then retry the bridge API
              // CRITICAL: Only trigger clone for GRASP servers, not GitHub/Codeberg/GitLab
              // Use centralized isGraspServer function which includes pattern matching (git., git-\d+.)
              const isGraspServerCheck = cloneUrl && isGraspServerFn(cloneUrl);
              console.log(`🔍 [Git Source] Clone trigger check:`, {
                hasOwnerPubkey: !!ownerPubkey,
                hasCloneUrl: !!cloneUrl,
                isGraspServer: isGraspServerCheck,
                cloneUrl: cloneUrl?.substring(0, 50) + "...",
                ownerPubkey: ownerPubkey?.slice(0, 16) + "..."
              });
              
              // CRITICAL: Normalize SSH URLs (git@host:path) and git:// URLs to https:// for clone API
              // The clone API will handle the conversion, but we need to pass https:// here
              let normalizedCloneUrl = cloneUrl;
              const sshMatch = cloneUrl.match(/^git@([^:]+):(.+)$/);
              if (sshMatch) {
                const [, host, path] = sshMatch;
                normalizedCloneUrl = `https://${host}/${path}`;
                console.log(`🔄 [Git Source] Normalizing SSH URL to https:// for clone API: ${normalizedCloneUrl}`);
              } else if (cloneUrl.startsWith("git://")) {
                normalizedCloneUrl = cloneUrl.replace(/^git:\/\//, "https://");
                console.log(`🔄 [Git Source] Normalizing git:// to https:// for clone API: ${normalizedCloneUrl}`);
              }
              
              if (ownerPubkey && normalizedCloneUrl && (normalizedCloneUrl.startsWith("https://") || normalizedCloneUrl.startsWith("http://")) && isGraspServerCheck) {
                // CRITICAL: Deduplicate clone triggers - use shared cache
                const cloneCacheKey = `${ownerPubkey}:${repo}`;
                if (cloneTriggerCache.has(cloneCacheKey)) {
                  console.log(`♻️ [Git Source] Clone already triggered for ${cloneCacheKey.slice(0, 32)}..., reusing promise`);
                  await cloneTriggerCache.get(cloneCacheKey)!;
                } else {
                  const clonePromise = (async () => {
                    try {
                      console.log(`🔍 [Git Source] Triggering clone via API:`, {
                        cloneUrl: normalizedCloneUrl,
                        originalCloneUrl: cloneUrl,
                        ownerPubkey: ownerPubkey.slice(0, 16) + "...",
                        repo
                      });
                      
                      const cloneResponse = await fetch("/api/nostr/repo/clone", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                          cloneUrl: normalizedCloneUrl, // Use normalized URL (https://) for clone API
                          ownerPubkey,
                          repo
                        })
                      });
              
                      if (cloneResponse.ok) {
                        const cloneData = await cloneResponse.json();
                        console.log(`✅ [Git Source] Clone triggered successfully:`, cloneData);
                        
                        // Start polling in the background (non-blocking)
                        // This allows the page to render immediately while clone completes
                        const pollForFiles = async (maxAttempts = 1, delay = 500) => {
                          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                            await new Promise(resolve => setTimeout(resolve, delay));
                            console.log(`🔍 [Git Source] Polling for files (attempt ${attempt}/${maxAttempts})...`);
                            
                            try {
                              const pollResponse = await fetch(bridgeUrl);
                              if (pollResponse.ok) {
                                const pollData = await pollResponse.json();
                                if (pollData.files && Array.isArray(pollData.files) && pollData.files.length > 0) {
                                  console.log(`✅ [Git Source] Files available after clone! Fetched ${pollData.files.length} files`);
                                  // Clear clone cache on success
                                  cloneTriggerCache.delete(cloneCacheKey);
                                  // Clear bridge cache and update it with success
                                  bridgeApiCache.delete(cacheKey);
                                  // Trigger a custom event to notify the page that files are ready
                                  if (typeof window !== 'undefined') {
                                    window.dispatchEvent(new CustomEvent('grasp-repo-cloned', {
                                      detail: { files: pollData.files, ownerPubkey, repo }
                                    }));
                                  }
                                  return pollData.files;
                                }
                              }
                            } catch (pollError) {
                              console.warn(`⚠️ [Git Source] Poll attempt ${attempt} failed:`, pollError);
                            }
                          }
                          console.log(`⚠️ [Git Source] Polling completed - files not yet available. User can refresh to try again.`);
                          // Clear clone cache after polling completes
                          cloneTriggerCache.delete(cloneCacheKey);
                          return null;
                        };
                        
                        // Start polling in background (don't await - non-blocking)
                        pollForFiles().catch(err => {
                          console.warn('Polling error:', err);
                          cloneTriggerCache.delete(cloneCacheKey);
                        });
                        
                        // Return null immediately to allow page to render
                        console.log(`💡 [Git Source] Clone initiated - polling for files in background. Page will render immediately.`);
                        return null;
                      } else {
                        const cloneError = await cloneResponse.json().catch(() => ({ error: "Unknown error" }));
                        console.log(`⚠️ [Git Source] Clone API failed: ${cloneResponse.status} -`, cloneError);
                        cloneTriggerCache.delete(cloneCacheKey);
                        return null;
                      }
                    } catch (cloneError: any) {
                      console.warn(`⚠️ [Git Source] Failed to trigger clone:`, cloneError.message);
                      cloneTriggerCache.delete(cloneCacheKey);
                      return null;
                    }
                  })();
                  cloneTriggerCache.set(cloneCacheKey, clonePromise);
                  await clonePromise;
                }
              } else {
                if (!isGraspServerCheck) {
                  console.log(`💡 [Git Source] Not a GRASP server - skipping clone trigger (GitHub/Codeberg/GitLab use their own APIs)`);
                } else {
                  console.log(`💡 [Git Source] Cannot trigger clone - missing ownerPubkey or cloneUrl is not HTTPS`);
                }
                console.log(`💡 [Git Source] Bridge path would be: reposDir/${ownerPubkey ? ownerPubkey.slice(0, 16) + '...' : '?'}/${repo}.git`);
              }
            }
          }
          
          // Clear cache on failure
          bridgeApiCache.delete(cacheKey);
          return null;
        } catch (error: any) {
          console.error("❌ [Git Source] Bridge API error:", error);
          bridgeApiCache.delete(cacheKey);
          return null;
        }
      })();
      
      // Store promise in cache
      bridgeApiCache.set(cacheKey, bridgePromise);
      return await bridgePromise;
    } else {
      console.warn(`⚠️ [Git Source] Could not decode npub to pubkey for bridge API: ${npub.slice(0, 16)}...`);
    }
    
    // CRITICAL: GRASP servers don't expose REST API endpoints - they only work via git protocol
    // We've already tried the bridge API (which reads from locally cloned repos)
    // If that failed, we tried to trigger a clone via the clone API endpoint
    // There's nothing else we can do - GRASP servers require git protocol, not HTTP REST APIs
    
    // Summary: All fetch attempts failed
    console.log(`❌ [Git Source] All fetch attempts failed for ${repo} from ${npub.slice(0, 16)}...`);
    console.log(`💡 [Git Source] Summary:`);
    console.log(`   - Bridge API: ${ownerPubkey ? 'Tried with pubkey ' + ownerPubkey.slice(0, 16) + '...' : 'Skipped (no pubkey)'}`);
    console.log(`   - Clone API: ${ownerPubkey && cloneUrl && cloneUrl.startsWith('https://') ? 'Tried to trigger clone' : 'Skipped (missing requirements)'}`);
    console.log(`   - GRASP servers: Don't expose REST APIs - only work via git protocol (requires git-nostr-bridge)`);
    console.log(`   - Next steps: Ensure git-nostr-bridge is running and has seen the repository event on Nostr, or wait for clone to complete`);
    
    return null;
  } catch (error: any) {
    console.error("❌ [Git Source] Nostr git fetch error:", error);
    return null;
  }
}

/**
 * Fetch files from a single git source
 * @param eventPublisherPubkey - Optional: event publisher's pubkey (for bridge API when source is nostr-git)
 */
export async function fetchFilesFromSource(
  source: GitSource,
  branch: string = "main",
  eventPublisherPubkey?: string
): Promise<Array<{ type: string; path: string; size?: number }> | null> {
  console.log(`🔍 [Git Source] Fetching from ${source.type}: ${source.displayName}`, {
    url: source.url,
    branch,
  });
  
  switch (source.type) {
    case "github":
      if (source.owner && source.repo) {
        return await fetchFromGitHub(source.owner, source.repo, branch);
      }
      break;
      
    case "codeberg":
      if (source.owner && source.repo) {
        return await fetchFromCodeberg(source.owner, source.repo, branch);
      }
      break;
      
    case "gitlab":
      if (source.owner && source.repo) {
        return await fetchFromGitLab(source.owner, source.repo, branch);
      }
      break;
      
    case "nostr-git":
      if (source.npub && source.repo) {
        return await fetchFromNostrGit(source.npub, source.repo, branch, source.url, eventPublisherPubkey);
      }
      break;
      
    case "unknown":
      // Skip unknown source types - don't attempt to fetch
      console.warn(`⚠️ [Git Source] Skipping unknown source type: ${source.url}`);
      return null;
  }
  
  return null;
}

/**
 * Fetch files from multiple git sources (NIP-34 clone tags)
 * Returns the first successful fetch, with status for all sources
 * @param eventPublisherPubkey - Optional: event publisher's pubkey (for bridge API when sources are nostr-git)
 */
export async function fetchFilesFromMultipleSources(
  cloneUrls: string[],
  branch: string = "main",
  onStatusUpdate?: (status: FetchStatus) => void,
  eventPublisherPubkey?: string
): Promise<{
  files: Array<{ type: string; path: string; size?: number }> | null;
  statuses: FetchStatus[];
}> {
  const sources = cloneUrls.map(parseGitSource);
  
  // CRITICAL: Filter out unknown source types to prevent unnecessary attempts
  // Prioritize known-good sources: GitHub, Codeberg, GitLab first, then nostr-git
  const prioritizedSources = sources.filter(s => s.type !== "unknown");
  const unknownSources = sources.filter(s => s.type === "unknown");
  
  // Log unknown sources but don't attempt to fetch them
  if (unknownSources.length > 0) {
    console.log(`⏭️ [Git Source] Skipping ${unknownSources.length} unknown source types:`, unknownSources.map(s => s.url).join(", "));
  }
  
  // Sort sources by priority: github/codeberg/gitlab first, then nostr-git
  const sortedSources = prioritizedSources.sort((a, b) => {
    const priority: Record<Exclude<GitSourceType, "unknown">, number> = { github: 1, codeberg: 2, gitlab: 3, "nostr-git": 4 };
    // Since we filtered out unknown sources, we know a.type and b.type are not "unknown"
    const aPriority = priority[a.type as Exclude<GitSourceType, "unknown">] || 99;
    const bPriority = priority[b.type as Exclude<GitSourceType, "unknown">] || 99;
    return aPriority - bPriority;
  });
  
  const statuses: FetchStatus[] = sortedSources.map(source => ({
    source,
    status: "pending",
  }));
  
  // Update initial status
  statuses.forEach(status => {
    if (onStatusUpdate) onStatusUpdate(status);
  });
  
  // CRITICAL: Limit parallel fetches to prevent overwhelming the network
  // Try known-good sources (GitHub, Codeberg, GitLab) first, then nostr-git sources
  // Limit to 5 parallel fetches at a time to prevent slowdown
  const MAX_PARALLEL_FETCHES = 5;
  console.log(`🚀 [Git Source] Starting parallel fetch from ${sortedSources.length} sources (max ${MAX_PARALLEL_FETCHES} parallel):`, sortedSources.map(s => s.displayName).join(", "));
  
  // Track if we've already found files (to update UI immediately)
  let firstSuccessFiles: Array<{ type: string; path: string; size?: number }> | null = null;
  
  // CRITICAL: Process sources in batches to limit parallel fetches
  // First batch: known-good sources (GitHub, Codeberg, GitLab) - try all in parallel
  // Second batch: nostr-git sources - only try ONE since they all hit the same bridge API
  const knownGoodSources = sortedSources.filter(s => s.type === "github" || s.type === "codeberg" || s.type === "gitlab");
  const nostrGitSources = sortedSources.filter(s => s.type === "nostr-git");
  
  // CRITICAL: For nostr-git sources, only try the first one since they all hit the same bridge API
  // All nostr-git sources for the same repo resolve to the same ownerPubkey+repo+branch
  // So trying multiple is redundant - they'll all make the same API call (which is now cached)
  const uniqueNostrGitSource = nostrGitSources.length > 0 ? [nostrGitSources[0]] : [];
  
  // Process known-good sources first (all in parallel)
  const knownGoodPromises = knownGoodSources.map(async (source, index) => {
    const statusIndex = sortedSources.indexOf(source);
    const status = statuses[statusIndex];
    if (!status) {
      console.error(`❌ [Git Source] No status found for index ${statusIndex}`);
      return { source, files: undefined, success: false };
    }
    
    status.status = "fetching";
    if (onStatusUpdate) onStatusUpdate(status);
    
    try {
      console.log(`🔍 [Git Source] Starting fetch from ${source.displayName} (${source.type}):`, {
        url: source.url,
        owner: source.owner,
        repo: source.repo,
        branch,
      });
      const files = await fetchFilesFromSource(source, branch, eventPublisherPubkey);
      
      if (files && files.length > 0) {
        status.status = "success";
        status.files = files;
        status.fetchedAt = Date.now();
        console.log(`✅ [Git Source] Successfully fetched ${files.length} files from ${source.displayName}`);
        
        if (!firstSuccessFiles) {
          firstSuccessFiles = files;
        }
        if (onStatusUpdate) onStatusUpdate(status);
        return { source, files, success: true };
      } else {
        status.status = "failed";
        status.error = "No files returned";
        console.log(`⚠️ [Git Source] No files returned from ${source.displayName}`);
        if (onStatusUpdate) onStatusUpdate(status);
        return { source, files: undefined, success: false };
      }
    } catch (error: any) {
      status.status = "failed";
      const errorMessage = error.message || "Fetch failed";
      if (errorMessage.includes("fetch failed") || 
          errorMessage.includes("ECONNREFUSED") || 
          errorMessage.includes("ETIMEDOUT") || 
          errorMessage.includes("ENOTFOUND") ||
          errorMessage.includes("Network error") ||
          errorMessage.includes("Unable to connect")) {
        status.error = "Server unavailable";
      } else if (errorMessage.includes("rate limit")) {
        status.error = "Rate limit exceeded";
      } else if (errorMessage.includes("404") || errorMessage.includes("not found")) {
        status.error = "Repository not found";
      } else if (errorMessage.includes("403") || errorMessage.includes("Forbidden")) {
        status.error = "Access forbidden";
      } else {
        status.error = errorMessage.length > 50 ? errorMessage.substring(0, 50) + "..." : errorMessage;
      }
      console.error(`❌ [Git Source] Fetch failed from ${source.displayName}:`, error);
      if (onStatusUpdate) onStatusUpdate(status);
      return { source, files: undefined, success: false };
    }
  });
  
  // Process nostr-git sources in batches (limit parallel fetches)
  const processNostrGitBatch = async (batch: typeof sortedSources) => {
    const batchPromises = batch.map(async (source, index) => {
      const statusIndex = sortedSources.indexOf(source);
      const status = statuses[statusIndex];
      if (!status) {
        console.error(`❌ [Git Source] No status found for index ${statusIndex}`);
        return { source, files: undefined, success: false };
      }
      
      status.status = "fetching";
      if (onStatusUpdate) onStatusUpdate(status);
      
      try {
        console.log(`🔍 [Git Source] Starting fetch from ${source.displayName} (${source.type}):`, {
          url: source.url,
          owner: source.owner,
          repo: source.repo,
          branch,
        });
        const files = await fetchFilesFromSource(source, branch, eventPublisherPubkey);
        
        if (files && files.length > 0) {
          status.status = "success";
          status.files = files;
          status.fetchedAt = Date.now();
          console.log(`✅ [Git Source] Successfully fetched ${files.length} files from ${source.displayName}`);
          
          if (!firstSuccessFiles) {
            firstSuccessFiles = files;
          }
          if (onStatusUpdate) onStatusUpdate(status);
          return { source, files, success: true };
        } else {
          status.status = "failed";
          status.error = "No files returned";
          console.log(`⚠️ [Git Source] No files returned from ${source.displayName}`);
          if (onStatusUpdate) onStatusUpdate(status);
          return { source, files: undefined, success: false };
        }
      } catch (error: any) {
        status.status = "failed";
        const errorMessage = error.message || "Fetch failed";
        if (errorMessage.includes("fetch failed") || 
            errorMessage.includes("ECONNREFUSED") || 
            errorMessage.includes("ETIMEDOUT") || 
            errorMessage.includes("ENOTFOUND") ||
            errorMessage.includes("Network error") ||
            errorMessage.includes("Unable to connect")) {
          status.error = "Server unavailable";
        } else if (errorMessage.includes("rate limit")) {
          status.error = "Rate limit exceeded";
        } else if (errorMessage.includes("404") || errorMessage.includes("not found")) {
          status.error = "Repository not found";
        } else if (errorMessage.includes("403") || errorMessage.includes("Forbidden")) {
          status.error = "Access forbidden";
        } else {
          status.error = errorMessage.length > 50 ? errorMessage.substring(0, 50) + "..." : errorMessage;
        }
        console.error(`❌ [Git Source] Fetch failed from ${source.displayName}:`, error);
        if (onStatusUpdate) onStatusUpdate(status);
        return { source, files: undefined, success: false };
      }
    });
    
    return await Promise.allSettled(batchPromises);
  };
  
  // Start with known-good sources (all in parallel)
  const knownGoodResults = await Promise.allSettled(knownGoodPromises);
  
  // Check if any known-good source succeeded
  for (const result of knownGoodResults) {
    if (result.status === "fulfilled" && result.value.success && result.value.files) {
      // Found files from known-good source - return immediately
      return { files: result.value.files, statuses };
    }
  }
  
  // If no known-good source succeeded, try nostr-git source (only one needed - they share bridge API)
  if (uniqueNostrGitSource.length > 0) {
    const batch = uniqueNostrGitSource.filter((s): s is GitSource => s !== undefined);
    const batchResults = await processNostrGitBatch(batch);
    
    // Check if any source in this batch succeeded
    for (const result of batchResults) {
      if (result.status === "fulfilled" && result.value.success && result.value.files) {
        // Found files - mark all other nostr-git sources as success (they share the same bridge)
        nostrGitSources.slice(1).forEach(source => {
          const statusIndex = sortedSources.indexOf(source);
          if (statusIndex >= 0 && statuses[statusIndex]) {
            statuses[statusIndex].status = "success";
            statuses[statusIndex].files = result.value.files;
            if (onStatusUpdate) onStatusUpdate(statuses[statusIndex]);
          }
        });
        // Return immediately
        return { files: result.value.files, statuses };
      }
    }
  }
  
  // Return results: use firstSuccessFiles if found, otherwise return null
  return { 
    files: firstSuccessFiles, 
    statuses 
  };
}

