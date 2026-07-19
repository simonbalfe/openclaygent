import { afterEach, expect, test } from "bun:test";
import { search } from "../src/search.ts";

const originalFetch = globalThis.fetch;
const originalEnv = {
  SEARXNG_URL: process.env.SEARXNG_URL,
  SERPER_API_KEY: process.env.SERPER_API_KEY,
  EXA_API_KEY: process.env.EXA_API_KEY,
  TAVILY_API_KEY: process.env.TAVILY_API_KEY,
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("uses Serper after an empty SearXNG result", async () => {
  process.env.SEARXNG_URL = "http://searxng.test";
  process.env.SERPER_API_KEY = "serper-test-key";
  process.env.EXA_API_KEY = "";
  process.env.TAVILY_API_KEY = "";
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.startsWith("http://searxng.test")) return Response.json({ results: [] });
    return Response.json({
      organic: [{ title: "IANA Example Domains", link: "https://www.iana.org/help/example-domains", snippet: "Reserved for documentation." }],
    });
  }, { preconnect: originalFetch.preconnect });

  const result = await search("IANA example domains", { maxResults: 3 });

  expect(result.provider).toBe("serper");
  expect(result.results).toEqual([
    {
      title: "IANA Example Domains",
      url: "https://www.iana.org/help/example-domains",
      content: "Reserved for documentation.",
    },
  ]);
  expect(result.attempts.map(({ provider, outcome }) => ({ provider, outcome }))).toEqual([
    { provider: "searxng", outcome: "empty" },
    { provider: "serper", outcome: "ok" },
  ]);
  expect(requests[1]?.url).toBe("https://google.serper.dev/search");
  expect(requests[1]?.init?.headers).toEqual({ "content-type": "application/json", "X-API-KEY": "serper-test-key" });
  expect(requests[1]?.init?.body).toBe(JSON.stringify({ q: "IANA example domains", num: 3 }));
});
