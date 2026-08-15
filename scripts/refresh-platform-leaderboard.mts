/**
 * Standalone homepage platform leaderboard builder (production).
 *
 * Heavy Nostr scans run OUTSIDE live Next.js — writes
 * `data/platform-leaderboard-snapshot.json` under the UI cwd.
 *
 * Production:
 *   WorkingDirectory=/opt/ngit/ui
 *   source ui/.env.local
 *   npx tsx /opt/ngit/scripts/refresh-platform-leaderboard.mts
 */

import { WebSocket as NodeWebSocket } from "../ui/node_modules/ws/wrapper.mjs";
(globalThis as { WebSocket?: typeof NodeWebSocket }).WebSocket = NodeWebSocket;

import { PLATFORM_STATS_RELAYS } from "../ui/src/lib/nostr/server-relay-subscribe";
import { PLATFORM_LEADERBOARD_SNAPSHOT_PATH } from "../ui/src/lib/platform-leaderboard-snapshot";
import { buildAndSavePlatformLeaderboard } from "../ui/src/lib/stats/build-platform-leaderboard";

async function main(): Promise<void> {
  const started = Date.now();
  console.log(
    `[platform-leaderboard] start relays=${PLATFORM_STATS_RELAYS.length} cwd=${process.cwd()} out=${PLATFORM_LEADERBOARD_SNAPSHOT_PATH}`
  );
  const snap = await buildAndSavePlatformLeaderboard();
  console.log(
    `[platform-leaderboard] ok topRepos=${snap.topRepos.length} topUsers=${snap.topUsers.length} recentRepos=${snap.recentRepos.length} activities=${snap.recentActivities.length} durationMs=${Date.now() - started} at=${snap.at}`
  );
}

main().catch((err: unknown) => {
  console.error("[platform-leaderboard] fatal", err);
  process.exitCode = 1;
});
