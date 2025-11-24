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
  });

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
}

