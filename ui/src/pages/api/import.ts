import type { NextApiRequest, NextApiResponse } from "next";
import { validateGitHubUrl } from "@/lib/security/input-validation";
import { rateLimiters } from "@/app/api/middleware/rate-limit";
import { setCorsHeaders, handleOptionsRequest } from "@/lib/api/cors";

type Data = { 
  status: string; 
  message?: string; // Error messages
  slug?: string; 
  entity?: string;
  repo?: string;
  readme?: string; 
  files?: Array<{ type: string; path: string; size?: number; content?: string; isBinary?: boolean }>;
  description?: string;
  contributors?: Array<{ login: string; avatar_url: string; contributions: number }>;
  stars?: number;
  forks?: number;
  languages?: Record<string, number>; // language name -> bytes
  topics?: string[]; // repository topics/tags
  defaultBranch?: string;
  branches?: string[];
  tags?: Array<{ name: string }>; 
  releases?: Array<{ name: string; tag_name: string; body?: string; published_at?: string; html_url?: string; author?: { login: string; avatar_url?: string } }>;
  issues?: Array<{ number: number; title: string; body?: string; state: string; created_at?: string; updated_at?: string; html_url?: string; user?: { login: string; avatar_url?: string }; labels?: Array<{ name: string; color?: string }> }>;
  pulls?: Array<{ number: number; title: string; body?: string; state: string; created_at?: string; updated_at?: string; html_url?: string; user?: { login: string; avatar_url?: string }; labels?: Array<{ name: string; color?: string }>; merged_at?: string; head?: { ref: string }; base?: { ref: string } }>;
  commits?: Array<{ sha: string; message: string; author?: { name?: string; email?: string; date?: string }; committer?: { name?: string; email?: string; date?: string }; html_url?: string }>;
  homepage?: string; // GitHub Pages or website URL
  fileCount?: number;
  approximateSizeBytes?: number;
  isPrivate?: boolean; // GitHub repo privacy status
};

async function fetchGithubTree(owner: string, repo: string, branch: string, token?: string | null) {
  try {
    // Use token if provided (for private repos)
    const headers: Record<string, string> = { "User-Agent": "gittr" };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    
    // First, get the SHA of the branch
    const branchUrl = `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`;
    const branchResponse = await fetch(branchUrl, { headers: headers as any });
    
    let sha = branch;
    if (branchResponse.ok) {
      const branchData: any = await branchResponse.json();
      if (branchData.object && branchData.object.sha) {
        sha = branchData.object.sha;
      }
    }
    
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`;
  const r = await fetch(url, { headers: headers as any });
    
    if (!r.ok) {
      const errorText = await r.text();
      console.error(`❌ [Import API] Failed to fetch tree: ${r.status} - ${errorText.substring(0, 200)}`);
      return null;
    }
    
  const d: any = await r.json();
    if (!d.tree || !Array.isArray(d.tree)) {
      console.error(`❌ [Import API] Tree response invalid:`, { hasTree: !!d.tree, treeIsArray: Array.isArray(d.tree) });
      return null;
    }
    
  const files = d.tree
    .filter((n: any) => n.type === "blob")
    .map((n: any) => ({ type: "file", path: n.path as string, size: n.size as number }));
  const dirs = d.tree.filter((n: any) => n.type === "tree").map((n: any) => ({ type: "dir", path: n.path as string }));
    
    // Also create directory entries for all parent paths of files
    // GitHub's tree API might not return all intermediate directories explicitly
    const allDirs = new Set<string>(dirs.map((d: { path: string }) => d.path));
    
    // Add all parent directories for each file
    for (const file of files) {
      const parts = file.path.split("/");
      for (let i = 1; i < parts.length; i++) {
        const dirPath = parts.slice(0, i).join("/");
        if (dirPath && !allDirs.has(dirPath)) {
          allDirs.add(dirPath);
        }
      }
    }
    
    // Convert Set back to array of directory entries
    const allDirEntries = Array.from(allDirs).map(path => ({ type: "dir" as const, path }));
    
    
    return { files: [...allDirEntries, ...files] };
  } catch (error: any) {
    console.error(`❌ [Import API] Error fetching tree for ${owner}/${repo}@${branch}:`, error.message);
    return null;
  }
}

/**
 * Fetch file content from GitHub
 * Returns object with content (string for text, base64 for binary) and isBinary flag
 */
async function fetchFileContent(owner: string, repo: string, branch: string, path: string, userToken?: string | null): Promise<{ content: string; isBinary: boolean } | null> {
  try {
    // Use user token if provided (for private repos), otherwise fallback to platform token
    const tokenToUse = userToken || process.env.GITHUB_PLATFORM_TOKEN || null;
    const headers: Record<string, string> = {
      "User-Agent": "gittr-space",
      "Accept": "application/vnd.github.v3+json"
    };
    if (tokenToUse) {
      headers["Authorization"] = `Bearer ${tokenToUse}`;
    }
    
    // Use GitHub Contents API which returns base64 encoded content
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
    const response = await fetch(url, { headers: headers as any });
    
    if (!response.ok) {
      // Try raw URL as fallback
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${encodeURIComponent(path)}`;
      const rawResponse = await fetch(rawUrl, { headers: { "User-Agent": "gittr" } as any });
      if (rawResponse.ok) {
        const contentType = rawResponse.headers.get("content-type") || "";
        const ext = path.split('.').pop()?.toLowerCase() || '';
        // HTML, CSS, JS, and text files should NEVER be treated as binary
        const textExts = ['html', 'htm', 'xhtml', 'css', 'js', 'jsx', 'ts', 'tsx', 'json', 'xml', 'txt', 'md', 'markdown', 'yml', 'yaml', 'toml', 'ini', 'conf', 'config', 'log', 'csv', 'tsv'];
        const binaryExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'pdf', 'zip', 'tar', 'gz', 'exe', 'dll', 'so', 'dylib', 'woff', 'woff2', 'ttf', 'otf', 'eot'];
        // HTML and text files are NEVER binary
        const isBinary = !textExts.includes(ext) && (
          binaryExts.includes(ext) || 
          (!contentType.startsWith("text/") && 
           !contentType.includes("json") && 
           !contentType.includes("xml") &&
           !contentType.includes("javascript") &&
           !contentType.includes("css") &&
           !contentType.includes("html") &&
           !contentType.includes("markdown") &&
           !contentType.includes("plain"))
        );
        
        if (isBinary) {
          // Fetch as array buffer and convert to base64
          const arrayBuffer = await rawResponse.arrayBuffer();
          const base64 = Buffer.from(arrayBuffer).toString('base64');
          return { content: base64, isBinary: true };
        } else {
          // Text file
          const text = await rawResponse.text();
          return { content: text, isBinary: false };
        }
      }
      return null;
    }
    
    const data: any = await response.json();
    
    if (!data.content || data.encoding !== "base64") {
      return null;
    }
    
    // Check if file is binary by extension or size
    // HTML, CSS, JS, and text files should NEVER be treated as binary
    const ext = path.split('.').pop()?.toLowerCase() || '';
    const textExts = ['html', 'htm', 'xhtml', 'css', 'js', 'jsx', 'ts', 'tsx', 'json', 'xml', 'txt', 'md', 'markdown', 'yml', 'yaml', 'toml', 'ini', 'conf', 'config', 'log', 'csv', 'tsv'];
    const binaryExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'pdf', 'zip', 'tar', 'gz', 'exe', 'dll', 'so', 'dylib', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp4', 'mp3', 'wav', 'avi', 'mov'];
    // HTML and text files are NEVER binary, even if large
    const isBinary = !textExts.includes(ext) && (binaryExts.includes(ext) || (data.size && data.size > 100 * 1024)); // Files > 100KB are likely binary (unless they're text files)
    
    if (isBinary) {
      // Keep as base64 for binary files
      return { content: data.content, isBinary: true };
    } else {
      // Decode base64 to text for text files
      try {
        const decoded = Buffer.from(data.content, 'base64').toString('utf-8');
        // Check if decoded content is valid UTF-8 text (not binary)
        if (/[\x00-\x08\x0E-\x1F]/.test(decoded)) {
          // Contains control characters, likely binary - keep as base64
          return { content: data.content, isBinary: true };
        }
        return { content: decoded, isBinary: false };
      } catch {
        // Decoding failed, keep as base64
        return { content: data.content, isBinary: true };
      }
    }
  } catch (error) {
    console.error(`Error fetching file content for ${path}:`, error);
    return null;
  }
}

// Increase timeout for large imports (5 minutes)
export const maxDuration = 300;

export default async function handler(req: NextApiRequest, res: NextApiResponse<Data>) {
  // Handle OPTIONS request for CORS (GRASP requirement)
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res);
    return;
  }

  // Set CORS headers (GRASP requirement)
  setCorsHeaders(res);

  // Rate limiting
  const rateLimitResult = await rateLimiters.api(req as any);
  if (rateLimitResult) {
    return res.status(429).json(JSON.parse(await rateLimitResult.text()));
  }

  if (req.method !== "POST") return res.status(405).json({ status: "method_not_allowed" });
  let { sourceUrl, githubToken } = req.body || {};
  
  // CRITICAL: Normalize SSH URLs (git@host:path) to HTTPS format before validation
  if (sourceUrl && typeof sourceUrl === "string") {
    const sshMatch = sourceUrl.match(/^git@([^:]+):(.+)$/);
    if (sshMatch) {
      const [, host, path] = sshMatch;
      sourceUrl = `https://${host}/${path}`;
      console.log(`🔄 [Import API] Normalized SSH URL to HTTPS: ${sourceUrl}`);
    }
  }
  
  // Validate GitHub URL
  if (!sourceUrl || typeof sourceUrl !== "string") {
    return res.status(400).json({ status: "invalid_url", message: "Source URL is required" });
  }
  
  const urlValidation = validateGitHubUrl(sourceUrl);
  if (!urlValidation.valid) {
    return res.status(400).json({ status: "invalid_url", message: urlValidation.error || "Invalid GitHub URL" });
  }
  
  try {
    const u = new URL(sourceUrl);
    if (u.host !== "github.com") return res.status(400).json({ status: "only_github_supported_now" });
    const parts = u.pathname.split("/").filter(Boolean);
    const owner = parts[0];
    const repo = (parts[1] || "repo").replace(/\.git$/, "");
    
    // Validate owner exists (should be guaranteed by validateGitHubUrl, but TypeScript needs this)
    if (!owner) {
      return res.status(400).json({ status: "invalid_url", message: "Invalid GitHub URL: owner not found" });
    }
    
    const slug = repo;
    const entity = owner;
    
    // Use user-provided GitHub token if available (for private repos), otherwise fallback to platform token
    // User tokens are passed from frontend (from localStorage after OAuth)
    const userToken = (githubToken && typeof githubToken === "string") ? githubToken : null;
    const platformToken = process.env.GITHUB_PLATFORM_TOKEN || null;
    const tokenToUse = userToken || platformToken;
    
    const headers: Record<string, string> = {
      "User-Agent": "gittr-space",
      "Accept": "application/vnd.github.v3+json"
    };
    if (tokenToUse) {
      headers["Authorization"] = `Bearer ${tokenToUse}`;
      console.log(`🔑 [Import API] Using ${userToken ? 'user' : 'platform'} GitHub token for ${owner}/${repo}`);
    }
    
    // Fetch repo metadata
    const repoUrl = `https://api.github.com/repos/${owner}/${repo}`;
    const repoResponse = await fetch(repoUrl, { headers: headers as any });
    let description = "";
    let stars = 0;
    let forks = 0;
    let topics: string[] = [];
    let defaultBranch = "main";
    let homepage: string | undefined = undefined; // GitHub Pages or website URL
    let isPrivate = false; // Track if GitHub repo is private
    if (repoResponse.ok) {
      const repoData: any = await repoResponse.json();
      description = repoData.description || "";
      stars = repoData.stargazers_count || 0;
      forks = repoData.forks_count || 0;
      topics = repoData.topics || [];
      defaultBranch = repoData.default_branch || defaultBranch;
      isPrivate = repoData.private === true; // Preserve GitHub privacy status
      // Get homepage/website URL (GitHub Pages link)
      if (repoData.homepage && typeof repoData.homepage === "string" && repoData.homepage.trim().length > 0) {
        const rawHomepage = repoData.homepage.trim();
        // Ensure it has http:// or https://
        homepage = (!rawHomepage.startsWith("http://") && !rawHomepage.startsWith("https://")) 
          ? `https://${rawHomepage}` 
          : rawHomepage;
      }
    }

    // Fetch languages
    const languagesUrl = `https://api.github.com/repos/${owner}/${repo}/languages`;
    const languagesResponse = await fetch(languagesUrl, { headers: headers as any });
    let languages: Record<string, number> = {};
    if (languagesResponse.ok) {
      languages = await languagesResponse.json();
    }

    // Fetch contributors
    const contributorsUrl = `https://api.github.com/repos/${owner}/${repo}/contributors`;
    const contributorsResponse = await fetch(contributorsUrl, { headers: { "User-Agent": "gittr" } as any });
    let contributors: Array<{ login: string; avatar_url: string; contributions: number }> = [];
    if (contributorsResponse.ok) {
      contributors = await contributorsResponse.json();
    }

    // Fetch branches
    const branchesUrl = `https://api.github.com/repos/${owner}/${repo}/branches`;
    const branchesResponse = await fetch(branchesUrl, { headers: { "User-Agent": "gittr" } as any });
    let branches: string[] = [];
    if (branchesResponse.ok) {
      const list: any[] = await branchesResponse.json();
      branches = list.map((b: any) => b.name).slice(0, 100);
    }

    // Fetch tags
    const tagsUrl = `https://api.github.com/repos/${owner}/${repo}/tags`;
    const tagsResponse = await fetch(tagsUrl, { headers: { "User-Agent": "gittr" } as any });
    let tags: Array<{ name: string }> = [];
    if (tagsResponse.ok) {
      const list: any[] = await tagsResponse.json();
      tags = list.map((t: any) => ({ name: t.name })).slice(0, 100);
    }

    // Fetch releases
    const releasesUrl = `https://api.github.com/repos/${owner}/${repo}/releases`;
    const releasesResponse = await fetch(releasesUrl, { headers: headers as any });
    let releases: Array<{ name: string; tag_name: string; body?: string; published_at?: string; html_url?: string; author?: { login: string; avatar_url?: string } }> = [];
    if (releasesResponse.ok) {
      const list: any[] = await releasesResponse.json();
      releases = list.map((r: any) => ({ name: r.name || r.tag_name, tag_name: r.tag_name, body: r.body, published_at: r.published_at, html_url: r.html_url, author: r.author ? { login: r.author.login, avatar_url: r.author.avatar_url } : undefined })).slice(0, 50);
    }

    // Fetch issues (open and closed, limit to 100 total)
    const issuesUrl = `https://api.github.com/repos/${owner}/${repo}/issues?state=all&per_page=100&sort=updated`;
    const issuesResponse = await fetch(issuesUrl, { headers: headers as any });
    let issues: Array<{ number: number; title: string; body?: string; state: string; created_at?: string; updated_at?: string; html_url?: string; user?: { login: string; avatar_url?: string }; labels?: Array<{ name: string; color?: string }> }> = [];
    if (issuesResponse.ok) {
      const list: any[] = await issuesResponse.json();
      // Filter out pull requests (they have pull_request field)
      issues = list
        .filter((item: any) => !item.pull_request)
        .map((item: any) => ({
          number: item.number,
          title: item.title,
          body: item.body,
          state: item.state,
          created_at: item.created_at,
          updated_at: item.updated_at,
          html_url: item.html_url,
          user: item.user ? { login: item.user.login, avatar_url: item.user.avatar_url } : undefined,
          labels: item.labels ? item.labels.map((l: any) => ({ name: l.name, color: l.color })) : undefined,
        }))
        .slice(0, 100);
    }

    // Fetch pull requests (open and closed, limit to 100 total)
    const pullsUrl = `https://api.github.com/repos/${owner}/${repo}/pulls?state=all&per_page=100&sort=updated`;
    const pullsResponse = await fetch(pullsUrl, { headers: headers as any });
    let pulls: Array<{ number: number; title: string; body?: string; state: string; created_at?: string; updated_at?: string; html_url?: string; user?: { login: string; avatar_url?: string }; labels?: Array<{ name: string; color?: string }>; merged_at?: string; head?: { ref: string }; base?: { ref: string } }> = [];
    if (pullsResponse.ok) {
      const list: any[] = await pullsResponse.json();
      pulls = list.map((pr: any) => ({
        number: pr.number,
        title: pr.title,
        body: pr.body,
        state: pr.state,
        created_at: pr.created_at,
        updated_at: pr.updated_at,
        html_url: pr.html_url,
        user: pr.user ? { login: pr.user.login, avatar_url: pr.user.avatar_url } : undefined,
        labels: pr.labels ? pr.labels.map((l: any) => ({ name: l.name, color: l.color })) : undefined,
        merged_at: pr.merged_at,
        head: pr.head ? { ref: pr.head.ref } : undefined,
        base: pr.base ? { ref: pr.base.ref } : undefined,
      })).slice(0, 100);
    }

    // Fetch commits (recent commits, limit to 100)
    const commitsUrl = `https://api.github.com/repos/${owner}/${repo}/commits?per_page=100`;
    const commitsResponse = await fetch(commitsUrl, { headers: headers as any });
    let commits: Array<{ sha: string; message: string; author?: { name?: string; email?: string; date?: string }; committer?: { name?: string; email?: string; date?: string }; html_url?: string }> = [];
    if (commitsResponse.ok) {
      const list: any[] = await commitsResponse.json();
      commits = list.map((c: any) => ({
        sha: c.sha,
        message: c.commit?.message || "",
        author: c.commit?.author ? { name: c.commit.author.name, email: c.commit.author.email, date: c.commit.author.date } : undefined,
        committer: c.commit?.committer ? { name: c.commit.committer.name, email: c.commit.committer.email, date: c.commit.committer.date } : undefined,
        html_url: c.html_url,
      })).slice(0, 100);
    }

    // try defaultBranch then main/master
    const branchToUse = defaultBranch || "main";
    let tree = await fetchGithubTree(owner, repo, branchToUse, tokenToUse);
    if (!tree) tree = await fetchGithubTree(owner, repo, "main", tokenToUse);
    if (!tree) tree = await fetchGithubTree(owner, repo, "master", tokenToUse);
    
    // Log if tree fetch failed
    if (!tree || !tree.files || tree.files.length === 0) {
      console.error(`❌ [Import API] Failed to fetch tree for ${owner}/${repo}`, {
        branchToUse,
        treeIsNull: !tree,
        treeFilesLength: tree?.files?.length || 0,
      });
    } else {
    }
    let readme = "";
    const rawMain = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branchToUse)}/README.md`;
    const rawMaster = `https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`;
    const baseUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branchToUse)}`;
    const baseUrlMaster = `https://raw.githubusercontent.com/${owner}/${repo}/main`;
    
    for (const [raw, base] of [[rawMain, baseUrl], [rawMaster, baseUrlMaster]] as const) {
      const rr = await fetch(raw, { headers: { "User-Agent": "gittr" } as any });
      if (rr.ok) { 
        readme = await rr.text();
        // Fix relative image URLs in README
        // Convert relative paths to absolute GitHub raw URLs
        readme = readme.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
          // If it's already an absolute URL, keep it
          if (src.startsWith('http://') || src.startsWith('https://')) {
            return match;
          }
          // If it's a relative path, convert to absolute GitHub raw URL
          let absoluteSrc = src;
          if (src.startsWith('/')) {
            // Root-relative path: /path/to/image.png
            absoluteSrc = `${base}${src}`;
          } else if (!src.startsWith('http://') && !src.startsWith('https://')) {
            // Relative path: ./image.png or ../image.png or image.png
            absoluteSrc = `${base}/${src.replace(/^\.\//, '')}`;
          }
          return `![${alt}](${absoluteSrc})`;
        });
        // Also fix HTML img tags
        readme = readme.replace(/<img([^>]*?)src="([^"]+)"/gi, (match, attrs, src) => {
          if (src.startsWith('http://') || src.startsWith('https://')) {
            return match;
          }
          let absoluteSrc = src;
          if (src.startsWith('/')) {
            absoluteSrc = `${base}${src}`;
          } else if (!src.startsWith('http://') && !src.startsWith('https://')) {
            absoluteSrc = `${base}/${src.replace(/^\.\//, '')}`;
          }
          return `<img${attrs}src="${absoluteSrc}"`;
        });
        break; 
      }
    }
    
    // Return file metadata only (no content) to avoid 4MB response limit
    // Frontend will fetch file content individually via /api/git/file-content when needed
    // This allows importing large repositories without hitting Next.js body size limits
    const filesWithMetadata: Array<{ type: string; path: string; size?: number; isBinary?: boolean }> = [];
    if (tree?.files) {
      const fileList = tree.files.filter((f: any) => f.type === "file");
      const dirList = tree.files.filter((f: any) => f.type === "dir");
      
      // Add directories first (no content needed)
      filesWithMetadata.push(...dirList);
      
      // Add file metadata (detect binary from extension, no content fetching)
      console.log(`📥 [Import API] Processing ${fileList.length} files (metadata only, no content to avoid 4MB limit)...`);
      fileList.forEach((file: any) => {
        const ext = file.path.split('.').pop()?.toLowerCase() || '';
        const textExts = ['html', 'htm', 'xhtml', 'css', 'js', 'jsx', 'ts', 'tsx', 'json', 'xml', 'txt', 'md', 'markdown', 'yml', 'yaml', 'toml', 'ini', 'conf', 'config', 'log', 'csv', 'tsv'];
        const isBinary = !textExts.includes(ext) && (file.size === undefined || file.size > 100000); // Assume binary if >100KB or unknown extension
        filesWithMetadata.push({
          ...file,
          isBinary,
          // content is excluded - frontend will fetch via /api/git/file-content
        });
      });
    }
    
    // Ensure we always return files, even if empty
    const finalFiles = filesWithMetadata.length > 0 ? filesWithMetadata : (tree?.files || []);
    
    console.log(`📦 [Import API] Final response (metadata only, no content):`, {
      filesWithMetadataLength: filesWithMetadata.length,
      treeFilesLength: tree?.files?.length || 0,
      finalFilesLength: finalFiles.length,
      fileCount: finalFiles.filter((f: any) => f.type === "file").length,
      dirCount: finalFiles.filter((f: any) => f.type === "dir").length,
    });
    
    const responsePayload: Data = {
      status: "completed",
      slug,
      entity,
      repo,
      readme,
      files: finalFiles, // Always return files array (even if empty)
      description,
      contributors: contributors.slice(0, 20), // Limit to top 20
      stars,
      forks,
      languages,
      topics,
      defaultBranch,
      branches,
      tags,
      releases,
      issues,
      pulls,
      commits,
      homepage, // Include GitHub Pages/website URL
      isPrivate, // Preserve GitHub privacy status
    };

    // Next.js API routes have a 4MB body limit (after gzip). 
    // We exclude file content from the response to avoid this limit.
    // Files are fetched individually when needed via /api/git/file-content.
    const jsonPayload = JSON.stringify(responsePayload);
    const payloadBytes = Buffer.byteLength(jsonPayload, "utf8");
    const MAX_PAYLOAD_BYTES = 3.5 * 1024 * 1024; // ~3.5MB buffer before the hard 4MB limit

    if (payloadBytes > MAX_PAYLOAD_BYTES) {
      console.warn(
        `⚠️ [Import API] Repository payload ${payloadBytes} bytes exceeds ${MAX_PAYLOAD_BYTES} byte limit. Failing with repo_too_large.`
      );
      return res.status(413).json({
        status: "repo_too_large",
        message:
          "This repository contains too many files (over 4MB of metadata). Please try importing a smaller repository or contact support.",
        fileCount: responsePayload.files?.filter((f) => f.type === "file").length ?? 0,
        approximateSizeBytes: payloadBytes,
      });
    }

    return res.status(200).json(responsePayload);
  } catch (e) {
    return res.status(500).json({ status: "error" });
  }
}
