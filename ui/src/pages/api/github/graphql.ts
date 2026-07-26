import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Server-side GitHub GraphQL proxy (Projects V2, etc.).
 * POST body: { query: string, variables?: object }
 * Uses GITHUB_PLATFORM_TOKEN when set (public data / rate limits).
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

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { query, variables } = req.body || {};
  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "query string is required" });
  }

  const platformToken = process.env.GITHUB_PLATFORM_TOKEN || null;
  const headers: Record<string, string> = {
    "User-Agent": "gittr-space",
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (platformToken) {
    headers.Authorization = `Bearer ${platformToken}`;
  }

  try {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables: variables || {} }),
    });
    const data = await response.text();
    res.setHeader("Content-Type", "application/json");
    const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
    if (rateLimitRemaining) {
      res.setHeader("X-RateLimit-Remaining", rateLimitRemaining);
    }
    return res.status(response.status).send(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("GitHub GraphQL proxy error:", error);
    return res.status(500).json({
      error: "Failed to fetch from GitHub GraphQL",
      details: message,
    });
  }
}
