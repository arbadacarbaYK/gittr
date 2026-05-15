/** Coalesce identical in-flight browser fetches (avoids connection-limit storms on repo pages). */
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

  const promise = fetch(url, init).finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise.then((response) => response.clone());
}
