import { afterEach, expect, test } from "bun:test";
import { createCache } from "../src/core/cache.ts";
import { emptyCost } from "../src/core/cost.ts";
import { crunchbaseTools } from "../src/tools/crunchbase.ts";
import { linkedinTools } from "../src/tools/linkedin.ts";
import type { Sink } from "../src/tools/sink.ts";

type CompanyExec = (input: { company: string }) => Promise<{ company: unknown }>;

const realFetch = globalThis.fetch;
const realToken = process.env.APIFY_API_TOKEN;

function makeSink(): Sink {
  return { sources: new Set(), seen: new Set(), log: [], cost: emptyCost() };
}

function mockApify(items: unknown[], usd: number): () => number {
  let runs = 0;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes("/runs")) {
      runs++;
      return Response.json({ data: { id: "r1", status: "SUCCEEDED", defaultDatasetId: "d1", usageTotalUsd: usd } });
    }
    return Response.json(items);
  }) as unknown as typeof fetch;
  return () => runs;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realToken === undefined) delete process.env.APIFY_API_TOKEN;
  else process.env.APIFY_API_TOKEN = realToken;
});

test("linkedin_company repeated for the same company: one actor run, cost billed once", async () => {
  process.env.APIFY_API_TOKEN = "test-token";
  const runs = mockApify([{ name: "Acme", linkedinUrl: "https://www.linkedin.com/company/acme" }], 0.005);

  const cache = createCache();
  const rowA = makeSink();
  const rowB = makeSink();
  const exec = (sink: Sink): CompanyExec =>
    linkedinTools(sink, cache).linkedin_company.execute as unknown as CompanyExec;

  await exec(rowA)({ company: "Acme" });
  await exec(rowA)({ company: "Acme" });
  await exec(rowB)({ company: "Acme" });

  expect(runs()).toBe(1);
  expect(rowA.cost.apify).toBe(0.005);
  expect(rowB.cost.apify).toBe(0);
  expect(rowA.log[0]?.cached).toBe(false);
  expect(rowA.log[1]?.cached).toBe(true);
  expect(rowA.log[1]?.cost).toBe(0);
  expect(rowB.log[0]?.cached).toBe(true);
});

test("crunchbase_company empty result is memoized: repeat call does not re-bill", async () => {
  process.env.APIFY_API_TOKEN = "test-token";
  const runs = mockApify([], 0.005);

  const cache = createCache();
  const sink = makeSink();
  const exec = crunchbaseTools(sink, cache).crunchbase_company.execute as unknown as CompanyExec;

  await exec({ company: "Acme" });
  await exec({ company: "Acme" });

  expect(runs()).toBe(1);
  expect(sink.cost.apify).toBe(0.005);
  expect(sink.log[1]?.cached).toBe(true);
});

test("concurrent identical calls single-flight into one actor run", async () => {
  process.env.APIFY_API_TOKEN = "test-token";
  const runs = mockApify([{ name: "Acme" }], 0.005);

  const cache = createCache();
  const sink = makeSink();
  const exec = linkedinTools(sink, cache).linkedin_company.execute as unknown as CompanyExec;

  await Promise.all([exec({ company: "Acme" }), exec({ company: "Acme" }), exec({ company: "Acme" })]);

  expect(runs()).toBe(1);
  expect(sink.cost.apify).toBe(0.005);
});
