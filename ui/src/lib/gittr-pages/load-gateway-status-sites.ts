import { parseGatewayManifestsJson } from "@/lib/gittr-pages/gateway-manifests-json";
import { filterBrowsableGatewaySites } from "@/lib/gittr-pages/gateway-site-browseability";
import type { GatewayStatusSiteRow } from "@/lib/gittr-pages/parse-gateway-status-html";
import {
  parseGatewayStatusHtml,
  parseGatewayStatusMeta,
} from "@/lib/gittr-pages/parse-gateway-status-html";
import { filterGatewaySitesByPublisherBlocklist } from "@/lib/moderation/publisher-blocklist";

import { readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

export type GatewayStatusSitesOk = {
  pagesBase: string;
  statusUrl: string;
  manifestsUrl: string;
  source: "json" | "html";
  sites: GatewayStatusSiteRow[];
  meta: { siteCount: number | null; generatedAt: string | null };
};

export type GatewayStatusSitesErr = {
  error: string;
  statusUrl: string;
  manifestsUrl: string;
  status: number;
};

/** How long a copy is "fresh" before the next request refreshes it in the background. */
const FRESH_MS = 5 * 60_000;
/** Disk copy survives a process restart so the first visitor is not stuck on a cold download. */
const DISK_MAX_AGE_MS = 30 * 60_000;
const DISK_PATH = join(tmpdir(), "gittr-pages-directory.json");

type MemoryCache = { expires: number; payload: GatewayStatusSitesOk };

let memory: MemoryCache | null = null;
let inflight: Promise<GatewayStatusSitesOk | GatewayStatusSitesErr> | null =
  null;
let diskRead: Promise<GatewayStatusSitesOk | null> | null = null;

export function gittrPagesGatewayBase(): string {
  return (
    process.env.NEXT_PUBLIC_GITTR_PAGES_URL || "https://pages.gittr.space"
  ).replace(/\/$/, "");
}

function pagesBase(): string {
  return gittrPagesGatewayBase();
}

/** Test hook */
export function resetGatewayStatusSitesCacheForTests(): void {
  memory = null;
  inflight = null;
  diskRead = null;
}

function remember(payload: GatewayStatusSitesOk): void {
  memory = { expires: Date.now() + FRESH_MS, payload };
  void writeFile(
    DISK_PATH,
    JSON.stringify({ savedAt: Date.now(), payload })
  ).catch(() => {
    /* a full disk must not break the directory */
  });
}

async function readDiskCache(): Promise<GatewayStatusSitesOk | null> {
  try {
    const raw = await readFile(DISK_PATH, "utf8");
    const parsed = JSON.parse(raw) as {
      savedAt?: number;
      payload?: GatewayStatusSitesOk;
    };
    if (
      !parsed?.payload?.sites ||
      typeof parsed.savedAt !== "number" ||
      Date.now() - parsed.savedAt > DISK_MAX_AGE_MS
    ) {
      return null;
    }
    return parsed.payload;
  } catch {
    return null;
  }
}

/**
 * Parsed, blocklisted, browsable directory.
 * The gateway file is a few megabytes and can take well over ten seconds
 * to build. Visitors get the last good copy immediately; a refresh runs
 * behind that response. `fresh` (right after Push Manifest) waits for a
 * new download.
 */
export async function loadGatewayStatusSites(opts?: {
  fresh?: boolean;
}): Promise<GatewayStatusSitesOk | GatewayStatusSitesErr> {
  const fresh = opts?.fresh === true;
  const now = Date.now();
  if (!fresh && memory && memory.expires > now) {
    return memory.payload;
  }

  if (!fresh && !memory) {
    if (!diskRead) diskRead = readDiskCache();
    const fromDisk = await diskRead;
    diskRead = null;
    if (fromDisk) {
      memory = { expires: 0, payload: fromDisk };
    }
  }

  if (!fresh && memory) {
    void startDirectoryRefresh();
    return memory.payload;
  }

  return startDirectoryRefresh();
}

function startDirectoryRefresh(): Promise<
  GatewayStatusSitesOk | GatewayStatusSitesErr
> {
  if (!inflight) {
    inflight = fetchDirectory().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

async function fetchDirectory(): Promise<
  GatewayStatusSitesOk | GatewayStatusSitesErr
> {
  const base = pagesBase();
  const statusUrl = `${base}/status`;
  const manifestsUrl = `${base}/status/manifests.json`;
  const jsonHeaders = { Accept: "application/json" } as const;
  const htmlHeaders = { Accept: "text/html" } as const;
  /**
   * Always `no-store`. Next’s Data Cache cannot store this JSON once it
   * exceeds 2MB, so `next: { revalidate: 120 }` kept serving a Sep-9 dump
   * forever while pages.gittr.space already had new sites.
   */
  const jsonFetch = {
    headers: jsonHeaders,
    cache: "no-store" as const,
  };
  const htmlFetch = {
    headers: htmlHeaders,
    cache: "no-store" as const,
  };

  try {
    const jsonRes = await fetch(manifestsUrl, jsonFetch);

    let payload: GatewayStatusSitesOk;

    if (jsonRes.ok) {
      const raw = await jsonRes.json();
      const { sites, meta } = parseGatewayManifestsJson(raw, base);
      const sitesFiltered = filterBrowsableGatewaySites(
        filterGatewaySitesByPublisherBlocklist(sites)
      );
      payload = {
        pagesBase: base,
        statusUrl,
        manifestsUrl,
        source: "json",
        sites: sitesFiltered,
        meta: {
          ...meta,
          siteCount: sitesFiltered.length,
        },
      };
    } else {
      const res = await fetch(statusUrl, htmlFetch);

      if (!res.ok) {
        return {
          error: `Gateway returned ${res.status} (JSON and HTML status both failed)`,
          statusUrl,
          manifestsUrl,
          status: 502,
        };
      }

      const html = await res.text();
      const sites = filterBrowsableGatewaySites(
        filterGatewaySitesByPublisherBlocklist(
          parseGatewayStatusHtml(html, base)
        )
      );
      const meta = parseGatewayStatusMeta(html);
      payload = {
        pagesBase: base,
        statusUrl,
        manifestsUrl,
        source: "html",
        sites,
        meta: { ...meta, siteCount: sites.length },
      };
    }

    remember(payload);
    return payload;
  } catch (e: unknown) {
    if (memory) return memory.payload;
    const message = e instanceof Error ? e.message : String(e);
    return { error: message, statusUrl, manifestsUrl, status: 500 };
  }
}
