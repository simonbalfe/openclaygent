import { expect, test } from "bun:test";
import { type Cache, createCache } from "../src/core/cache.ts";

const PROVIDER_LATENCY_MS = 40;
const CONCURRENCY = 5;

async function boundedRun<T>(items: T[], limit: number, work: (item: T) => Promise<unknown>): Promise<void> {
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      await work(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function workload(): string[] {
  const entities = ["acme", "globex", "initech", "umbrella", "stark"];
  const rows: string[] = [];
  for (let i = 0; i < 30; i++) rows.push(`https://${entities[i % entities.length]}.test/about`);
  return rows;
}

test("cache cuts provider calls and wall-clock vs no cache (measured)", async () => {
  const rows = workload();
  const unique = new Set(rows).size;

  let coldCalls = 0;
  const slow = async (): Promise<string> => {
    coldCalls++;
    await new Promise((r) => setTimeout(r, PROVIDER_LATENCY_MS));
    return "page";
  };

  const t0 = performance.now();
  await boundedRun(rows, CONCURRENCY, () => slow());
  const noCacheMs = Math.round(performance.now() - t0);
  const noCacheCalls = coldCalls;

  coldCalls = 0;
  const cache: Cache = createCache();
  const t1 = performance.now();
  await boundedRun(rows, CONCURRENCY, (url) => cache.getOrCompute("fetch", url, slow));
  const cacheMs = Math.round(performance.now() - t1);
  const cacheCalls = coldCalls;

  const callReduction = `${noCacheCalls} → ${cacheCalls}`;
  const speedup = (noCacheMs / cacheMs).toFixed(1);
  console.log(
    `\n  cache benchmark (${rows.length} rows, ${unique} unique, ${PROVIDER_LATENCY_MS}ms/call, concurrency ${CONCURRENCY})\n` +
      `    provider calls:  ${callReduction}\n` +
      `    wall-clock:      ${noCacheMs}ms → ${cacheMs}ms  (${speedup}x faster)\n`,
  );

  expect(noCacheCalls).toBe(rows.length);
  expect(cacheCalls).toBe(unique);
  expect(cacheMs).toBeLessThan(noCacheMs);
});
