/**
 * Standalone SEO Nostr repo index builder (production).
 *
 * Discovers public NIP-34/51 repos on explore-class relays, writes
 * `data/nostr-seo-repos-snapshot.json` under the UI cwd, then exits.
 * Does NOT run inside the live Next.js process — systemd oneshot owns this.
 *
 * Production:
 *   WorkingDirectory=/opt/ngit/ui
 *   source ui/.env.local (NEXT_PUBLIC_NOSTR_RELAYS)
 *   npx tsx /opt/ngit/scripts/refresh-seo-repo-index.mts
 *
 * Lab mirror: systemd ExecStartPost copies the JSON next to /lab snapshot HTML.
 *
 * Manual:
 *   cd /opt/ngit/ui && set -a && . ./.env.local && set +a && \
 *     npx --yes tsx /opt/ngit/scripts/refresh-seo-repo-index.mts
 */

import { WebSocket as NodeWebSocket } from "../ui/node_modules/ws/wrapper.mjs";
// Node has no global WebSocket — without this, SimplePool silently finds 0 events.
(globalThis as { WebSocket?: typeof NodeWebSocket }).WebSocket = NodeWebSocket;

import {
  getSeoDiscoveryRelayUrls,
  fetchAndBuildSeoRepoIndex,
} from "../ui/src/lib/seo/nostr-sitemap-repos";
import {
  NOSTR_SEO_REPOS_SNAPSHOT_PATH,
  saveNostrSeoReposSnapshot,
} from "../ui/src/lib/seo/nostr-seo-repos-snapshot";

async function main(): Promise<void> {
  const started = Date.now();
  const relays = getSeoDiscoveryRelayUrls();
  console.log(
    `[seo-repo-index] start relays=${relays.length} cwd=${process.cwd()} out=${NOSTR_SEO_REPOS_SNAPSHOT_PATH}`
  );

  const paths = await fetchAndBuildSeoRepoIndex();
  if (paths.size === 0) {
    console.error(
      "[seo-repo-index] discovery returned 0 paths — leaving previous snapshot untouched"
    );
    process.exitCode = 1;
    return;
  }

  const snap = await saveNostrSeoReposSnapshot(paths);
  console.log(
    `[seo-repo-index] ok pathCount=${Object.keys(snap.paths).length} durationMs=${
      Date.now() - started
    } at=${snap.at}`
  );
}

main().catch((err: unknown) => {
  console.error("[seo-repo-index] fatal", err);
  process.exitCode = 1;
});
