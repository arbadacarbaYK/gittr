import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * API endpoint to fetch file content from external git servers (GitHub, GitLab)
 * This proxy endpoint avoids CORS issues by fetching on the server side
 *
 * Endpoint: GET /api/git/file-content?sourceUrl={url}&path={filePath}&branch={branch}
 *
 * Query params:
 * - sourceUrl: Full git repository URL (e.g., https://github.com/owner/repo.git or https://gitlab.com/owner/repo.git)
 * - path: File path within the repository
 * - branch: Branch name (default: "main")
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Handle OPTIONS request for CORS
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res, req);
    return;
  }

  // Set CORS headers
  setCorsHeaders(res, req);

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { sourceUrl, path: filePath, branch = "main", githubToken } = req.query;

  // Validate inputs
  if (!sourceUrl || typeof sourceUrl !== "string") {
    return res.status(400).json({ error: "sourceUrl is required" });
  }

  if (!filePath || typeof filePath !== "string") {
    return res.status(400).json({ error: "path is required" });
  }

  // Get user's GitHub token if provided (for private repos)
  // SECURITY: Only accept token from query param (sent by frontend from localStorage)
  // Never trust tokens from cookies or headers to avoid CSRF
  const userToken = typeof githubToken === "string" ? githubToken : null;
  console.log(`🔍 [Git API] Request received:`, {
    sourceUrl:
      typeof sourceUrl === "string"
        ? sourceUrl.substring(0, 50) + "..."
        : sourceUrl,
    path: filePath,
    branch,
    hasUserToken: !!userToken,
    hasPlatformToken: !!process.env.GITHUB_PLATFORM_TOKEN,
  });

  try {
    // Parse sourceUrl to determine if it's GitHub, GitLab, or Codeberg
    const githubMatch = sourceUrl.match(
      /github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?$/
    );
    const gitlabMatch = sourceUrl.match(
      /gitlab\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?$/
    );
    const codebergMatch = sourceUrl.match(
      /codeberg\.org\/([^\/]+)\/([^\/]+?)(?:\.git)?$/
    );

    if (githubMatch) {
      const [, owner, repo] = githubMatch;

      // CRITICAL: Use raw URL directly - it's more reliable than the API proxy
      // Raw URLs work for public repos without authentication and are faster
      const branchStr: string = Array.isArray(branch)
        ? branch[0] || "main"
        : typeof branch === "string"
        ? branch
        : "main";
      const filePathStr: string = Array.isArray(filePath)
        ? filePath[0] || ""
        : typeof filePath === "string"
        ? filePath
        : "";
      if (!filePathStr) {
        return res.status(400).json({ error: "path is required" });
      }
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(
        branchStr
      )}/${encodeURIComponent(filePathStr)}`;

      console.log(`🔍 [Git API] Fetching from GitHub raw URL: ${rawUrl}`);

      try {
        // CRITICAL: raw.githubusercontent.com doesn't support Authorization headers
        // For authenticated requests, we need to use the GitHub API instead
        // Priority: user token (for private repos) > platform token (for public repos)
        const tokenToUse =
          userToken || process.env.GITHUB_PLATFORM_TOKEN || null;

        // If we have a token, use GitHub API instead of raw URL for better rate limits and private repo access
        if (tokenToUse) {
          // CRITICAL: Use JSON API endpoint first to detect binary files properly
          // The JSON endpoint returns base64-encoded content which we can use for both text and binary
          const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(
            filePathStr
          )}?ref=${encodeURIComponent(branchStr)}`;
          console.log(
            `🔍 [Git API] Using GitHub API (authenticated) instead of raw URL: ${apiUrl}`
          );

          try {
            // First, try JSON API to get file metadata and base64 content
            const jsonResponse = await fetch(apiUrl, {
              headers: {
                Authorization: `Bearer ${tokenToUse}`,
                Accept: "application/vnd.github.v3+json",
                "User-Agent": "Mozilla/5.0 (compatible; gittr-space/1.0)",
              },
            });

            if (jsonResponse.ok) {
              const fileData: any = await jsonResponse.json();

              // GitHub API returns base64-encoded content in the 'content' field
              if (fileData.content && fileData.encoding === "base64") {
                // Determine if it's a binary file based on file extension
                // Use a more comprehensive approach: check if extension matches known text file types
                const ext = filePathStr.split(".").pop()?.toLowerCase() || "";
                const textFileExts = [
                  "txt",
                  "md",
                  "markdown",
                  "json",
                  "xml",
                  "yaml",
                  "yml",
                  "toml",
                  "js",
                  "ts",
                  "jsx",
                  "tsx",
                  "py",
                  "java",
                  "c",
                  "cpp",
                  "h",
                  "hpp",
                  "cs",
                  "php",
                  "rb",
                  "go",
                  "rs",
                  "swift",
                  "kt",
                  "scala",
                  "clj",
                  "sh",
                  "bash",
                  "zsh",
                  "fish",
                  "r",
                  "m",
                  "mm",
                  "dart",
                  "lua",
                  "pl",
                  "pm",
                  "sql",
                  "hs",
                  "elm",
                  "ex",
                  "exs",
                  "erl",
                  "ml",
                  "mli",
                  "fs",
                  "fsx",
                  "vb",
                  "vim",
                  "vimrc",
                  "html",
                  "htm",
                  "xhtml",
                  "css",
                  "scss",
                  "sass",
                  "less",
                  "styl",
                  "vue",
                  "svelte",
                  "graphql",
                  "gql",
                  "prisma",
                  "psql",
                  "mysql",
                  "log",
                  "ini",
                  "conf",
                  "config",
                  "cfg",
                  "properties",
                  "env",
                  "gitignore",
                  "gitattributes",
                  "dockerignore",
                  "editorconfig",
                  "lock",
                  "csv",
                  "tsv",
                  "diff",
                  "patch",
                  "makefile",
                  "cmake",
                  "gradle",
                  "maven",
                  "pom",
                ];

                // Check if it's a known binary file type (images, videos, audio, PDFs, fonts, archives, installers, executables)
                const binaryFileExts = [
                  // Images
                  "png",
                  "jpg",
                  "jpeg",
                  "gif",
                  "webp",
                  "svg",
                  "bmp",
                  "ico",
                  "avif",
                  "tiff",
                  "tif",
                  "heic",
                  "heif",
                  "apng",
                  "jfif",
                  "jp2",
                  "jpx",
                  "j2k",
                  // Videos
                  "mp4",
                  "webm",
                  "ogg",
                  "ogv",
                  "mov",
                  "avi",
                  "mkv",
                  "flv",
                  "wmv",
                  "m4v",
                  "3gp",
                  "3g2",
                  "asf",
                  "rm",
                  "rmvb",
                  "vob",
                  "mpg",
                  "mpeg",
                  "m2v",
                  // Audio
                  "mp3",
                  "wav",
                  "flac",
                  "aac",
                  "m4a",
                  "wma",
                  "opus",
                  "amr",
                  "au",
                  "ra",
                  "mid",
                  "midi",
                  "aiff",
                  "aif",
                  "caf",
                  // Documents
                  "pdf",
                  "doc",
                  "docx",
                  "xls",
                  "xlsx",
                  "ppt",
                  "pptx",
                  "odt",
                  "ods",
                  "odp",
                  // Fonts
                  "woff",
                  "woff2",
                  "ttf",
                  "otf",
                  "eot",
                  "ttc",
                  // Archives & Compressed
                  "zip",
                  "tar",
                  "gz",
                  "bz2",
                  "xz",
                  "7z",
                  "rar",
                  "dmg",
                  "iso",
                  "deb",
                  "rpm",
                  "pkg",
                  "cab",
                  "ar",
                  "cpio",
                  "shar",
                  "lz",
                  "lzma",
                  "lzo",
                  "z",
                  "zst",
                  "zstd",
                  // Installers & Executables (Release Assets)
                  "exe",
                  "dll",
                  "so",
                  "dylib",
                  "bin",
                  "app",
                  "apk",
                  "ipa",
                  "msi",
                  "msix",
                  "appx",
                  "appxbundle",
                  "snap",
                  // Platform-specific packages
                  "deb",
                  "rpm",
                  "pkg",
                  "dmg",
                  "pkg",
                  "flatpak",
                  "appimage",
                  // Other binaries
                  "wasm",
                  "o",
                  "obj",
                  "lib",
                  "a",
                  "jar",
                  "war",
                  "ear",
                  "class",
                ];

                const isKnownBinary = binaryFileExts.includes(ext);
                const isKnownText = textFileExts.includes(ext);

                // If it's a known binary type, return as binary
                if (isKnownBinary) {
                  return res.status(200).json({
                    content: fileData.content, // Already base64-encoded
                    isBinary: true,
                    path: filePath,
                    branch,
                  });
                }

                // If it's a known text type, decode to text
                if (isKnownText) {
                  try {
                    const textContent = Buffer.from(
                      fileData.content,
                      "base64"
                    ).toString("utf-8");
                    console.log(
                      `✅ [Git API] Successfully fetched text file from GitHub API: ${filePath} (${textContent.length} chars)`
                    );
                    return res.status(200).json({
                      content: textContent,
                      isBinary: false,
                      path: filePath,
                      branch,
                    });
                  } catch (decodeError: any) {
                    console.warn(
                      `⚠️ [Git API] Failed to decode base64 content, treating as binary:`,
                      decodeError.message
                    );
                    return res.status(200).json({
                      content: fileData.content,
                      isBinary: true,
                      path: filePath,
                      branch,
                    });
                  }
                }

                // For unknown extensions, try to decode and check if it's valid UTF-8
                // If decoding fails or contains null bytes, treat as binary
                try {
                  const textContent = Buffer.from(
                    fileData.content,
                    "base64"
                  ).toString("utf-8");
                  // Check for null bytes or other binary indicators
                  if (textContent.includes("\0") || textContent.length === 0) {
                    return res.status(200).json({
                      content: fileData.content,
                      isBinary: true,
                      path: filePath,
                      branch,
                    });
                  }
                  // If it decodes successfully and looks like text, treat as text
                  console.log(
                    `✅ [Git API] Successfully fetched file (unknown type, decoded as text) from GitHub API: ${filePath} (${textContent.length} chars)`
                  );
                  return res.status(200).json({
                    content: textContent,
                    isBinary: false,
                    path: filePath,
                    branch,
                  });
                } catch (decodeError: any) {
                  // Decoding failed, treat as binary
                  console.log(
                    `⚠️ [Git API] Failed to decode file, treating as binary: ${filePath}`
                  );
                  return res.status(200).json({
                    content: fileData.content,
                    isBinary: true,
                    path: filePath,
                    branch,
                  });
                }
              } else {
                // File is too large or uses Git LFS - fall through to raw URL
                console.log(
                  `⚠️ [Git API] File uses Git LFS or is too large, falling back to raw URL`
                );
              }
            } else if (jsonResponse.status === 404) {
              console.log(
                `⚠️ [Git API] File not found on GitHub API: ${filePath}`
              );
              return res.status(404).json({
                error: "File not found",
                status: 404,
                path: filePath,
                branch,
              });
            } else if (jsonResponse.status === 429) {
              const retryAfter =
                jsonResponse.headers.get("retry-after") || "60";
              console.log(
                `⚠️ [Git API] GitHub API rate limit hit (429), retry after ${retryAfter}s`
              );
              return res.status(429).json({
                error: "GitHub rate limit exceeded",
                status: 429,
                retryAfter: parseInt(retryAfter, 10),
                message:
                  "Too many requests to GitHub. Please try again in a few minutes.",
                path: filePath,
                branch,
              });
            } else {
              // API failed, fall through to try raw URL
              console.log(
                `⚠️ [Git API] GitHub JSON API failed (${jsonResponse.status}), trying raw URL as fallback...`
              );
            }
          } catch (apiError: any) {
            console.warn(
              `⚠️ [Git API] GitHub API request failed, trying raw URL:`,
              apiError.message
            );
            // Fall through to try raw URL
          }
        }

        // Fallback to raw URL (for unauthenticated requests or if API failed)
        const headers: Record<string, string> = {
          "User-Agent": "Mozilla/5.0 (compatible; gittr-space/1.0)",
          Accept: "*/*",
        };

        const rawResponse = await fetch(rawUrl, {
          headers,
          redirect: "follow",
        });

        if (rawResponse.ok) {
          const contentType = rawResponse.headers.get("content-type") || "";
          const isBinary =
            !contentType.startsWith("text/") &&
            !contentType.includes("json") &&
            !contentType.includes("xml") &&
            !contentType.includes("javascript") &&
            !contentType.includes("css") &&
            !contentType.includes("markdown");

          if (isBinary) {
            // For binary files, return base64 encoded content
            const arrayBuffer = await rawResponse.arrayBuffer();
            const base64 = Buffer.from(arrayBuffer).toString("base64");
            return res.status(200).json({
              content: base64,
              isBinary: true,
              path: filePath,
              branch,
            });
          }

          const txt = await rawResponse.text();
          console.log(
            `✅ [Git API] Successfully fetched file from GitHub: ${filePath} (${txt.length} chars)`
          );
          return res.status(200).json({
            content: txt,
            isBinary: false,
            path: filePath,
            branch,
          });
        } else if (rawResponse.status === 429) {
          // Rate limited - return helpful error message
          const retryAfter = rawResponse.headers.get("retry-after") || "60";
          console.log(
            `⚠️ [Git API] GitHub rate limit hit (429), retry after ${retryAfter}s`
          );
          return res.status(429).json({
            error: "GitHub rate limit exceeded",
            status: 429,
            retryAfter: parseInt(retryAfter, 10),
            message:
              "Too many requests to GitHub. Please try again in a few minutes.",
            path: filePath,
            branch,
          });
        } else if (rawResponse.status === 404) {
          // File doesn't exist - return 404
          console.log(`⚠️ [Git API] File not found on GitHub: ${filePath}`);
          return res.status(404).json({
            error: "File not found",
            status: 404,
            path: filePath,
            branch,
          });
        } else {
          // Try API as fallback for other errors
          console.log(
            `⚠️ [Git API] GitHub raw URL failed (${rawResponse.status}), trying API...`
          );
          const endpoint = `/repos/${owner}/${repo}/contents/${encodeURIComponent(
            filePathStr
          )}?ref=${encodeURIComponent(branchStr)}`;
          const proxyUrl = `${
            process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"
          }/api/github/proxy?endpoint=${encodeURIComponent(endpoint)}`;

          try {
            const apiResponse = await fetch(proxyUrl);
            if (apiResponse.ok) {
              const data: any = await apiResponse.json();
              if (data.content && data.encoding === "base64") {
                const content = Buffer.from(data.content, "base64").toString(
                  "utf-8"
                );
                return res.status(200).json({
                  content,
                  isBinary: false,
                  path: filePath,
                  branch,
                });
              }
            }
          } catch (apiError: any) {
            console.error(
              `❌ [Git API] GitHub API proxy also failed:`,
              apiError.message
            );
          }

          // Both failed - return the original error
          let errorText = "";
          try {
            errorText = await rawResponse.text();
          } catch (textError) {
            // If we can't read the error text, that's okay - just use empty string
            console.warn(`⚠️ [Git API] Could not read error text:`, textError);
          }
          console.error(
            `❌ [Git API] GitHub fetch failed: ${
              rawResponse.status
            } - ${errorText.substring(0, 200)}`
          );
          return res.status(rawResponse.status || 500).json({
            error: "Failed to fetch file from GitHub",
            status: rawResponse.status || 500,
            details: errorText.substring(0, 200) || "Unknown error",
          });
        }
      } catch (fetchError: any) {
        console.error(
          `❌ [Git API] Error fetching from GitHub:`,
          fetchError.message || fetchError
        );
        return res.status(500).json({
          error: "Failed to fetch file from GitHub",
          details: fetchError.message || "Unknown error",
        });
      }
    } else if (gitlabMatch) {
      const [, owner, repo] = gitlabMatch;
      const projectPath = encodeURIComponent(`${owner}/${repo}`);
      // GitLab API format: /api/v4/projects/{project}/repository/files/{file_path}/raw
      // file_path needs to be URL encoded
      const branchStr: string = Array.isArray(branch)
        ? branch[0] || "main"
        : typeof branch === "string"
        ? branch
        : "main";
      const filePathStr: string = Array.isArray(filePath)
        ? filePath[0] || ""
        : typeof filePath === "string"
        ? filePath
        : "";
      if (!filePathStr) {
        return res.status(400).json({ error: "path is required" });
      }
      const encodedFilePath = encodeURIComponent(filePathStr);
      const apiUrl = `https://gitlab.com/api/v4/projects/${projectPath}/repository/files/${encodedFilePath}/raw?ref=${encodeURIComponent(
        branchStr
      )}`;

      console.log(`🔍 [Git API] Fetching from GitLab API: ${apiUrl}`);

      // Try raw URL first for public repos (might avoid rate limiting)
      // GitLab raw URLs work for public repos without API access
      // Format: https://gitlab.com/{projectPath}/-/raw/{branch}/{filePath}
      const rawUrl = `https://gitlab.com/${projectPath}/-/raw/${encodeURIComponent(
        branchStr
      )}/${encodeURIComponent(filePathStr)}`;
      let response = await fetch(rawUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; gittr-space/1.0)",
          Accept: "*/*",
          "Accept-Language": "en-US,en;q=0.9",
        } as any,
        // Add redirect handling
        redirect: "follow",
      });

      // If raw URL fails with 403, it might be rate limiting or access issue
      // Try API as fallback, but also check if it's a 404 (file doesn't exist)
      if (!response.ok) {
        if (response.status === 404) {
          // File doesn't exist - return 404
          return res.status(404).json({
            error: "File not found",
            status: 404,
            path: filePath,
            branch,
          });
        }
        // For 403 or other errors, try API as fallback
        console.log(
          `⚠️ [Git API] GitLab raw URL failed (${response.status}), trying API...`
        );
        const apiResponse = await fetch(apiUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; gittr-space/1.0)",
            Accept: "*/*",
          } as any,
        });
        // Only use API response if it's successful
        if (apiResponse.ok) {
          response = apiResponse;
        } else {
          // Both failed - return the original error with more details
          const errorText = await response.text().catch(() => "");
          console.error(
            `❌ [Git API] Both GitLab raw URL and API failed. Raw: ${response.status}, API: ${apiResponse.status}`
          );
          return res.status(response.status).json({
            error: "Failed to fetch file from GitLab",
            status: response.status,
            details: errorText.substring(0, 200),
            suggestion:
              response.status === 403
                ? "This might be a rate limit or access restriction. The repository might require authentication."
                : undefined,
          });
        }
      }

      if (response.ok) {
        const contentType = response.headers.get("content-type") || "";
        const isBinary =
          !contentType.startsWith("text/") &&
          !contentType.includes("json") &&
          !contentType.includes("xml") &&
          !contentType.includes("javascript") &&
          !contentType.includes("css") &&
          !contentType.includes("markdown");

        if (isBinary) {
          // For binary files, we need to return base64 encoded content
          const arrayBuffer = await response.arrayBuffer();
          const base64 = Buffer.from(arrayBuffer).toString("base64");
          return res.status(200).json({
            content: base64,
            isBinary: true,
            path: filePath,
            branch,
          });
        }

        const txt = await response.text();
        return res.status(200).json({
          content: txt,
          isBinary: false,
          path: filePath,
          branch,
        });
      } else {
        const errorText = await response.text().catch(() => "");
        console.error(
          `❌ [Git API] GitLab fetch failed: ${
            response.status
          } - ${errorText.substring(0, 200)}`
        );
        return res.status(response.status).json({
          error: "Failed to fetch file from GitLab",
          status: response.status,
          details: errorText.substring(0, 200),
        });
      }
    } else if (codebergMatch) {
      const [, owner, repo] = codebergMatch;
      // Codeberg uses Gitea API (similar to GitHub)
      // Raw URL format: https://codeberg.org/{owner}/{repo}/raw/branch/{branch}/{filePath}
      const branchStr: string = Array.isArray(branch)
        ? branch[0] || "main"
        : typeof branch === "string"
        ? branch
        : "main";
      const filePathStr: string = Array.isArray(filePath)
        ? filePath[0] || ""
        : typeof filePath === "string"
        ? filePath
        : "";
      if (!filePathStr) {
        return res.status(400).json({ error: "path is required" });
      }
      const rawUrl = `https://codeberg.org/${owner}/${repo}/raw/branch/${encodeURIComponent(
        branchStr
      )}/${encodeURIComponent(filePathStr)}`;

      console.log(`🔍 [Git API] Fetching from Codeberg raw URL: ${rawUrl}`);

      try {
        const response = await fetch(rawUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; gittr-space/1.0)",
            Accept: "*/*",
          } as any,
          redirect: "follow",
        });

        if (response.ok) {
          const contentType = response.headers.get("content-type") || "";
          const isBinary =
            !contentType.startsWith("text/") &&
            !contentType.includes("json") &&
            !contentType.includes("xml") &&
            !contentType.includes("javascript") &&
            !contentType.includes("css") &&
            !contentType.includes("markdown");

          if (isBinary) {
            // For binary files, return base64 encoded content
            const arrayBuffer = await response.arrayBuffer();
            const base64 = Buffer.from(arrayBuffer).toString("base64");
            return res.status(200).json({
              content: base64,
              isBinary: true,
              path: filePath,
              branch,
            });
          }

          const txt = await response.text();
          console.log(
            `✅ [Git API] Successfully fetched file from Codeberg: ${filePath} (${txt.length} chars)`
          );
          return res.status(200).json({
            content: txt,
            isBinary: false,
            path: filePath,
            branch,
          });
        } else if (response.status === 404) {
          // File doesn't exist - return 404
          console.log(`⚠️ [Git API] File not found on Codeberg: ${filePath}`);
          return res.status(404).json({
            error: "File not found",
            status: 404,
            path: filePath,
            branch,
          });
        } else {
          // Try alternative raw URL format (Codeberg sometimes uses /raw/commit/{sha} or /raw/tag/{tag})
          // But first, return the error with details
          const errorText = await response.text().catch(() => "");
          console.error(
            `❌ [Git API] Codeberg fetch failed: ${
              response.status
            } - ${errorText.substring(0, 200)}`
          );
          return res.status(response.status).json({
            error: "Failed to fetch file from Codeberg",
            status: response.status,
            details: errorText.substring(0, 200),
          });
        }
      } catch (fetchError: any) {
        console.error(
          `❌ [Git API] Error fetching from Codeberg:`,
          fetchError.message
        );
        return res.status(500).json({
          error: "Failed to fetch file from Codeberg",
          details: fetchError.message,
        });
      }
    } else {
      // Check if it's a GRASP server - these use the bridge API
      const { isGraspServer } = require("@/lib/utils/grasp-servers");
      if (isGraspServer(sourceUrl)) {
        // GRASP servers don't expose REST APIs - they require git-nostr-bridge
        // Extract npub and repo from the URL
        // Format: https://git.shakespeare.diy/npub1.../repo.git
        const graspMatch = sourceUrl.match(
          /https?:\/\/[^\/]+\/(npub[a-z0-9]+)\/([^\/]+?)(?:\.git)?$/i
        );
        if (graspMatch) {
          const [, npub, repo] = graspMatch;
          const branchStr: string = Array.isArray(branch)
            ? branch[0] || "main"
            : typeof branch === "string"
            ? branch
            : "main";
          const filePathStr: string = Array.isArray(filePath)
            ? filePath[0] || ""
            : typeof filePath === "string"
            ? filePath
            : "";

          if (!filePathStr || !npub || !repo) {
            return res
              .status(400)
              .json({ error: "path, npub, and repo are required" });
          }

          // Decode npub to get pubkey for bridge API
          try {
            const { nip19 } = require("nostr-tools");
            const decoded = nip19.decode(npub);
            if (decoded.type === "npub") {
              const ownerPubkey = decoded.data as string;

              // Use bridge API to fetch file content
              const bridgeUrl = `/api/nostr/repo/file-content?ownerPubkey=${encodeURIComponent(
                ownerPubkey
              )}&repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(
                filePathStr
              )}&branch=${encodeURIComponent(branchStr)}`;

              // Forward the request to the bridge API
              // Note: This is a server-side API route, so we need to construct the full URL
              // Use environment variable or default to localhost for development
              const baseUrl =
                process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
              const fullBridgeUrl = `${baseUrl}${bridgeUrl}`;

              console.log(
                `🔍 [Git API] GRASP server detected, forwarding to bridge API: ${fullBridgeUrl}`
              );

              try {
                const bridgeResponse = await fetch(fullBridgeUrl, {
                  headers: {
                    "Content-Type": "application/json",
                  },
                });
                if (bridgeResponse.ok) {
                  const bridgeData = await bridgeResponse.json();
                  return res.status(200).json(bridgeData);
                } else {
                  const errorText = await bridgeResponse.text().catch(() => "");
                  console.error(
                    `❌ [Git API] Bridge API failed: ${
                      bridgeResponse.status
                    } - ${errorText.substring(0, 200)}`
                  );
                  return res.status(bridgeResponse.status).json({
                    error: "Failed to fetch file from GRASP server via bridge",
                    status: bridgeResponse.status,
                    details: errorText.substring(0, 200),
                  });
                }
              } catch (bridgeError: any) {
                console.error(
                  `❌ [Git API] Error calling bridge API:`,
                  bridgeError.message
                );
                return res.status(500).json({
                  error: "Failed to fetch file from GRASP server",
                  details: bridgeError.message,
                });
              }
            }
          } catch (decodeError: any) {
            console.error(
              `❌ [Git API] Failed to decode npub from GRASP URL:`,
              decodeError.message
            );
            return res.status(400).json({
              error: "Invalid npub in GRASP server URL",
              details: decodeError.message,
            });
          }
        }

        return res.status(400).json({
          error:
            "Invalid GRASP server URL format. Expected: https://domain/npub.../repo.git",
          sourceUrl,
        });
      }

      return res.status(400).json({
        error:
          "Unsupported git server. Only GitHub, GitLab, Codeberg, and GRASP servers are supported.",
        sourceUrl,
      });
    }
  } catch (error: any) {
    console.error("Error fetching file from git server:", error);
    return res.status(500).json({
      error: "Failed to fetch file",
      details: error.message,
    });
  }
}
