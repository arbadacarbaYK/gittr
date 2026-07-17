/**
 * Server-side helpers for crawler-safe repository preview images (Telegram, X, etc.).
 * Social crawlers need a URL that returns raw image bytes — not the JSON file-content API.
 */
import { KIND_REPOSITORY, KIND_REPOSITORY_NIP34 } from "@/lib/nostr/events";

import { exec } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

const LOGO_CANDIDATES = [
  "logo.png",
  "logo.jpg",
  "logo.jpeg",
  "logo.webp",
  "logo.svg",
  "Logo.png",
];

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|ico)(\?|$)/i;

export function resolveBridgeReposDir(): string | null {
  const fromEnv = process.env.GIT_NOSTR_REPOS_DIR?.trim();
  if (fromEnv) return fromEnv;

  const configPaths = [
    "/home/git-nostr/.config/git-nostr/git-nostr-bridge.json",
    ...(process.env.HOME
      ? [`${process.env.HOME}/.config/git-nostr/git-nostr-bridge.json`]
      : []),
  ];

  for (const configPath of configPaths) {
    try {
      if (!existsSync(configPath)) continue;
      const config = JSON.parse(readFileSync(configPath, "utf-8")) as {
        RepositoryDir?: unknown;
      };
      if (typeof config.RepositoryDir === "string" && config.RepositoryDir) {
        const homeDir = configPath.includes("/home/git-nostr")
          ? "/home/git-nostr"
          : process.env.HOME || "";
        return config.RepositoryDir.replace(/^~/, homeDir);
      }
    } catch {
      // try next
    }
  }

  if (process.env.HOME) {
    return `${process.env.HOME}/git-nostr-repositories`;
  }
  return null;
}

function cleanRepoName(repoName: string): string {
  let name = repoName;
  if (name.includes("%")) {
    try {
      name = decodeURIComponent(name);
    } catch {
      // keep original
    }
  }
  if (name.includes("/")) {
    const parts = name.split("/");
    name = parts[parts.length - 1] || name;
  }
  return name.replace(/\.git$/, "");
}

function contentTypeForPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".ico")) return "image/x-icon";
  return "application/octet-stream";
}

/** Read logo bytes from a bare repo on the bridge host, if present. */
export async function readRepoLogoFromBridge(
  ownerPubkey: string,
  repoName: string
): Promise<{ buffer: Buffer; path: string; contentType: string } | null> {
  const reposDir = resolveBridgeReposDir();
  if (!reposDir) return null;

  const clean = cleanRepoName(repoName);
  const repoPath = join(reposDir, ownerPubkey.toLowerCase(), `${clean}.git`);
  if (!existsSync(repoPath)) return null;

  try {
    await execAsync(`git --git-dir="${repoPath}" rev-parse --verify HEAD`, {
      timeout: 5000,
    });
  } catch {
    return null;
  }

  const branches = ["main", "master"];
  for (const branch of branches) {
    for (const logoPath of LOGO_CANDIDATES) {
      try {
        const escapedBranch = branch.replace(/"/g, '\\"');
        const escapedPath = logoPath.replace(/"/g, '\\"');
        const { stdout } = await execAsync(
          `git --git-dir="${repoPath}" show "${escapedBranch}:${escapedPath}"`,
          {
            timeout: 8000,
            maxBuffer: 5 * 1024 * 1024,
            encoding: "buffer" as any,
          }
        );
        const buffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
        if (buffer.length > 0) {
          return {
            buffer,
            path: logoPath,
            contentType: contentTypeForPath(logoPath),
          };
        }
      } catch {
        // try next candidate
      }
    }
  }
  return null;
}

/** First image-like HTTPS URL from kind 30617 web tags (logo in announcement). */
export async function fetchRepoLogoUrlFromNostr(
  ownerPubkey: string,
  repoName: string,
  timeoutMs = 1200
): Promise<string | null> {
  const clean = cleanRepoName(repoName);
  try {
    const { RelayPool } = await import("nostr-relaypool");
    const relays = [
      "wss://relay.damus.io",
      "wss://relay.nostr.band",
      "wss://nos.lol",
      "wss://relay.ngit.dev",
      "wss://relay.primal.net",
    ];
    const pool = new RelayPool(relays);

    return await new Promise<string | null>((resolve) => {
      let settled = false;
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        try {
          pool.close();
        } catch {
          /* ignore */
        }
        resolve(value);
      };

      const timer = setTimeout(() => finish(null), timeoutMs);

      try {
        pool.subscribe(
          [
            {
              kinds: [KIND_REPOSITORY, KIND_REPOSITORY_NIP34],
              authors: [ownerPubkey.toLowerCase()],
              "#d": [clean],
              limit: 1,
            },
          ],
          relays,
          (event: { tags?: string[][] }) => {
            clearTimeout(timer);
            const webUrls: string[] = [];
            for (const tag of event.tags || []) {
              if (tag[0] === "web") {
                for (let i = 1; i < tag.length; i++) {
                  const v = tag[i];
                  if (typeof v === "string" && v.startsWith("https://")) {
                    webUrls.push(v);
                  }
                }
              }
            }
            const imageUrl = webUrls.find((u) => IMAGE_EXT.test(u));
            finish(imageUrl || null);
          },
          undefined,
          () => {
            clearTimeout(timer);
            finish(null);
          }
        );
      } catch {
        clearTimeout(timer);
        finish(null);
      }
    });
  } catch {
    return null;
  }
}
