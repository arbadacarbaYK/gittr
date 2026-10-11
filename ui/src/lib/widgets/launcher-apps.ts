/**
 * Newest apps for the launcher tile, kept in memory after the first read
 * of the catalog snapshot. The phone must not re-parse that file.
 */
import { SOFTWARE_CATALOG_SNAPSHOT_PATH } from "@/lib/nostr/software-catalog-snapshot";
import { loadSoftwareCatalogSnapshot } from "@/lib/nostr/software-catalog-snapshot";
import type { LauncherAppSource } from "@/lib/widgets/launcher-feed";

import fs from "fs/promises";

let cache: { mtimeMs: number; apps: LauncherAppSource[] } | null = null;

export async function loadLauncherApps(): Promise<LauncherAppSource[]> {
  let mtimeMs = 0;
  try {
    mtimeMs = (await fs.stat(SOFTWARE_CATALOG_SNAPSHOT_PATH)).mtimeMs;
  } catch {
    return [];
  }
  if (cache && cache.mtimeMs === mtimeMs) return cache.apps;
  const snap = await loadSoftwareCatalogSnapshot();
  const apps: LauncherAppSource[] = (snap?.apps || []).map((app) => ({
    pubkey: app.pubkey,
    appId: app.appId,
    name: app.name,
    summary: app.summary,
    repository: app.repository,
    topics: app.topics,
    platformHints: app.platformHints,
    createdAt: app.createdAt,
  }));
  cache = { mtimeMs, apps };
  return apps;
}
