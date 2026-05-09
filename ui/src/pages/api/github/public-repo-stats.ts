import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";

import type { NextApiRequest, NextApiResponse } from "next";

type RepoReq = { owner: string; repo: string };

function validSlug(s: string): boolean {
  return (
    typeof s === "string" &&
    s.length > 0 &&
    s.length <= 200 &&
    /^[a-zA-Z0-9._-]+$/.test(s)
  );
}

/**
 * Batch public GitHub repo stats for the Apps directory (stars / forks).
 * Uses GITHUB_PLATFORM_TOKEN when set to reduce rate-limit issues.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === "OPTIONS") {
    return handleOptionsRequest(res, req);
  }
  setCorsHeaders(res, req);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body as { repos?: RepoReq[] };
  const repos = Array.isArray(body?.repos) ? body.repos.slice(0, 25) : [];
  if (repos.length === 0) {
    return res.status(200).json({ stats: {} as Record<string, unknown> });
  }

  const token = process.env.GITHUB_PLATFORM_TOKEN || "";
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "gittr-space-apps-directory",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const stats: Record<string, { stars: number; forks: number }> = {};

  await Promise.all(
    repos.map(async ({ owner, repo }) => {
      if (!validSlug(owner) || !validSlug(repo)) return;
      const key = `${owner}/${repo}`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12_000);
      try {
        const r = await fetch(
          `https://api.github.com/repos/${encodeURIComponent(
            owner
          )}/${encodeURIComponent(repo)}`,
          { headers, signal: ctrl.signal }
        );
        if (!r.ok) return;
        const j = (await r.json()) as {
          stargazers_count?: number;
          forks_count?: number;
        };
        if (typeof j.stargazers_count === "number") {
          stats[key] = {
            stars: j.stargazers_count,
            forks: typeof j.forks_count === "number" ? j.forks_count : 0,
          };
        }
      } catch {
        // ignore per-repo failures
      } finally {
        clearTimeout(timer);
      }
    })
  );

  return res.status(200).json({ stats });
}
