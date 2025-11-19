import type { NextApiRequest, NextApiResponse } from "next";
import { setCorsHeaders, handleOptionsRequest } from "@/lib/api/cors";

/**
 * API endpoint to fetch contributors from external git servers (GitHub, GitLab, Codeberg)
 * 
 * Endpoint: GET /api/git/contributors?sourceUrl={url}
 * 
 * Query params:
 * - sourceUrl: Full git repository URL (e.g., https://github.com/owner/repo.git)
 * 
 * Returns: Array of contributors with login, avatar_url, and contributions count
 */

interface Contributor {
  login: string;
  avatar_url: string;
  contributions: number;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handle OPTIONS request for CORS
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res);
    return;
  }

  // Set CORS headers
  setCorsHeaders(res);

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { sourceUrl } = req.query;

  if (!sourceUrl || typeof sourceUrl !== "string") {
    return res.status(400).json({ error: "sourceUrl is required" });
  }

  try {
    // Parse sourceUrl to determine platform
    const githubMatch = sourceUrl.match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?$/);
    const gitlabMatch = sourceUrl.match(/gitlab\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?$/);
    const codebergMatch = sourceUrl.match(/codeberg\.org\/([^\/]+)\/([^\/]+?)(?:\.git)?$/);

    let contributors: Contributor[] = [];

    if (githubMatch) {
      // GitHub API
      const [, owner, repo] = githubMatch;
      const platformToken = process.env.GITHUB_PLATFORM_TOKEN || null;
      const headers: Record<string, string> = {
        "User-Agent": "gittr-space",
        "Accept": "application/vnd.github.v3+json"
      };
      if (platformToken) {
        headers["Authorization"] = `Bearer ${platformToken}`;
      }

      const contributorsUrl = `https://api.github.com/repos/${owner}/${repo}/contributors`;
      const response = await fetch(contributorsUrl, { headers: headers as any });
      
      if (response.ok) {
        const data = await response.json();
        contributors = data.map((c: any) => ({
          login: c.login,
          avatar_url: c.avatar_url,
          contributions: c.contributions || 0,
        }));
      } else {
      }
    } else if (gitlabMatch) {
      // GitLab API
      const [, owner, repo] = gitlabMatch;
      if (!owner || !repo) {
        return res.status(400).json({ error: "Invalid GitLab URL format" });
      }
      // GitLab API uses project path (owner/repo) encoded
      const projectPath = encodeURIComponent(`${owner}/${repo}`);
      const contributorsUrl = `https://gitlab.com/api/v4/projects/${projectPath}/repository/contributors`;
      
      const response = await fetch(contributorsUrl, {
        headers: {
          "User-Agent": "gittr-space",
        } as any
      });
      
      if (response.ok) {
        const data = await response.json();
        contributors = data.map((c: any) => ({
          login: c.email || c.name || `user-${c.commits}`,
          avatar_url: c.avatar_url || "",
          contributions: c.commits || 0,
        }));
      } else {
      }
    } else if (codebergMatch) {
      // Codeberg API (Gitea-based)
      const [, owner, repo] = codebergMatch;
      if (!owner || !repo) {
        return res.status(400).json({ error: "Invalid Codeberg URL format" });
      }
      // Codeberg uses Gitea API - encode owner and repo separately
      const contributorsUrl = `https://codeberg.org/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contributors`;
      
      const response = await fetch(contributorsUrl, {
        headers: {
          "User-Agent": "gittr-space",
          "Accept": "application/json"
        } as any
      });
      
      if (response.ok) {
        const data = await response.json();
        contributors = data.map((c: any) => ({
          login: c.login || c.user?.login || `user-${c.contributions}`,
          avatar_url: c.avatar_url || c.user?.avatar_url || "",
          contributions: c.contributions || 0,
        }));
      } else {
      }
    } else {
      return res.status(400).json({ error: "Unsupported git service. Only GitHub, GitLab, and Codeberg are supported." });
    }

    return res.status(200).json(contributors);
  } catch (error: any) {
    console.error("❌ [Contributors API] Error fetching contributors:", error);
    return res.status(500).json({ error: error.message || "Failed to fetch contributors" });
  }
}

