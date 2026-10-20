/**
 * Give up on sign_event only when no relay accepted it and Amber has been
 * silent. A relay OK means the phone may still be showing Approve — dropping
 * the waiter throws away a signature that arrives a few seconds later.
 */
export function shouldAbortSilentSignEvent(opts: {
  inboundCount: number;
  waitedMs: number;
  publishSettled: boolean;
  publishAcked: boolean;
  silentAbortMs?: number;
}): boolean {
  const limit = opts.silentAbortMs ?? 20_000;
  if (opts.inboundCount > 0) return false;
  if (opts.waitedMs < limit) return false;
  if (!opts.publishSettled) return false;
  if (opts.publishAcked) return false;
  return true;
}

function bunkerRelayKey(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

/**
 * Relays that still need a kind 24133 subscription.
 * The page-load warm listens on the first open bunker socket. Push then
 * publishes the signing request on the rest. Replacing that first subscription
 * drops a reply already in flight, so new relays are added beside it.
 */
export function bunkerListenRelaysToAdd(
  alreadyListening: string[],
  wanted: string[]
): string[] {
  const have = new Set(
    (alreadyListening || [])
      .map(bunkerRelayKey)
      .filter((u) => u.startsWith("wss://"))
  );
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of wanted || []) {
    const key = bunkerRelayKey(raw);
    if (!key.startsWith("wss://") || have.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(raw.trim().replace(/\/+$/, ""));
  }
  return out;
}
