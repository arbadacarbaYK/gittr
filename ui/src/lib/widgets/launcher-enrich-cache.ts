/**
 * On-disk star and description cache for the launcher tiles.
 * Reading this file does not open relays.
 */
import path from "path";

import fs from "fs/promises";

export const LAUNCHER_ENRICH_PATH = path.join(
  process.cwd(),
  "data",
  "launcher-widget-enrich.json"
);

const ENRICH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type LauncherEnrichCache = {
  at: number;
  repos: Record<
    string,
    {
      description: string;
      nostrStars: number | null;
      githubStars: number | null;
    }
  >;
  apps: Record<
    string,
    {
      nostrStars: number | null;
      githubStars: number | null;
    }
  >;
};

export async function loadLauncherEnrichCache(): Promise<LauncherEnrichCache | null> {
  try {
    const raw = await fs.readFile(LAUNCHER_ENRICH_PATH, "utf8");
    const parsed = JSON.parse(raw) as LauncherEnrichCache;
    if (!parsed || typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > ENRICH_MAX_AGE_MS) return null;
    if (!parsed.repos || !parsed.apps) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveLauncherEnrichCache(
  cache: LauncherEnrichCache
): Promise<void> {
  await fs.mkdir(path.dirname(LAUNCHER_ENRICH_PATH), { recursive: true });
  const tmp = `${LAUNCHER_ENRICH_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(cache), "utf8");
  await fs.rename(tmp, LAUNCHER_ENRICH_PATH);
}
