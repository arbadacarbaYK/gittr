/**
 * Upsert RepositoryPushPolicy in the git-nostr-bridge SQLite DB from a signed
 * kind 30617 event. Paywall enforcement (/push-payment, /push) reads this table;
 * without a row, push cost is treated as 0 even if the UI saved pushCostSats locally.
 */
import { rateLimiters } from "@/app/api/middleware/rate-limit";

import { exec } from "child_process";
import { existsSync, readFileSync } from "fs";
import type { NextApiRequest, NextApiResponse } from "next";
import { promisify } from "util";

import { verifyNostrAuth } from "./push-auth";

const execAsync = promisify(exec);

async function resolveBridgeDbPath(): Promise<string | null> {
  const configPaths = [
    process.env.HOME
      ? `${process.env.HOME}/.config/git-nostr/git-nostr-bridge.json`
      : null,
    "/home/git-nostr/.config/git-nostr/git-nostr-bridge.json",
  ].filter(Boolean) as string[];

  for (const configPath of configPaths) {
    try {
      if (existsSync(configPath)) {
        const configContent = readFileSync(configPath, "utf-8");
        const config = JSON.parse(configContent);
        if (config.DbFile && typeof config.DbFile === "string") {
          const homeDir = configPath.includes("/home/git-nostr")
            ? "/home/git-nostr"
            : process.env.HOME || "";
          return config.DbFile.replace(/^~/, homeDir);
        }
      }
    } catch {
      // continue
    }
  }

  if (process.env.HOME) {
    return `${process.env.HOME}/.config/git-nostr/git-nostr-db.sqlite`;
  }
  return null;
}

function escSql(value: string): string {
  return value.replace(/'/g, "''");
}

async function ensureSqlite(): Promise<boolean> {
  try {
    await execAsync("which sqlite3", { timeout: 1000 });
    return true;
  } catch {
    return false;
  }
}

async function runSql(dbPath: string, query: string): Promise<string> {
  const escapedQuery = query.replace(/'/g, "'\\''");
  const command = `echo '${escapedQuery}' | sqlite3 "${dbPath}"`;
  const { stdout } = await execAsync(command, { timeout: 5000 });
  return stdout || "";
}

function parsePushPolicyFromAuthEvent(event: any): {
  repoName: string;
  pushCostSats: number;
} | null {
  if (!event?.tags || !Array.isArray(event.tags)) return null;
  const dTag = event.tags.find((t: string[]) => t[0] === "d");
  const repoName = (dTag?.[1] || "").trim();
  if (!repoName) return null;
  let pushCostSats = 0;
  const pc = event.tags.find((t: string[]) => t[0] === "push_cost_sats");
  if (pc?.[1] != null) {
    const n = parseInt(String(pc[1]).trim(), 10);
    if (Number.isFinite(n) && n >= 0) pushCostSats = n;
  }
  return { repoName, pushCostSats };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const limiter = await rateLimiters.payment(req as any);
  if (limiter) {
    return res.status(429).json(JSON.parse(await limiter.text()));
  }

  const auth = await verifyNostrAuth(req);
  if (!auth.authorized || !auth.pubkey) {
    return res
      .status(401)
      .json({ error: auth.error || "Authentication required" });
  }

  const signedHeader = req.headers["x-nostr-auth-event"] as string | undefined;
  if (!signedHeader?.trim()) {
    return res.status(400).json({ error: "X-Nostr-Auth-Event header required" });
  }

  let parsedEvent: any;
  try {
    const decoded = Buffer.from(signedHeader, "base64").toString("utf-8");
    parsedEvent = JSON.parse(decoded);
  } catch {
    return res.status(400).json({ error: "Invalid X-Nostr-Auth-Event" });
  }

  const { validateEvent, verifySignature } = await import("nostr-tools");
  if (!validateEvent(parsedEvent) || !verifySignature(parsedEvent)) {
    return res.status(400).json({ error: "Invalid repository announcement" });
  }

  if (parsedEvent.pubkey?.toLowerCase() !== auth.pubkey.toLowerCase()) {
    return res.status(403).json({ error: "Event pubkey does not match auth" });
  }

  const parsed = parsePushPolicyFromAuthEvent(parsedEvent);
  if (!parsed) {
    return res.status(400).json({ error: "Announcement missing d tag" });
  }

  if (!(await ensureSqlite())) {
    return res.status(503).json({ error: "sqlite3 not available on server" });
  }

  const dbPath = await resolveBridgeDbPath();
  if (!dbPath || !existsSync(dbPath)) {
    return res.status(503).json({ error: "Bridge database not available" });
  }

  const owner = auth.pubkey.toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const query = `INSERT INTO RepositoryPushPolicy (OwnerPubKey,RepositoryName,PushCostSats,UpdatedAt) VALUES ('${escSql(
    owner
  )}','${escSql(parsed.repoName)}',${parsed.pushCostSats},${now}) ON CONFLICT(OwnerPubKey,RepositoryName) DO UPDATE SET PushCostSats=${parsed.pushCostSats},UpdatedAt=${now}`;

  try {
    await runSql(dbPath, query);
  } catch (e: any) {
    return res.status(500).json({
      error: e?.message || "Failed to update RepositoryPushPolicy",
    });
  }

  return res.status(200).json({
    ok: true,
    ownerPubkey: owner,
    repositoryName: parsed.repoName,
    pushCostSats: parsed.pushCostSats,
  });
}
