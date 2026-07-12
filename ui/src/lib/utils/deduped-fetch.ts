/** Coalesce identical in-flight browser fetches (avoids connection-limit storms on repo pages). */
import { fetchBridgeRead } from "@/lib/nostr/bridge-read";

const inflight = new Map<string, Promise<Response>>();

export function fetchDeduped(
  url: string,
  init?: RequestInit
): Promise<Response> {
  const key = `${init?.method ?? "GET"} ${url}`;
  const existing = inflight.get(key);
  if (existing) {
    return existing.then((response) => response.clone());
  }

  // fetchBridgeRead retries with signed Nostr auth on 401/403 so private
  // repos stay readable for their owner/contributors.
  const promise = fetchBridgeRead(url, init).finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise.then((response) => response.clone());
}
