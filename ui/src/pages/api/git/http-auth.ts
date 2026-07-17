import {
  assertRepoReadAccess,
  assertRepoWriteAccess,
  parseGitHttpUri,
} from "@/lib/repo-read-access";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Internal auth gate for nginx `auth_request` on git.gittr.space.
 *
 * nginx passes the original git smart-HTTP URI in X-Original-URI and forwards
 * Nostr auth headers so private repos match SSH/API ACL.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).end();
  }

  const originalUri =
    (req.headers["x-original-uri"] as string | undefined) ||
    (typeof req.query.uri === "string" ? req.query.uri : "");

  const parsed = parseGitHttpUri(originalUri);
  if (!parsed) {
    return res.status(400).end();
  }

  const access =
    parsed.operation === "write"
      ? await assertRepoWriteAccess(req, parsed.owner, parsed.repo)
      : await assertRepoReadAccess(req, parsed.owner, parsed.repo);

  if (!access.ok) {
    if (access.error) {
      res.setHeader("X-Gittr-Error", access.error.slice(0, 200));
    }
    return res.status(access.status).end();
  }

  return res.status(200).end();
}
