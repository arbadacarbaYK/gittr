import { rateLimiters } from "@/app/api/middleware/rate-limit";
import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";

import { exec } from "child_process";
import * as fs from "fs";
import type { NextApiRequest, NextApiResponse } from "next";
import { tmpdir } from "os";
import * as path from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

type Data = {
  status?: string;
  success?: boolean;
  message?: string;
  slug?: string;
  repo?: string;
  readme?: string;
  files?: Array<{
    type: string;
    path: string;
    size?: number;
    content?: string;
    isBinary?: boolean;
  }>;
  description?: string;
  contributors?: Array<{
    login?: string;
    name?: string;
    avatar_url?: string;
    contributions?: number;
  }>;
  defaultBranch?: string;
  branches?: string[];
};

/**
 * Parse git URL to extract owner and repo name
 */
function parseGitUrl(
  sourceUrl: string
): { owner: string; repo: string; host: string } | null {
  try {
    // Normalize SSH URLs (git@host:owner/repo.git) to HTTPS
    let normalizedUrl = sourceUrl;
    if (sourceUrl.startsWith("git@")) {
      const match = sourceUrl.match(/^git@([^:]+):(.+)$/);
      if (match) {
        const [, host, path] = match;
        normalizedUrl = `https://${host}/${path}`;
      }
    } else if (sourceUrl.startsWith("git://")) {
      normalizedUrl = sourceUrl.replace(/^git:\/\//, "https://");
    }

    const url = new URL(normalizedUrl);
    const parts = url.pathname.split("/").filter(Boolean);

    if (parts.length >= 2) {
      const owner = parts[0];
      const repo = parts[parts.length - 1];
      if (!owner || !repo) return null;
      return {
        owner,
        repo: repo.replace(/\.git$/, ""),
        host: url.hostname,
      };
    } else if (parts.length === 1) {
      // Single path segment (e.g., git://jb55.com/damus)
      const repo = parts[0];
      if (!repo) return null;
      return {
        owner: "",
        repo: repo.replace(/\.git$/, ""),
        host: url.hostname,
      };
    }
  } catch (e) {
    console.error("Failed to parse git URL:", e);
  }
  return null;
}

/**
 * Clone repository to temporary directory and extract files
 */
async function cloneAndExtractFiles(sourceUrl: string): Promise<{
  files: Array<{
    type: string;
    path: string;
    size?: number;
    content?: string;
    isBinary?: boolean;
  }>;
  readme?: string;
  defaultBranch?: string;
  branches?: string[];
} | null> {
  const tempDir = path.join(
    tmpdir(),
    `gittr-import-${Date.now()}-${Math.random().toString(36).substring(7)}`
  );

  try {
    // Create temp directory
    fs.mkdirSync(tempDir, { recursive: true });

    // Normalize URL for git clone
    let cloneUrl = sourceUrl;
    if (sourceUrl.startsWith("git@")) {
      // SSH format - use as-is for git clone
      cloneUrl = sourceUrl;
    } else if (sourceUrl.startsWith("git://")) {
      // Convert git:// to https://
      cloneUrl = sourceUrl.replace(/^git:\/\//, "https://");
    } else if (
      !sourceUrl.startsWith("http://") &&
      !sourceUrl.startsWith("https://")
    ) {
      // Assume HTTPS if no protocol
      cloneUrl = `https://${sourceUrl}`;
    }

    console.log(`🔍 [Import Git] Cloning ${cloneUrl} to ${tempDir}`);

    // Clone repository (shallow clone for speed)
    const { stdout, stderr } = await execAsync(
      `git clone --depth 1 "${cloneUrl}" "${tempDir}"`,
      { timeout: 60000 } // 60 second timeout
    );

    if (
      stderr &&
      !stderr.includes("Cloning into") &&
      !stderr.includes("warning")
    ) {
      console.warn("Git clone stderr:", stderr);
    }

    // Get default branch
    let defaultBranch = "main";
    try {
      const { stdout: branchOutput } = await execAsync(
        `git -C "${tempDir}" rev-parse --abbrev-ref HEAD`,
        { timeout: 5000 }
      );
      defaultBranch = branchOutput.trim() || "main";
    } catch {
      // Default to main if branch detection fails
    }

    // Get branches
    let branches: string[] = [defaultBranch];
    try {
      const { stdout: branchesOutput } = await execAsync(
        `git -C "${tempDir}" branch -r --format="%(refname:short)"`,
        { timeout: 5000 }
      );
      branches = branchesOutput
        .split("\n")
        .map((b) => b.trim().replace(/^origin\//, ""))
        .filter((b) => b && b !== "HEAD")
        .slice(0, 50); // Limit to 50 branches
    } catch {
      // Use default branch only
    }

    // Walk directory and collect files
    const files: Array<{
      type: string;
      path: string;
      size?: number;
      content?: string;
      isBinary?: boolean;
    }> = [];
    let readme: string | undefined;

    function walkDir(dir: string, basePath: string = "") {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        // Skip .git directory
        if (entry.name === ".git") continue;

        const fullPath = path.join(dir, entry.name);
        const relativePath = basePath
          ? `${basePath}/${entry.name}`
          : entry.name;

        if (entry.isDirectory()) {
          files.push({ type: "dir", path: relativePath });
          walkDir(fullPath, relativePath);
        } else {
          const stats = fs.statSync(fullPath);
          const size = stats.size;

          // Check if it's a README file
          if (
            entry.name.toLowerCase().match(/^readme(\.(md|txt|rst))?$/i) &&
            !readme
          ) {
            try {
              readme = fs.readFileSync(fullPath, "utf-8");
            } catch {
              // Skip if can't read
            }
          }

          // Check if binary (heuristic: check for null bytes or large size)
          let isBinary = false;
          if (size > 1024 * 1024) {
            // Files > 1MB are likely binary
            isBinary = true;
          } else {
            // Check file extension
            const ext = path.extname(entry.name).toLowerCase();
            const binaryExts = [
              ".png",
              ".jpg",
              ".jpeg",
              ".gif",
              ".webp",
              ".svg",
              ".ico",
              ".pdf",
              ".zip",
              ".tar",
              ".gz",
              ".exe",
              ".dll",
              ".so",
              ".dylib",
            ];
            isBinary = binaryExts.includes(ext);
          }

          let content: string | undefined;
          if (!isBinary && size < 1024 * 100) {
            // Read text files < 100KB
            try {
              content = fs.readFileSync(fullPath, "utf-8");
            } catch {
              // Skip if can't read
            }
          }

          files.push({
            type: "file",
            path: relativePath,
            size,
            content,
            isBinary,
          });
        }
      }
    }

    walkDir(tempDir);

    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });

    return {
      files,
      readme,
      defaultBranch,
      branches,
    };
  } catch (error: any) {
    console.error("Failed to clone and extract files:", error);
    // Clean up on error
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    return null;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  // Handle OPTIONS request for CORS
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res, req);
    return;
  }

  // Set CORS headers
  setCorsHeaders(res, req);

  // Rate limiting
  const rateLimitResult = await rateLimiters.api(req as any);
  if (rateLimitResult) {
    return res.status(429).json(JSON.parse(await rateLimitResult.text()));
  }

  if (req.method !== "POST") {
    return res.status(405).json({ status: "method_not_allowed" });
  }

  const { sourceUrl } = req.body || {};

  if (!sourceUrl || typeof sourceUrl !== "string") {
    return res
      .status(400)
      .json({ status: "invalid_url", message: "Source URL is required" });
  }

  // Parse git URL
  const parsed = parseGitUrl(sourceUrl);
  if (!parsed) {
    return res
      .status(400)
      .json({ status: "invalid_url", message: "Invalid git URL format" });
  }

  const { owner, repo, host } = parsed;
  const slug = repo;

  try {
    // Clone and extract files
    const extracted = await cloneAndExtractFiles(sourceUrl);

    if (!extracted) {
      return res.status(500).json({
        status: "clone_failed",
        message:
          "Failed to clone repository. Please check the URL and ensure it's publicly accessible.",
      });
    }

    return res.status(200).json({
      status: "completed",
      success: true,
      slug,
      repo,
      readme: extracted.readme,
      files: extracted.files,
      description: `Imported from ${host}${owner ? `/${owner}` : ""}/${repo}`,
      defaultBranch: extracted.defaultBranch,
      branches: extracted.branches,
      contributors: [], // Custom git servers don't provide contributor info
    });
  } catch (error: any) {
    console.error("Import git error:", error);
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to import repository",
    });
  }
}
