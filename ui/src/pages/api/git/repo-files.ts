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
  ok?: boolean;
  files?: Array<{ type: string; path: string; size?: number }>;
  defaultBranch?: string;
  message?: string;
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

function normalizeCloneUrl(sourceUrl: string): string {
  let cloneUrl = sourceUrl.trim();
  if (cloneUrl.startsWith("git@")) {
    return cloneUrl;
  }
  if (cloneUrl.startsWith("git://")) {
    return cloneUrl.replace(/^git:\/\//, "https://");
  }
  if (!cloneUrl.startsWith("http://") && !cloneUrl.startsWith("https://")) {
    return `https://${cloneUrl}`;
  }
  return cloneUrl;
}

function isSafeRemoteUrl(url: string): boolean {
  try {
    const u = new URL(
      url.startsWith("git@")
        ? (() => {
            const m = url.match(/^git@([^:]+):(.+)$/);
            return m ? `https://${m[1]}/${m[2]}` : url;
          })()
        : normalizeCloneUrl(url)
    );
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    if (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h.endsWith(".local") ||
      h === "0.0.0.0"
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function sanitizeBranch(branch: string | undefined): string {
  const b = (branch || "main").trim();
  if (!b || b.length > 256) return "main";
  if (!/^[\w./-]+$/.test(b)) return "main";
  return b;
}

async function cloneShallowAndListFiles(
  sourceUrl: string,
  branch: string
): Promise<{ files: Data["files"]; defaultBranch: string } | null> {
  const tempDir = path.join(
    tmpdir(),
    `gittr-repofiles-${Date.now()}-${Math.random().toString(36).substring(7)}`
  );

  const cloneUrl = normalizeCloneUrl(sourceUrl);
  const attemptUrls = [...new Set(buildCloneAttemptUrls(cloneUrl))];
  let cloneOk = false;
  let lastErr: unknown = null;

  const tryClone = async (cmd: string) => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });
    await execAsync(cmd, { timeout: 90000 });
  };

  const safeBr = sanitizeBranch(branch);

  for (const attempt of attemptUrls) {
    const withBranch = `git clone --depth 1 --branch ${JSON.stringify(
      safeBr
    )} ${JSON.stringify(attempt)} ${JSON.stringify(tempDir)}`;
    const noBranch = `git clone --depth 1 ${JSON.stringify(
      attempt
    )} ${JSON.stringify(tempDir)}`;
    for (const cmd of [withBranch, noBranch]) {
      try {
        await tryClone(cmd);
        cloneOk = true;
        break;
      } catch (err) {
        lastErr = err;
        try {
          if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
          }
        } catch {
          /* ignore */
        }
      }
    }
    if (cloneOk) break;
  }

  if (!cloneOk) {
    console.error("[repo-files] clone failed:", attemptUrls, lastErr);
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  try {
    let defaultBranch = "main";
    try {
      const { stdout: branchOutput } = await execAsync(
        `git -C ${JSON.stringify(tempDir)} rev-parse --abbrev-ref HEAD`,
        { timeout: 5000 }
      );
      defaultBranch = branchOutput.trim() || "main";
    } catch {
      /* keep default */
    }

    const { stdout: lsOut } = await execAsync(
      `git -C ${JSON.stringify(tempDir)} ls-tree -r -l HEAD`,
      { timeout: 60000 }
    );

    const files: NonNullable<Data["files"]> = [];
    for (const line of lsOut.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const tab = trimmed.lastIndexOf("\t");
      if (tab === -1) continue;
      const metaPart = trimmed.slice(0, tab);
      const filePath = trimmed.slice(tab + 1);
      const meta = metaPart.split(/\s+/);
      if (meta.length < 4 || !filePath) continue;
      const objType = meta[1];
      const sizeStr = meta[3];
      if (objType !== "blob") continue;
      const size =
        sizeStr && sizeStr !== "-" ? parseInt(sizeStr, 10) : undefined;
      files.push({
        type: "file",
        path: filePath,
        size: Number.isFinite(size) ? size : undefined,
      });
    }

    const dirSet = new Set<string>();
    for (const f of files) {
      let d = path.posix.dirname(f.path);
      while (d && d !== ".") {
        dirSet.add(d);
        d = path.posix.dirname(d);
      }
    }
    const dirEntries = [...dirSet].map((p) => ({
      type: "dir" as const,
      path: p,
    }));
    const merged = [...dirEntries, ...files].sort((a, b) =>
      a.path.localeCompare(b.path)
    );

    fs.rmSync(tempDir, { recursive: true, force: true });
    return { files: merged, defaultBranch };
  } catch (e) {
    console.error("[repo-files] ls-tree failed:", e);
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    return null;
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

  if (req.method !== "GET") {
    return res.status(405).json({ message: "method_not_allowed" });
  }

  const sourceUrlRaw = req.query.sourceUrl;
  const sourceUrl =
    typeof sourceUrlRaw === "string"
      ? sourceUrlRaw
      : Array.isArray(sourceUrlRaw)
      ? sourceUrlRaw[0]
      : "";

  const branchRaw = req.query.branch;
  const branch =
    typeof branchRaw === "string"
      ? branchRaw
      : Array.isArray(branchRaw)
      ? branchRaw[0] ?? "main"
      : "main";

  if (!sourceUrl || typeof sourceUrl !== "string") {
    return res.status(400).json({ message: "sourceUrl required" });
  }

  if (!isSafeRemoteUrl(sourceUrl)) {
    return res.status(400).json({ message: "invalid or blocked remote URL" });
  }

  try {
    const result = await cloneShallowAndListFiles(sourceUrl, branch);
    if (!result || !result.files) {
      return res.status(502).json({
        ok: false,
        message: "clone_or_list_failed",
      });
    }
    return res.status(200).json({
      ok: true,
      files: result.files,
      defaultBranch: result.defaultBranch,
    });
  } catch (e: any) {
    console.error("[repo-files] error:", e);
    return res.status(500).json({
      message: e?.message || "error",
    });
  }
}
