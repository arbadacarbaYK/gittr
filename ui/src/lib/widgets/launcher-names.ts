/**
 * Display names for launcher tiles. Cached on disk so a phone poll
 * does not hit profile relays. Empty string means we looked and found none.
 */
import { fetchPrimalUserProfiles } from "@/lib/nostr/primal-user-profile";
import { labelFromProfile } from "@/lib/widgets/launcher-feed";

import path from "path";

import fs from "fs/promises";

export const LAUNCHER_NAMES_PATH = path.join(
  process.cwd(),
  "data",
  "launcher-widget-names.json"
);

const NAME_TTL_MS = 12 * 60 * 60 * 1000;

type NameCache = {
  at: number;
  names: Record<string, string>;
};

function hexList(pubkeys: string[]): string[] {
  return [
    ...new Set(
      pubkeys
        .map((pk) => pk.trim().toLowerCase())
        .filter((pk) => /^[0-9a-f]{64}$/.test(pk))
    ),
  ];
}

async function readCache(): Promise<NameCache | null> {
  try {
    const raw = await fs.readFile(LAUNCHER_NAMES_PATH, "utf8");
    const parsed = JSON.parse(raw) as NameCache;
    if (!parsed || typeof parsed.at !== "number" || !parsed.names) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(cache: NameCache): Promise<void> {
  await fs.mkdir(path.dirname(LAUNCHER_NAMES_PATH), { recursive: true });
  const tmp = `${LAUNCHER_NAMES_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(cache), "utf8");
  await fs.rename(tmp, LAUNCHER_NAMES_PATH);
}

export async function resolveDisplayNames(
  pubkeys: string[]
): Promise<Record<string, string>> {
  const want = hexList(pubkeys);
  const cached = await readCache();
  const fresh = !!cached && Date.now() - cached.at < NAME_TTL_MS;
  const known = cached?.names || {};
  const missing = want.filter((pk) => !fresh || !(pk in known));
  if (missing.length === 0) {
    return pick(known, want);
  }

  const next: Record<string, string> = { ...known };
  try {
    const fetched = await fetchPrimalUserProfiles(missing);
    for (const pk of missing) {
      next[pk] = labelFromProfile(fetched[pk] || null);
    }
    await writeCache({ at: Date.now(), names: next });
  } catch {
    /* keep whatever names we already had */
  }
  return pick(next, want);
}

function pick(
  names: Record<string, string>,
  pubkeys: string[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pk of pubkeys) {
    const label = names[pk];
    if (label) out[pk] = label;
  }
  return out;
}
