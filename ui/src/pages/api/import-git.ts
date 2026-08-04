import { rateLimiters } from "@/app/api/middleware/rate-limit";
import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import { assertSafeOutboundGitUrl } from "@/lib/security/safe-remote-url";
import {
  normalizeGitCloneUrl,
  parseOwnerRepoFromGitUrl,
} from "@/lib/utils/detect-git-forge";

import { exec } from "child_process";
import * as fs from "fs";
import type { NextApiRequest, NextApiResponse } from "next";
import { tmpdir } from "os";
import * as path from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

/** Vercel / long-running host — git clone can be slow */
export const maxDuration = 300;

const MAX_RESPONSE_BYTES = 3_500_000;

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
  sourceUrl?: string;
};

/** Many hosts require an explicit `.git` suffix; try it if the first clone fails. */
function buildCloneAttemptUrls(cloneUrl: string): string[] {
  const out: string[] = [cloneUrl];
  if (cloneUrl.startsWith("https://") || cloneUrl.startsWith("http://")) {
    const trimmed = cloneUrl.replace(/\/+$/, "");
    if (!trimmed.endsWith(".git")) {
      out.push(`${trimmed}.git`);
    }
  } else if (cloneUrl.startsWith("git@") && !cloneUrl.endsWith(".git")) {
    out.push(`${cloneUrl}.git`);
  }
  return out;
}

function cloneErrorMessage(err: unknown): string {
  if (!err) return "Unknown clone error";
  if (err instanceof Error) {
    const anyErr = err as Error & { stderr?: string; stdout?: string };
    const stderr = (anyErr.stderr || "").toString().trim();
    if (stderr) return stderr.slice(0, 500);
    return err.message;
  }
  return String(err);
}

/**
 * Clone repository and extract metadata (paths + README).
 * Does not embed per-file contents (same model as GitHub `/api/import`) —
 * the UI fetches files later from sourceUrl.
 */
async function cloneAndExtractFiles(sourceUrl: string): Promise<{
  files: Array<{
    type: string;
    path: string;
    size?: number;
    isBinary?: boolean;
  }>;
  readme?: string;
  defaultBranch?: string;
  branches?: string[];
  cloneUrlUsed: string;
}> {
  const tempDir = path.join(
    tmpdir(),
    `gittr-import-${Date.now()}-${Math.random().toString(36).substring(7)}`
  );

  const cloneUrl = normalizeGitCloneUrl(sourceUrl);
  const attemptUrls = [...new Set(buildCloneAttemptUrls(cloneUrl))];
  console.log(`🔍 [Import Git] Clone attempts: ${attemptUrls.join(" | ")}`);

  let lastCloneError: unknown = null;
  let cloneOk = false;
  let cloneUrlUsed = cloneUrl;

  try {
    for (const attempt of attemptUrls) {
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
        fs.mkdirSync(tempDir, { recursive: true });
        const result = await execAsync(
          `git clone --depth 1 "${attempt}" "${tempDir}"`,
          { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }
        );
        const stderr = result.stderr || "";
        if (
          stderr &&
          !stderr.includes("Cloning into") &&
          !stderr.includes("warning")
        ) {
          console.warn("Git clone stderr:", stderr);
        }
        cloneOk = true;
        cloneUrlUsed = attempt;
        break;
      } catch (err) {
        lastCloneError = err;
        console.warn(`⚠️ [Import Git] Clone failed for ${attempt}:`, err);
      }
    }

    if (!cloneOk) {
      throw new Error(
        `Failed to clone repository. ${cloneErrorMessage(lastCloneError)}`
      );
    }

    let defaultBranch = "main";
    try {
      const { stdout: branchOutput } = await execAsync(
        `git -C "${tempDir}" rev-parse --abbrev-ref HEAD`,
        { timeout: 5000 }
      );
      defaultBranch = branchOutput.trim() || "main";
    } catch {
      /* default main */
    }

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
        .slice(0, 50);
      if (branches.length === 0) branches = [defaultBranch];
    } catch {
      /* keep default */
    }

    const files: Array<{
      type: string;
      path: string;
      size?: number;
      isBinary?: boolean;
    }> = [];
    let readme: string | undefined;

    function walkDir(dir: string, basePath = "") {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
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
          if (
            entry.name.toLowerCase().match(/^readme(\.(md|txt|rst))?$/i) &&
            !readme &&
            size < 512 * 1024
          ) {
            try {
              readme = fs.readFileSync(fullPath, "utf-8");
            } catch {
              /* skip */
            }
          }
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
            ".wasm",
          ];
          files.push({
            type: "file",
            path: relativePath,
            size,
            isBinary: size > 1024 * 1024 || binaryExts.includes(ext),
          });
        }
      }
    }

    walkDir(tempDir);
    fs.rmSync(tempDir, { recursive: true, force: true });

    return {
      files,
      readme,
      defaultBranch,
      branches,
      cloneUrlUsed,
    };
  } catch (error) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    throw error;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res, req);
    return;
  }

  setCorsHeaders(res, req);

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

  if (
    sourceUrl.includes("://") === false &&
    !sourceUrl.startsWith("git@") &&
    !sourceUrl.includes(".") &&
    !sourceUrl.includes("/")
  ) {
    return res.status(400).json({
      status: "invalid_url",
      message:
        "Local filesystem paths are not supported. Use an https:// or git@ URL.",
    });
  }

  const parsed = parseOwnerRepoFromGitUrl(sourceUrl);
  if (!parsed) {
    return res.status(400).json({
      status: "invalid_url",
      message:
        "Invalid git URL. Use a full HTTPS or SSH URL (e.g. https://gitlab.com/group/repo).",
    });
  }

  const urlSafety = await assertSafeOutboundGitUrl(sourceUrl);
  if (!urlSafety.ok) {
    return res.status(400).json({
      status: "blocked_url",
      message: urlSafety.error,
    });
  }

  const { owner, repo, host } = parsed;
  const slug = repo;

  try {
    const extracted = await cloneAndExtractFiles(sourceUrl);
    const payload: Data = {
      status: "completed",
      success: true,
      slug,
      repo,
      readme: extracted.readme,
      files: extracted.files,
      description: `Imported from ${host}${owner ? `/${owner}` : ""}/${repo}`,
      defaultBranch: extracted.defaultBranch,
      branches: extracted.branches,
      contributors: [],
      sourceUrl: extracted.cloneUrlUsed || normalizeGitCloneUrl(sourceUrl),
    };

    const approx = Buffer.byteLength(JSON.stringify(payload), "utf8");
    if (approx > MAX_RESPONSE_BYTES) {
      // Drop file list paths beyond a safe subset; keep README + metadata
      const capped = extracted.files.slice(0, 2000);
      payload.files = capped;
      payload.message =
        "Repository is large — imported metadata and README; files will load from the source URL.";
      const approx2 = Buffer.byteLength(JSON.stringify(payload), "utf8");
      if (approx2 > MAX_RESPONSE_BYTES) {
        payload.files = capped.slice(0, 200);
      }
    }

    return res.status(200).json(payload);
  } catch (error: any) {
    console.error("Import git error:", error);
    return res.status(500).json({
      status: "clone_failed",
      message:
        error?.message ||
        "Failed to clone repository. Check that the URL is public and reachable from the server.",
    });
  }
}
