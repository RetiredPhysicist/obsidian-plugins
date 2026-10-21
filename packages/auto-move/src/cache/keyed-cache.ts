/**
 * Bounded cache. Entries are grouped by a file key so an edited file replaces
 * its stale entry instead of piling up, and the oldest `judgedAt` is evicted
 * past the cap.
 */
export class KeyedCache<T extends { judgedAt: number }> {
  private map = new Map<string, T>();
  private groups = new Map<string, string>();
  private readonly maxEntries: number;

  constructor(
    private readonly keyOf: (value: T) => string,
    private readonly groupOf: (value: T) => string,
    maxEntries = 20_000
  ) {
    this.maxEntries = maxEntries;
  }

  load(entries: T[]): void {
    this.map.clear();
    this.groups.clear();
    for (const e of entries) this.set(e);
  }

  dump(): T[] {
    return [...this.map.values()];
  }

  get(key: string): T | undefined {
    return this.map.get(key);
  }

  set(value: T): void {
    const key = this.keyOf(value);
    const group = this.groupOf(value);
    const prev = this.groups.get(group);
    if (prev !== undefined && prev !== key) this.map.delete(prev);
    this.groups.set(group, key);
    this.map.set(key, value);
    this.evict();
  }

  private evict(): void {
    while (this.map.size > this.maxEntries) {
      let oldestKey: string | undefined;
      let oldest = Infinity;
      for (const [k, v] of this.map) {
        if (v.judgedAt < oldest) {
          oldest = v.judgedAt;
          oldestKey = k;
        }
      }
      if (oldestKey === undefined) return;
      const victim = this.map.get(oldestKey);
      this.map.delete(oldestKey);
      if (victim) {
        const group = this.groupOf(victim);
        if (this.groups.get(group) === oldestKey) this.groups.delete(group);
      }
    }
  }
}
