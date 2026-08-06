import { getBridgeAuthHeaders } from "./bridge-auth";

export type SyncFromSourceResult = {
  success: boolean;
  syncedFrom?: string;
  branch?: string;
  headCommit?: string | null;
  refs?: Array<{ ref: string; commit: string }>;
  error?: string;
  details?: string;
};

/**
 * Force the bridge bare mirror to match an upstream forge tip (exact SHAs).
 */
export async function syncBridgeFromSource(opts: {
  ownerPubkey: string;
  repo: string;
  sourceUrl: string;
  branch?: string;
  pubkey: string;
  signer: (event: any) => Promise<any>;
  authEvent?: any;
}): Promise<SyncFromSourceResult> {
  const headers = await getBridgeAuthHeaders(opts.pubkey, opts.signer);
  headers.set("Content-Type", "application/json");
  if (opts.authEvent) {
    try {
      const b64 =
        typeof btoa === "function"
          ? btoa(unescape(encodeURIComponent(JSON.stringify(opts.authEvent))))
          : Buffer.from(JSON.stringify(opts.authEvent), "utf8").toString(
              "base64"
            );
      headers.set("X-Nostr-Auth-Event", b64);
    } catch {
      // keep Authorization header only
    }
  }

  const res = await fetch("/api/nostr/repo/sync-from-source", {
    method: "POST",
    headers,
    body: JSON.stringify({
      ownerPubkey: opts.ownerPubkey,
      repo: opts.repo,
      sourceUrl: opts.sourceUrl,
      branch: opts.branch,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as SyncFromSourceResult & {
    error?: string;
    details?: string;
  };
  if (!res.ok) {
    return {
      success: false,
      error: json.error || `HTTP ${res.status}`,
      details: json.details,
    };
  }
  return { success: true, ...json };
}
