export interface Layer2 {
  get(ns: string, key: string): Promise<unknown>;
  set(ns: string, key: string, value: unknown, ttlMs: number): Promise<void>;
}

interface CacheOpts<T> {
  ttlMs?: number | ((value: T) => number | undefined);
  cacheable?: (value: T) => boolean;
}

export interface Cache {
  getOrCompute<T>(
    ns: string,
    key: string,
    fn: () => Promise<T>,
    opts?: CacheOpts<T>,
  ): Promise<{ value: T; cached: boolean }>;
}

const DEFAULT_TTL_MS = 3600_000;

export function createCache(l2?: Layer2, defaultTtlMs: number = DEFAULT_TTL_MS): Cache {
  const l1 = new Map<string, Promise<unknown>>();
  return {
    getOrCompute<T>(
      ns: string,
      key: string,
      fn: () => Promise<T>,
      opts?: CacheOpts<T>,
    ): Promise<{ value: T; cached: boolean }> {
      const k = `${ns}:${key}`;
      const existing = l1.get(k) as Promise<T> | undefined;
      if (existing) return existing.then((value) => ({ value, cached: true }));

      let cached = true;
      const work = (async (): Promise<T> => {
        if (l2) {
          const hit = (await l2.get(ns, key).catch(() => undefined)) as T | undefined;
          if (hit != null) return hit;
        }
        cached = false;
        const value = await fn();
        if (l2 && (opts?.cacheable?.(value) ?? true)) {
          const resolved = typeof opts?.ttlMs === "function" ? opts.ttlMs(value) : opts?.ttlMs;
          void l2.set(ns, key, value, resolved ?? defaultTtlMs).catch(() => {});
        }
        return value;
      })();
      void work.catch(() => l1.delete(k));
      l1.set(k, work);
      return work.then((value) => ({ value, cached }));
    },
  };
}
