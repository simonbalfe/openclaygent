import { expect, test } from "bun:test";
import { createCacheFromEnv } from "../src/core/cache-pg.ts";

const live = process.env.OPENCLAY_CACHE_URL ? test : test.skip;

function randomKey(): string {
  return `k-${Math.random().toString(36).slice(2)}`;
}

live("L2 round-trips through real Postgres: a fresh instance reads the prior write (Drizzle)", async () => {
  const ns = "test";
  const key = randomKey();

  const c1 = createCacheFromEnv();
  let calls = 0;
  const r1 = await c1.getOrCompute(ns, key, async () => {
    calls++;
    return { v: 42, who: "first" };
  });
  expect(r1).toEqual({ value: { v: 42, who: "first" }, cached: false });

  await new Promise((r) => setTimeout(r, 400));

  const c2 = createCacheFromEnv();
  const r2 = await c2.getOrCompute(ns, key, async () => {
    calls++;
    return { v: 999, who: "second" };
  });
  expect(r2.cached).toBe(true);
  expect(r2.value).toEqual({ v: 42, who: "first" });
  expect(calls).toBe(1);
});

live("L2 expired entry is a miss and recomputes", async () => {
  process.env.OPENCLAY_CACHE_TTL_SEC = "1";
  const ns = "test";
  const key = randomKey();

  const c1 = createCacheFromEnv();
  await c1.getOrCompute(ns, key, async () => ({ v: 1 }));
  await new Promise((r) => setTimeout(r, 1600));

  const c2 = createCacheFromEnv();
  let recomputed = false;
  const r = await c2.getOrCompute(ns, key, async () => {
    recomputed = true;
    return { v: 2 };
  });
  expect(recomputed).toBe(true);
  expect(r).toEqual({ value: { v: 2 }, cached: false });
});
