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
