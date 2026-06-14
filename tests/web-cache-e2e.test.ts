import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Cache } from "../src/core/cache.ts";
import { createCache, type Layer2 } from "../src/core/cache.ts";
import { emptyCost } from "../src/core/cost.ts";
import { fetchPageTool } from "../src/tools/fetch.ts";
import { impit } from "../src/tools/providers.ts";
import { noteUrl, type Sink } from "../src/tools/sink.ts";

type FetchExec = (i: { urls: string[]; query?: string }) => Promise<{ pages: { url: string; text: string }[] }>;
type ImpitLike = { fetch: (url: string) => Promise<Response> };

const DEAD_TTL_MS = 7 * 24 * 3600_000;

function makeSink(): Sink {
  return { sources: new Set(), seen: new Set(), log: [], cost: emptyCost() };
}

function recordingL2(): { l2: Layer2; sets: { ns: string; key: string; ttl: number }[] } {
  const store = new Map<string, unknown>();
  const sets: { ns: string; key: string; ttl: number }[] = [];
  const l2: Layer2 = {
    async get(ns, key) {
      return store.get(`${ns}:${key}`);
    },
    async set(ns, key, value, ttl) {
      store.set(`${ns}:${key}`, value);
      sets.push({ ns, key, ttl });
    },
  };
  return { l2, sets };
}

function htmlDoc(): string {
  const para = "Acme Corp is a company that builds widgets for enterprise customers worldwide. ".repeat(20);
  return `<!doctype html><html><head><title>About Acme</title></head><body><article><h1>About Acme</h1><p>${para}</p></article></body></html>`;
}

const callFetch = (sink: Sink, cache: Cache): FetchExec =>
  fetchPageTool(sink, cache).execute as unknown as FetchExec;

const realImpitFetch = (impit as unknown as ImpitLike).fetch;
const realFetch = globalThis.fetch;
const realEnv = { PATCHRIGHT_URL: process.env.PATCHRIGHT_URL, TAVILY_API_KEY: process.env.TAVILY_API_KEY };

let impitHandler: (url: string) => Promise<Response>;

beforeEach(() => {
  process.env.PATCHRIGHT_URL = "http://patchright.test";
  delete process.env.TAVILY_API_KEY;
  (impit as unknown as ImpitLike).fetch = (url) => impitHandler(url);
});

afterEach(() => {
  (impit as unknown as ImpitLike).fetch = realImpitFetch;
  globalThis.fetch = realFetch;
  if (realEnv.PATCHRIGHT_URL === undefined) delete process.env.PATCHRIGHT_URL;
  else process.env.PATCHRIGHT_URL = realEnv.PATCHRIGHT_URL;
  if (realEnv.TAVILY_API_KEY === undefined) delete process.env.TAVILY_API_KEY;
  else process.env.TAVILY_API_KEY = realEnv.TAVILY_API_KEY;
});

test("two rows fetching the same URL hit impit once; second row is a $0 cached hit", async () => {
  let impitCalls = 0;
  impitHandler = async () => {
    impitCalls++;
    return new Response(htmlDoc(), { headers: { "content-type": "text/html" } });
  };
  const cache = createCache();
  const url = "https://acme.test/about";

  const rowA = makeSink();
  noteUrl(rowA, url);
  const a = await callFetch(rowA, cache)({ urls: [url] });

  const rowB = makeSink();
  noteUrl(rowB, url);
  const b = await callFetch(rowB, cache)({ urls: [url] });

  expect(impitCalls).toBe(1);
  expect(a.pages[0]!.text.length).toBeGreaterThan(200);
  expect(b.pages[0]!.text).toBe(a.pages[0]!.text);
  expect(rowA.log[0]!.cached).toBe(false);
  expect(rowB.log[0]!.cached).toBe(true);
  expect(rowB.cost.tavilyCredits).toBe(0);
});

test("a 404 short-circuits the ladder (no patchright) and is negative-cached in L2 with a long TTL", async () => {
  let impitCalls = 0;
  let patchrightCalls = 0;
  impitHandler = async () => {
    impitCalls++;
    return new Response("", { status: 404 });
  };
  globalThis.fetch = (async () => {
    patchrightCalls++;
    return new Response("nope");
  }) as unknown as typeof fetch;

  const { l2, sets } = recordingL2();
  const cache = createCache(l2, 1000);
  const url = "https://acme.test/gone";
  const row = makeSink();
  noteUrl(row, url);

  const out = await callFetch(row, cache)({ urls: [url] });

  expect(impitCalls).toBe(1);
  expect(patchrightCalls).toBe(0);
  expect(out.pages[0]!.text).toBe("");
  expect(sets).toEqual([{ ns: "fetch", key: "acme.test/gone", ttl: DEAD_TTL_MS }]);
});

test("a transient failure (impit throws, ladder yields nothing) is NOT written to L2", async () => {
  let patchrightCalls = 0;
  impitHandler = async () => {
    throw new Error("network down");
  };
  globalThis.fetch = (async () => {
    patchrightCalls++;
    return new Response("nope");
  }) as unknown as typeof fetch;

  const { l2, sets } = recordingL2();
  const cache = createCache(l2, 1000);
  const url = "https://acme.test/flaky";
  const row = makeSink();
  noteUrl(row, url);

  await callFetch(row, cache)({ urls: [url] });

  expect(patchrightCalls).toBeGreaterThan(0);
  expect(sets).toHaveLength(0);
});
