import { afterEach, expect, test } from "bun:test";
import { searchWeb } from "../src/tools/search.ts";

const realFetch = globalThis.fetch;
const realEnv = {
  SEARXNG_URL: process.env.SEARXNG_URL,
  EXA_API_KEY: process.env.EXA_API_KEY,
  TAVILY_API_KEY: process.env.TAVILY_API_KEY,
};

function setEnv(vars: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  globalThis.fetch = realFetch;
  setEnv(realEnv);
});

test("ladder: all rungs empty returns the empty list, no error", async () => {
  setEnv({ SEARXNG_URL: "http://searxng.test", EXA_API_KEY: undefined, TAVILY_API_KEY: undefined });
  globalThis.fetch = (async () => json({ results: [] })) as unknown as typeof fetch;

  expect(await searchWeb("q", 5)).toEqual({
    results: [],
    via: "searxng",
    exaUsd: 0,
    tavilyCredits: 0,
    trail: ["searxng: empty", "exa: skipped (no env)", "tavily: skipped (no env)"],
  });
});

test("ladder: no provider configured throws", async () => {
  setEnv({ SEARXNG_URL: undefined, EXA_API_KEY: undefined, TAVILY_API_KEY: undefined });

  expect(searchWeb("q", 5)).rejects.toThrow("No search provider configured");
});
