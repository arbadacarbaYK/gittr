"use client";

import { useEffect, useState } from "react";

type PushPaywallStatusProps = {
  entity: string;
  repo: string;
  ownerPubkey: string;
  payerPubkey: string | null;
};

type PushPaywallStatusData = {
  pushCostSats: number;
  authorized: boolean;
};

export function PushPaywallStatus({
  entity,
  repo,
  ownerPubkey,
  payerPubkey,
}: PushPaywallStatusProps) {
  const [data, setData] = useState<PushPaywallStatusData | null>(null);

  useEffect(() => {
    if (!payerPubkey || !ownerPubkey) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/nostr/repo/push-payment?ownerPubkey=${encodeURIComponent(
            ownerPubkey
          )}&repo=${encodeURIComponent(repo)}&payerPubkey=${encodeURIComponent(
            payerPubkey
          )}`
        );
        if (!res.ok) return;
        const json = (await res.json());
        const next: PushPaywallStatusData = {
          pushCostSats:
            typeof json.pushCostSats === "number" ? json.pushCostSats : 0,
          authorized: !!json.authorized,
        };
        if (!cancelled) setData(next);
      } catch {
        // Ignore; this is a non-critical hint UI.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [entity, repo, ownerPubkey, payerPubkey]);

  if (!data || data.pushCostSats <= 0) return null;

  if (data.authorized) {
    return (
      <p className="text-xs text-green-400 mt-1 whitespace-nowrap">
        One paid push is ready (single-use)
      </p>
    );
  }

  return (
    <p className="text-xs text-gray-500 mt-1 whitespace-nowrap">
      Push requires {data.pushCostSats.toLocaleString()} sats to authorize
    </p>
  );
}
