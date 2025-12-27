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
    // CRITICAL: Convert nostr:// URLs to https:// for GRASP servers
    // Format: nostr://npub@domain/repo or nostr://npub/repo (without domain)
    // These are GRASP server URLs that need to be converted to HTTPS
    // Import GRASP server detection first (needed for domain resolution)
    const { KNOWN_GRASP_DOMAINS } = require("@/lib/utils/grasp-servers");
    
    // Parse nostr:// URL: nostr://npub@domain/repo or nostr://npub/repo
    const nostrMatch = cloneUrl.match(/^nostr:\/\/([^\/@]+)(?:@([^\/]+))?\/(.+)$/);
    if (nostrMatch) {
      const [, npub, domain, repo] = nostrMatch;
      if (npub && repo) {
        // If domain is provided, use it; otherwise use first known GRASP server
        const targetDomain = domain || (KNOWN_GRASP_DOMAINS.length > 0 ? KNOWN_GRASP_DOMAINS[0] : "git.gittr.space");
        normalizedUrl = `https://${targetDomain}/${npub}/${repo}`;
        originalProtocol = "nostr";
        console.log(`🔄 [Git Source] Converting nostr:// URL to HTTPS for GRASP server: ${normalizedUrl}`);
      }
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
      } else {
        // Log the actual error from GitHub API
        const errorText = await repoInfoResponse.text().catch(() => "");
        let errorData: any = {};
        try {
          errorData = JSON.parse(errorText);
        } catch {
          // Not JSON
        }
        
        // SECURITY: If 404 or 403, this could be a private repo
        // We should NOT use a platform token with 'repo' scope as it can access ANY user's private repos
        // Instead, gracefully fail and let the bridge be the source of truth
        if (repoInfoResponse.status === 404 || repoInfoResponse.status === 403) {
          console.warn(`⚠️ [Git Source] Repository ${owner}/${repo} is private or not found. Skipping GitHub fallback for security reasons.`);
          console.warn(`⚠️ [Git Source] Private repos should be accessed via the bridge (files should be pushed during import).`);
          console.warn(`⚠️ [Git Source] If bridge is empty, check bridge logs or re-push the repo to Nostr.`);
          return null; // Gracefully fail - don't try to access private repos with platform token
        }
        
        console.error(`❌ [Git Source] GitHub repo info failed (${repoInfoResponse.status}):`, {
          owner,
          repo,
          endpoint: repoInfoEndpoint,
          error: errorData.message || errorText.substring(0, 200),
          fullError: errorData
        });
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
        // CRITICAL: GitLab API pagination - fetch ALL pages, not just first 100 items
        // GitLab returns max 100 items per page, need to follow pagination
        let allItems: any[] = [];
        let page = 1;
        const perPage = 100; // GitLab max per page
        let hasMore = true;
        
        while (hasMore) {
          const treeUrl = `https://gitlab.com/api/v4/projects/${projectPath}/repository/tree?ref=${encodeURIComponent(branchToTry)}&recursive=true&per_page=${perPage}&page=${page}`;
        
        const response = await fetch(treeUrl, {
          headers: {
            "User-Agent": "gittr-space",
            "Accept": "application/json"
          } as any
        });
        
        if (response.ok) {
          const data: any = await response.json();
            if (Array.isArray(data)) {
              if (data.length > 0) {
                allItems = [...allItems, ...data];
                console.log(`✅ [Git Source] Got GitLab page ${page} for branch ${branchToTry}: ${data.length} items (total: ${allItems.length})`);
                
                // Check if there are more pages
                const totalPages = parseInt(response.headers.get("X-Total-Pages") || "1", 10);
                const currentPage = parseInt(response.headers.get("X-Page") || "1", 10);
                hasMore = currentPage < totalPages;
                page++;
              } else {
                hasMore = false; // No more items
              }
            } else {
              hasMore = false; // Invalid response
            }
          } else if (response.status === 404) {
            console.warn(`⚠️ [Git Source] GitLab branch ${branchToTry} not found (${response.status}), trying next...`);
            break; // Try next branch
          } else {
            console.warn(`⚠️ [Git Source] GitLab API error for branch ${branchToTry} (${response.status}), trying next...`);
            break; // Try next branch
          }
        }
        
        if (allItems.length > 0) {
          console.log(`✅ [Git Source] Got GitLab files for branch ${branchToTry}: ${allItems.length} total items`);
          const files = allItems
              .filter((n: any) => n.type === "blob")
              .map((n: any) => ({ type: "file", path: n.path, size: n.size }));
          const dirs = allItems
              .filter((n: any) => n.type === "tree")
              .map((n: any) => ({ type: "dir", path: n.path }));
            
            return [...dirs, ...files];
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
      const bridgeUrl = `/api/nostr/repo/files?ownerPubkey=${encodeURIComponent(ownerPubkey)}&repo=${encodeURIComponent(repo)}&branch=${encodeURIComponent(branch)}`;
      console.log(`🔍 [Git Source] Trying git-nostr-bridge API:`, {
        npub: npub.slice(0, 16) + "...",
        ownerPubkey: ownerPubkey.slice(0, 16) + "...",
        repo,
        branch,
        url: bridgeUrl,
      });
      const response = await fetch(bridgeUrl);
      
      if (response.ok) {
        const data = await response.json();
        if (data.files && Array.isArray(data.files) && data.files.length > 0) {
          console.log(`✅ [Git Source] Fetched ${data.files.length} files from git-nostr-bridge`);
          return data.files;
        } else {
          console.log(`⚠️ [Git Source] git-nostr-bridge API returned OK but no files:`, data);
          // CRITICAL: When bridge returns 200 with empty files, treat it as a failure
          // This allows the multi-source fetch to try other sources (GitHub, etc.)
          // The repo might be empty, on wrong branch, or needs to be re-cloned
          // Return null so other sources can be tried
          return null;
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
                const pollForFiles = async (maxAttempts = 10, delay = 2000) => {
                  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                    console.log(`🔍 [Git Source] Polling for files (attempt ${attempt}/${maxAttempts})...`);
                    
                    try {
                      const pollResponse = await fetch(bridgeUrl);
                      if (pollResponse.ok) {
                        const pollData = await pollResponse.json();
                        if (pollData.files && Array.isArray(pollData.files) && pollData.files.length > 0) {
                          console.log(`✅ [Git Source] Files available after clone! Fetched ${pollData.files.length} files`);
                          // Trigger a custom event to notify the page that files are ready
                          // The page can listen to this event and update the UI
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
                  return null;
                };
                
                // Start polling in background (don't await - non-blocking)
                pollForFiles().catch(err => console.warn('Polling error:', err));
                
                // Return null immediately to allow page to render
                console.log(`💡 [Git Source] Clone initiated - polling for files in background. Page will render immediately.`);
                return null;
              } else {
                const cloneError = await cloneResponse.json().catch(() => ({ error: "Unknown error" }));
                console.log(`⚠️ [Git Source] Clone API failed: ${cloneResponse.status} -`, cloneError);
              }
            } catch (cloneError: any) {
              console.warn(`⚠️ [Git Source] Failed to trigger clone:`, cloneError.message);
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
      console.warn(`⚠️ [Git Source] Unknown source type for: ${source.url}`);
      break;
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
  const statuses: FetchStatus[] = sources.map(source => ({
    source,
    status: "pending",
  }));
  
  // Update initial status
  statuses.forEach(status => {
    if (onStatusUpdate) onStatusUpdate(status);
  });
  
  // CRITICAL: Try ALL sources in parallel using Promise.allSettled
  // This ensures we try every source simultaneously, not sequentially
  console.log(`🚀 [Git Source] Starting parallel fetch from ${sources.length} sources:`, sources.map(s => s.displayName).join(", "));
  
  // Track if we've already found files (to update UI immediately)
  let firstSuccessFiles: Array<{ type: string; path: string; size?: number }> | null = null;
  
  const fetchPromises = sources.map(async (source, index) => {
    const status = statuses[index];
    if (!status) {
      console.error(`❌ [Git Source] No status found for index ${index}`);
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
        
        // CRITICAL: Update UI immediately when first source succeeds (don't wait for all)
        if (!firstSuccessFiles) {
          firstSuccessFiles = files;
          console.log(`🚀 [Git Source] First success! Using files from ${source.displayName} immediately (${files.length} files)`);
        }
        // CRITICAL: Always call onStatusUpdate for successful fetches, not just the first one
        // This ensures the UI is updated immediately when any source succeeds
        if (onStatusUpdate) {
          console.log(`📢 [Git Source] Calling onStatusUpdate for success: ${source.displayName} (${files.length} files)`);
          onStatusUpdate(status);
        }
      } else {
        status.status = "failed";
        // More specific error: files were checked but not found (server responded, but no files)
        // This means THIS source didn't return files, but files may exist from other sources
        status.error = "No files from this source";
        console.warn(`⚠️ [Git Source] No files returned from ${source.displayName}`);
      }
    } catch (error: any) {
      status.status = "failed";
      // Distinguish between network errors and other errors
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
    }
    
    if (onStatusUpdate) onStatusUpdate(status);
    return { source, files: status.files, success: status.status === "success" };
  });
  
  // CRITICAL: Use Promise.race to return as soon as first source succeeds (don't wait for all)
  // Continue updating statuses in the background, but don't block the UI
  const timeoutPromise = new Promise<{ files: null; statuses: FetchStatus[] }>((resolve) => {
    setTimeout(() => {
      console.log(`⏱️ [Git Source] Timeout waiting for first success, returning current statuses`);
      resolve({ files: null, statuses });
    }, 10000); // 10 second timeout
  });
  
  // Wrap each fetch promise to resolve immediately on first success
  // This allows Promise.race to return as soon as ANY promise succeeds
  // We create a promise that never resolves for failures, so Promise.race only resolves on success
  const successPromises = fetchPromises.map(async (p) => {
    try {
      const result = await p;
      if (result.success && result.files && Array.isArray(result.files) && result.files.length > 0) {
        // This is a success - resolve immediately with files
        console.log(`✅ [Git Source] Promise resolved with success: ${result.files.length} files from ${result.source.displayName}`);
        return { files: result.files, statuses, success: true };
      }
      // Not a success - wait forever (this promise will never resolve, so Promise.race will skip it)
      await new Promise(() => {}); // Never resolves
      return null; // Unreachable
    } catch (error) {
      // Error - wait forever (this promise will never resolve)
      await new Promise(() => {}); // Never resolves
      return null; // Unreachable
    }
  });
  
  // Race all promises - the first one that succeeds will resolve immediately
  // Promises that fail will never resolve, so they won't affect the race
  const firstSuccessPromise = Promise.race(successPromises).then((result) => {
    if (result && result.success && result.files) {
      console.log(`✅ [Git Source] First success found via Promise.race: ${result.files.length} files`);
      
      // CRITICAL: Ensure onStatusUpdate is called for the first success so UI updates immediately
      // Find the status for the successful source and call onStatusUpdate
      const successfulStatus = statuses.find(s => s.status === "success" && s.files && s.files.length > 0);
      if (successfulStatus && onStatusUpdate) {
        console.log(`🚀 [Git Source] Calling onStatusUpdate for first success: ${successfulStatus.source.displayName}`);
        onStatusUpdate(successfulStatus);
      }
      
      // Continue updating statuses in background (don't await - let it run in background)
      Promise.allSettled(fetchPromises).then((allResults) => {
        allResults.forEach((allResult, idx) => {
          const status = statuses[idx];
          if (!status) return;
          
          // CRITICAL: Don't overwrite success status - if a source already succeeded, preserve it
          const wasSuccess = status.status === "success";
          if (wasSuccess) {
            // Already succeeded, don't overwrite
            return;
          }
          
          if (allResult.status === "fulfilled") {
            const value = allResult.value;
            if (value.success && value.files) {
              status.status = "success";
              status.files = value.files;
              status.fetchedAt = Date.now();
            } else {
              // Only set to failed if not already failed (preserve any existing status)
              if (status.status !== "failed") {
                status.status = "failed";
                status.error = "No files found";
              }
            }
          } else if (allResult.status === "rejected") {
            // Only set to failed if not already success or failed (preserve success status)
            // Check wasSuccess variable instead of status.status to avoid TypeScript narrowing issues
            if (!wasSuccess && status.status !== "failed") {
              status.status = "failed";
              status.error = allResult.reason?.message || "Unknown error";
            }
          }
          
          if (onStatusUpdate) onStatusUpdate(status);
        });
        
        console.log(`📊 [Git Source] All fetches completed. Final statuses:`, statuses.map(s => `${s.source.displayName}: ${s.status}`).join(", "));
      }).catch((error) => {
        console.error(`❌ [Git Source] Error processing background status updates:`, error);
      });
      
      return result;
    }
    return null;
  });
  
  // Race between first success and timeout - return immediately when first succeeds
  const raceResult = await Promise.race([firstSuccessPromise, timeoutPromise]);
  if (raceResult && raceResult.files && Array.isArray(raceResult.files) && raceResult.files.length > 0) {
    return raceResult;
  }
  
  // Fallback: wait for all if no success yet
  const results = await Promise.allSettled(fetchPromises);
  
  // Process results and find first successful fetch
  let files: Array<{ type: string; path: string; size?: number }> | null = null;
  
  results.forEach((result, index) => {
    const status = statuses[index];
    if (!status) return;
    
    // CRITICAL: Don't overwrite success status - if a source already succeeded, preserve it
    const wasSuccess = status.status === "success";
    if (wasSuccess) {
      // Already succeeded, skip processing
      if (result.status === "fulfilled") {
        const value = result.value;
        if (value.success && value.files && !files) {
          files = value.files;
          console.log(`✅ [Git Source] Using files from ${value.source.displayName} (${files.length} files)`);
        }
      }
      return; // Don't update status, already success
    }
    
    if (result.status === "fulfilled") {
      const value = result.value;
      if (value.success && value.files) {
        if (!files) {
          files = value.files;
          console.log(`✅ [Git Source] Using files from ${value.source.displayName} (${files.length} files)`);
        }
        status.status = "success";
        status.files = value.files;
        status.fetchedAt = Date.now();
      } else {
        // Only set to failed if not already failed (preserve any existing status)
        if (status.status !== "failed") {
          status.status = "failed";
          status.error = "No files found";
        }
      }
    } else if (result.status === "rejected") {
      // Only set to failed if not already success or failed (preserve success status)
      // Check wasSuccess variable instead of status.status to avoid TypeScript narrowing issues
      if (!wasSuccess && status.status !== "failed") {
        status.status = "failed";
        status.error = result.reason?.message || "Unknown error";
        console.error(`❌ [Git Source] Fetch rejected for ${status.source.displayName}:`, result.reason);
      }
    }
    
    if (onStatusUpdate) onStatusUpdate(status);
  });
  
  console.log(`📊 [Git Source] All fetches completed. Final statuses:`, statuses.map(s => `${s.source.displayName}: ${s.status}`).join(", "));
  
  return { files, statuses };
}

