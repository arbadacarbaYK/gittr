import { existsSync, readFileSync } from "fs";

/**
 * Absolute path to the git-nostr-bridge SQLite DB (RepositoryPushPolicy, etc.).
 *
 * Resolution order:
 * 1. `GIT_NOSTR_BRIDGE_DB` — use when Next.js and the bridge run as different Unix users
 *    so `$HOME/.config/...` would point at the wrong file.
 * 2. `/home/git-nostr/.config/git-nostr/git-nostr-bridge.json` — typical production layout
 *    (checked before `$HOME` so a deploy user with a stray config does not shadow the bridge).
 * 3. `$HOME/.config/git-nostr/git-nostr-bridge.json`
 * 4. `$HOME/.config/git-nostr/git-nostr-db.sqlite` if no JSON was usable
 */
export function resolveBridgeDbPath(): string | null {
  const fromEnv = process.env.GIT_NOSTR_BRIDGE_DB?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  const configPaths = [
    "/home/git-nostr/.config/git-nostr/git-nostr-bridge.json",
    ...(process.env.HOME
      ? [`${process.env.HOME}/.config/git-nostr/git-nostr-bridge.json`]
      : []),
  ];

  for (const configPath of configPaths) {
    try {
      if (existsSync(configPath)) {
        const configContent = readFileSync(configPath, "utf-8");
        const config = JSON.parse(configContent) as { DbFile?: unknown };
        if (config.DbFile && typeof config.DbFile === "string") {
          const homeDir = configPath.includes("/home/git-nostr")
            ? "/home/git-nostr"
            : process.env.HOME || "";
          return config.DbFile.replace(/^~/, homeDir);
        }
      }
    } catch {
      // Try next config path.
    }
  }

  if (process.env.HOME) {
    return `${process.env.HOME}/.config/git-nostr/git-nostr-db.sqlite`;
  }
  return null;
}
