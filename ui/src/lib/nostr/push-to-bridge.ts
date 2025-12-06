import { BridgeFilePayload } from "@/lib/nostr/push-repo-to-nostr";
import { checkBridgeExists } from "@/lib/utils/repo-status";

interface PushBridgeParams {
  ownerPubkey: string;
  repoSlug: string;
  entity: string;
  branch?: string;
  files: BridgeFilePayload[];
}

export async function pushFilesToBridge({
  ownerPubkey,
  repoSlug,
  entity,
  branch = "main",
  files,
}: PushBridgeParams) {
  if (!ownerPubkey || !repoSlug || !files || files.length === 0) {
    return { skipped: true };
  }

  // CRITICAL: Add timeout for large repos (5 minutes max)
  const BRIDGE_PUSH_TIMEOUT = 300000; // 5 minutes
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BRIDGE_PUSH_TIMEOUT);

  try {
    const response = await fetch("/api/nostr/repo/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ownerPubkey,
        repo: repoSlug,
        branch,
        files,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Bridge push failed");
    }

    try {
      await checkBridgeExists(ownerPubkey, repoSlug, entity);
    } catch (error) {
      console.warn("Failed to verify bridge sync:", error);
    }

    return data;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Bridge push timeout after ${BRIDGE_PUSH_TIMEOUT / 1000} seconds. The repository may be too large. Try pushing fewer files at once.`);
    }
    throw error;
  }
}

