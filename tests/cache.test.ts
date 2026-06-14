import { expect, test } from "bun:test";
import { createCache, type Layer2 } from "../src/core/cache.ts";

function memoryL2(): { l2: Layer2; store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  const l2: Layer2 = {
    async get(ns, key) {
      return store.get(`${ns}:${key}`);
    },
    async set(ns, key, value) {
      store.set(`${ns}:${key}`, value);
    },
  };
  return { l2, store };
}

test("same key computes once; later calls are hits with the same value", async () => {
  const cache = createCache();
  let calls = 0;
  const fn = async () => {
    calls++;
    return calls;
  };

  expect(await cache.getOrCompute("ns", "k", fn)).toEqual({ value: 1, cached: false });
  expect(await cache.getOrCompute("ns", "k", fn)).toEqual({ value: 1, cached: true });
  expect(calls).toBe(1);
});

test("single-flight: concurrent calls before resolution share one computation", async () => {
  const cache = createCache();
  let calls = 0;
  const fn = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 10));
    return "v";
  };

  const [a, b] = await Promise.all([cache.getOrCompute("ns", "k", fn), cache.getOrCompute("ns", "k", fn)]);
  expect(a.cached).toBe(false);
  expect(b.cached).toBe(true);
  expect(calls).toBe(1);
});

test("namespaces and keys are isolated", async () => {
  const cache = createCache();
  await cache.getOrCompute("a", "k", async () => 1);
  expect((await cache.getOrCompute("b", "k", async () => 2)).cached).toBe(false);
  expect((await cache.getOrCompute("a", "other", async () => 3)).cached).toBe(false);
});

test("a failed computation is not cached; the next call retries", async () => {
  const cache = createCache();
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls === 1) throw new Error("boom");
    return "ok";
  };

  await expect(cache.getOrCompute("ns", "k", fn)).rejects.toThrow("boom");
  expect(await cache.getOrCompute("ns", "k", fn)).toEqual({ value: "ok", cached: false });
  expect(calls).toBe(2);
});

test("L2 hit serves a fresh instance without running fn, reported as cached", async () => {
  const { l2 } = memoryL2();
  let calls = 0;

  const c1 = createCache(l2);
  expect(await c1.getOrCompute("fetch", "u", async () => ((calls++), "html"))).toEqual({
    value: "html",
    cached: false,
  });

  const c2 = createCache(l2);
  expect(await c2.getOrCompute("fetch", "u", async () => ((calls++), "OTHER"))).toEqual({
    value: "html",
    cached: true,
  });
  expect(calls).toBe(1);
});

test("cacheable=false keeps the value out of L2", async () => {
  const { l2, store } = memoryL2();
  const cache = createCache(l2);
  await cache.getOrCompute("fetch", "u", async () => "", { cacheable: (v) => v.length > 0 });
  expect(store.size).toBe(0);
});

test("ttlMs may depend on the value; undefined falls back to the default (dead URL gets a longer TTL)", async () => {
  const captured: { key: string; ttl: number }[] = [];
  const l2: Layer2 = {
    async get() {
      return undefined;
    },
    async set(ns, key, _value, ttl) {
      captured.push({ key: `${ns}:${key}`, ttl });
    },
  };
  const cache = createCache(l2, 1000);
  const ttlByOutcome = (v: { outcome: string }) => (v.outcome === "dead" ? 99_000 : undefined);

  await cache.getOrCompute("fetch", "dead", async () => ({ outcome: "dead" }), { ttlMs: ttlByOutcome });
  await cache.getOrCompute("fetch", "ok", async () => ({ outcome: "ok" }), { ttlMs: ttlByOutcome });

  expect(captured).toEqual([
    { key: "fetch:dead", ttl: 99_000 },
    { key: "fetch:ok", ttl: 1000 },
  ]);
});
