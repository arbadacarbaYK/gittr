import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Server-side proxy for GitHub API requests
 * Uses platform OAuth token from environment if available
 * This allows 5000 requests/hour instead of 60/hour (per IP)
 *
 * Endpoint: GET /api/github/proxy?endpoint=/repos/owner/repo/...
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
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

  const { endpoint } = req.query;

  if (!endpoint || typeof endpoint !== "string") {
    return res.status(400).json({ error: "endpoint parameter is required" });
  }

  // SECURITY: Platform token should ONLY have 'public_repo' scope, NOT 'repo' scope
  // Using 'repo' scope would allow the server to access ANY user's private repos - major security issue!
  // This token is only used for:
  // 1. Public repos (rate limit increase: 60/hour → 5000/hour)
  // 2. User profile lookups (public data)
  // For private repos, users should use their own tokens or rely on the bridge (files pushed during import)
  const platformToken = process.env.GITHUB_PLATFORM_TOKEN || null;

  try {
    const url = `https://api.github.com${
      endpoint.startsWith("/") ? endpoint : `/${endpoint}`
    }`;

    const headers: Record<string, string> = {
      "User-Agent": "gittr-space",
      Accept: "application/vnd.github.v3+json",
    };

    // Use platform token if available (increases rate limit from 60 to 5000/hour)
    if (platformToken) {
      headers["Authorization"] = `Bearer ${platformToken}`;
    }

    const response = await fetch(url, { headers: headers as any });

    // Forward response
    const data = await response.text();
    const contentType =
      response.headers.get("content-type") || "application/json";

    res.setHeader("Content-Type", contentType);

    // Forward rate limit headers for debugging
    const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
    const rateLimitReset = response.headers.get("x-ratelimit-reset");
    if (rateLimitRemaining) {
      res.setHeader("X-RateLimit-Remaining", rateLimitRemaining);
    }
    if (rateLimitReset) {
      res.setHeader("X-RateLimit-Reset", rateLimitReset);
    }

    if (!response.ok) {
      console.error(
        `❌ [GitHub Proxy] GitHub API returned error ${response.status}:`,
        data.substring(0, 200)
      );
    } else {
    }

    return res.status(response.status).send(data);
  } catch (error: any) {
    console.error("GitHub proxy error:", error);
    return res.status(500).json({
      error: "Failed to fetch from GitHub API",
      details: error.message,
    });
  }
}
