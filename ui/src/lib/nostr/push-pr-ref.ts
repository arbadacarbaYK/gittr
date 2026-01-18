export interface PushPrRefParams {
  ownerPubkey: string;
  repo: string;
  eventId: string;
  commitId?: string;
  sourceRef?: string;
}

export interface PushPrRefResult {
  success: boolean;
  refName?: string;
  commitId?: string;
  error?: string;
}

export async function pushPrRef({
  ownerPubkey,
  repo,
  eventId,
  commitId,
  sourceRef,
}: PushPrRefParams): Promise<PushPrRefResult> {
  if (!ownerPubkey || !repo || !eventId) {
    return {
      success: false,
      error: "Missing ownerPubkey, repo, or eventId",
    };
  }

  try {
    const response = await fetch("/api/nostr/repo/push-ref", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ownerPubkey,
        repo,
        refName: `refs/nostr/${eventId}`,
        commitId,
        sourceRef,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return {
        success: false,
        error: data.error || `Push ref failed (${response.status})`,
      };
    }

    const data = await response.json();
    return {
      success: true,
      refName: data.refName,
      commitId: data.commitId,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || "Push ref failed",
    };
  }
}
