import { afterEach, expect, test } from "bun:test";
import { createCache } from "../src/core/cache.ts";
import { emptyCost } from "../src/core/cost.ts";
import { webSearchTool } from "../src/tools/search.ts";
import type { Sink } from "../src/tools/sink.ts";

type SearchExec = (input: { query: string; max_results: number }) => Promise<{ results: { url: string }[] }>;

const realFetch = globalThis.fetch;
const realEnv = { SEARXNG_URL: process.env.SEARXNG_URL, EXA_API_KEY: process.env.EXA_API_KEY };

function makeSink(): Sink {
  return { sources: new Set(), seen: new Set(), log: [], cost: emptyCost() };
}

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env.SEARXNG_URL = realEnv.SEARXNG_URL;
  if (realEnv.EXA_API_KEY === undefined) delete process.env.EXA_API_KEY;
  else process.env.EXA_API_KEY = realEnv.EXA_API_KEY;
});

test("two rows, same query: provider hit once, sources on both, cost only on the miss", async () => {
  process.env.SEARXNG_URL = "http://searxng.test";
  delete process.env.EXA_API_KEY;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ results: [{ title: "T", url: "https://x.test/a", content: "c" }] }), {
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;

  const cache = createCache();
  const rowA = makeSink();
  const rowB = makeSink();
  const input = { query: "acme corp", max_results: 5 };
  const search = (sink: Sink): SearchExec => webSearchTool(sink, cache).execute as unknown as SearchExec;

  await search(rowA)(input);
  await search(rowB)(input);

  expect(calls).toBe(1);
  expect(rowA.sources.has("https://x.test/a")).toBe(true);
  expect(rowB.sources.has("https://x.test/a")).toBe(true);
  expect(rowA.log[0]?.cached).toBe(false);
  expect(rowB.log[0]?.cached).toBe(true);
});
