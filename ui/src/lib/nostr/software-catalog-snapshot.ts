import type {
  ParsedSoftwareApp,
  ParsedSoftwareRelease,
} from "@/lib/nostr/nip82-software";

import path from "path";

import fs from "fs/promises";

export const SOFTWARE_CATALOG_SNAPSHOT_PATH = path.join(
  process.cwd(),
  "data",
  "software-catalog-snapshot.json"
);

export type SoftwareCatalogSnapshot = {
  at: number;
  apps: ParsedSoftwareApp[];
  releasesByApp: Record<string, ParsedSoftwareRelease[]>;
  releasesByAppId: Record<string, ParsedSoftwareRelease[]>;
  relayCount: number;
  zapstoreUntil?: number | null;
  zapstoreBackfillDone?: boolean;
};

export async function loadSoftwareCatalogSnapshot(): Promise<SoftwareCatalogSnapshot | null> {
  try {
    const raw = await fs.readFile(SOFTWARE_CATALOG_SNAPSHOT_PATH, "utf8");
    const parsed = JSON.parse(raw) as SoftwareCatalogSnapshot;
    if (!parsed || !Array.isArray(parsed.apps) || parsed.apps.length === 0) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function saveSoftwareCatalogSnapshot(
  snap: SoftwareCatalogSnapshot
): Promise<void> {
  if (!snap.apps.length) return;
  await fs.mkdir(path.dirname(SOFTWARE_CATALOG_SNAPSHOT_PATH), {
    recursive: true,
  });
  await fs.writeFile(
    SOFTWARE_CATALOG_SNAPSHOT_PATH,
    JSON.stringify({
      at: snap.at || Date.now(),
      apps: snap.apps,
      releasesByApp: snap.releasesByApp || {},
      releasesByAppId: snap.releasesByAppId || {},
      relayCount: snap.relayCount || 0,
      zapstoreUntil: snap.zapstoreUntil ?? null,
      zapstoreBackfillDone: !!snap.zapstoreBackfillDone,
    }),
    "utf8"
  );
}
