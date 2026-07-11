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

import { debug } from "./debug.ts";

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
      if (existing) {
        debug("cache", `${k.slice(0, 120)} l1 hit`);
        return existing.then((value) => ({ value, cached: true }));
      }

      let cached = true;
      const work = (async (): Promise<T> => {
        if (l2) {
          const hit = (await l2.get(ns, key).catch(() => undefined)) as T | undefined;
          if (hit != null) {
            debug("cache", `${k.slice(0, 120)} l2 hit`);
            return hit;
          }
        }
        cached = false;
        const started = performance.now();
        const value = await fn();
        const cacheable = opts?.cacheable?.(value) ?? true;
        debug(
          "cache",
          `${k.slice(0, 120)} miss, computed ${Math.round(performance.now() - started)}ms${cacheable ? "" : ", uncacheable"}`,
        );
        if (l2 && cacheable) {
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
