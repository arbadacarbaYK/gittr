import { rateLimiters } from "@/app/api/middleware/rate-limit";
import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import { assertSafeGitHubApiEndpoint } from "@/lib/security/safe-remote-url";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Server-side proxy for GitHub API requests
 * Uses platform OAuth token from environment if available
 * This allows 5000 requests/hour instead of 60/hour (per IP)
 *
 * Endpoint: GET /api/github/proxy?endpoint=/repos/owner/repo/...
 * Only allowlisted relative paths are accepted (no open proxy).
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res, req);
    return;
  }

  setCorsHeaders(res, req);

  const rateLimitResult = await rateLimiters.githubProxy(req as any);
  if (rateLimitResult) {
    return res.status(429).json(JSON.parse(await rateLimitResult.text()));
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { endpoint } = req.query;

  if (!endpoint || typeof endpoint !== "string") {
    return res.status(400).json({ error: "endpoint parameter is required" });
  }

  const endpointCheck = assertSafeGitHubApiEndpoint(endpoint);
  if (!endpointCheck.ok) {
    return res.status(400).json({
      error: "endpoint not allowed",
      details: endpointCheck.error,
    });
  }

  // SECURITY: Platform token should ONLY have 'public_repo' scope, NOT 'repo' scope
  const platformToken = process.env.GITHUB_PLATFORM_TOKEN || null;

  try {
    const url = `https://api.github.com${endpointCheck.path}`;

    const headers: Record<string, string> = {
      "User-Agent": "gittr-space",
      Accept: "application/vnd.github.v3+json",
    };

    if (platformToken) {
      headers["Authorization"] = `Bearer ${platformToken}`;
    }

    const response = await fetch(url, {
      headers: headers as any,
      redirect: "error",
    });

    const data = await response.text();
    const contentType =
      response.headers.get("content-type") || "application/json";

    res.setHeader("Content-Type", contentType);

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
