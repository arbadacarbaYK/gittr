import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";

import { existsSync } from "fs";
import type { NextApiRequest, NextApiResponse } from "next";
import os from "os";
import { join } from "path";

import { rm } from "fs/promises";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === "OPTIONS") {
    return handleOptionsRequest(res);
  }

  setCorsHeaders(res);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { pushSessionId } = req.body || {};

  if (!pushSessionId || typeof pushSessionId !== "string") {
    return res.status(400).json({ error: "pushSessionId is required" });
  }

  // CRITICAL: Clean up shared working directory for a failed push session
  // This is called from the client when a chunk fails (network timeout, connection loss, etc.)
  // to prevent orphaned temp directories from accumulating
  const tempDir = join(os.tmpdir(), `gittr-push-${pushSessionId}`);

  try {
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
      console.log(
        `🧹 [Bridge Push Cleanup] Cleaned up working directory for failed push session: ${pushSessionId}`
      );
      return res.status(200).json({
        success: true,
        message: "Working directory cleaned up",
        pushSessionId,
      });
    } else {
      console.log(
        `📝 [Bridge Push Cleanup] Working directory not found (may have been cleaned up already): ${pushSessionId}`
      );
      return res.status(200).json({
        success: true,
        message: "Working directory not found (already cleaned up)",
        pushSessionId,
      });
    }
  } catch (error: any) {
    console.error(
      `❌ [Bridge Push Cleanup] Failed to clean up working directory:`,
      error?.message
    );
    return res.status(500).json({
      error: error?.message || "Failed to clean up working directory",
      pushSessionId,
    });
  }
}
