/**
 * Small in-process Map with TTL + max size (FIFO eviction of oldest inserts).
 * Prevents unbounded heap growth from API response caches.
 */
export class BoundedTtlCache<V> {
  private readonly store = new Map<string, { at: number; value: V }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number
  ) {}

  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at >= this.ttlMs) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { at: Date.now(), value });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  get size(): number {
    return this.store.size;
  }
}
