import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { Cache } from "../core/cache.ts";
import { tavilyUsd } from "../core/cost.ts";
import { exaClient, tavilyClient } from "./providers.ts";
import { clip, noteUrl, record, type Sink } from "./sink.ts";

interface SearchResult {
  title: string;
  url: string;
  content: string;
}

async function searxngSearch(baseUrl: string, query: string, n: number): Promise<SearchResult[]> {
  const u = new URL("/search", baseUrl);
  u.searchParams.set("q", query);
  u.searchParams.set("format", "json");
  const res = await fetch(u);
  if (!res.ok) throw new Error(`SearXNG ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    results: { title?: string; url: string; content?: string }[];
  };
  return data.results.slice(0, n).map((r) => ({
    title: r.title ?? "",
    url: r.url,
    content: r.content ?? "",
  }));
}

interface RungResult {
  results: SearchResult[];
  exaUsd: number;
  tavilyCredits: number;
}

async function searxngRung(query: string, n: number): Promise<RungResult> {
  const results = await searxngSearch(process.env.SEARXNG_URL!, query, n);
  return { results, exaUsd: 0, tavilyCredits: 0 };
}

async function exaSearch(query: string, n: number): Promise<RungResult> {
  const client = exaClient();
  if (!client) throw new Error("EXA_API_KEY is not set");
  const data = await client.searchAndContents(query, {
    type: "auto",
    numResults: n,
    text: { maxCharacters: 1200 },
  });
  const results = data.results.map((r) => ({
    title: r.title ?? "",
    url: r.url,
    content: r.text ?? "",
  }));
  return { results, exaUsd: data.costDollars?.total ?? 0, tavilyCredits: 0 };
}

async function tavilySearch(query: string, n: number): Promise<RungResult> {
  const client = tavilyClient();
  if (!client) throw new Error("TAVILY_API_KEY is not set");
  const data = await client.search(query, { maxResults: n, includeUsage: true });
  const results = data.results.slice(0, n).map((r) => ({
    title: r.title ?? "",
    url: r.url,
    content: r.content ?? "",
  }));
  return { results, exaUsd: 0, tavilyCredits: data.usage?.credits ?? 0 };
}

interface SearchRung {
  name: string;
  enabled: () => boolean;
  search: (query: string, n: number) => Promise<RungResult>;
}

const SEARCH_LADDER: SearchRung[] = [
  { name: "searxng", enabled: () => Boolean(process.env.SEARXNG_URL), search: searxngRung },
  { name: "exa", enabled: () => Boolean(process.env.EXA_API_KEY), search: exaSearch },
  { name: "tavily", enabled: () => Boolean(process.env.TAVILY_API_KEY), search: tavilySearch },
];

export async function searchWeb(
  query: string,
  n: number,
): Promise<{ results: SearchResult[]; via: string; exaUsd: number; tavilyCredits: number }> {
  let lastError: unknown;
  let emptyVia: string | undefined;
  for (const rung of SEARCH_LADDER) {
    if (!rung.enabled()) continue;
    try {
      const { results, exaUsd, tavilyCredits } = await rung.search(query, n);
      if (results.length) return { results, via: rung.name, exaUsd, tavilyCredits };
      emptyVia = rung.name;
    } catch (e) {
      lastError = e;
    }
  }
  if (emptyVia) return { results: [], via: emptyVia, exaUsd: 0, tavilyCredits: 0 };
  throw lastError instanceof Error
    ? lastError
    : new Error("No search provider configured: set SEARXNG_URL, EXA_API_KEY, or TAVILY_API_KEY");
}

export function webSearchTool(sink: Sink, cache: Cache) {
  return createTool({
    id: "web_search",
    description:
      "Search the web. Returns titles, URLs, and content snippets. Use snippets to locate the right source and to answer a field when they cleanly and consistently settle it; when they are missing, ambiguous, or conflict, fetch_page the primary source (or use linkedin_company for firmographics) instead of guessing from a snippet.",
    inputSchema: z.object({
      query: z.string().describe("A specific query. Always include the entity name."),
      max_results: z.number().int().min(1).max(8).default(5),
    }),
    outputSchema: z.object({
      results: z.array(
        z.object({ title: z.string(), url: z.string(), content: z.string() }),
      ),
    }),
    execute: async ({ query, max_results }) => {
      const { value, cached } = await cache.getOrCompute(
        "search",
        `${query}|${max_results}`,
        () => searchWeb(query, max_results),
        { cacheable: (r) => r.results.length > 0 },
      );
      const { results, via, exaUsd, tavilyCredits } = value;
      for (const r of results) {
        sink.sources.add(r.url);
        noteUrl(sink, r.url);
      }
      if (!cached) {
        sink.cost.exa += exaUsd;
        sink.cost.tavilyCredits += tavilyCredits;
      }
      record(sink, {
        type: "search",
        query,
        via,
        resultCount: results.length,
        results: results.map((r) => ({ title: r.title, url: r.url, preview: clip(r.content) })),
        cost: cached ? 0 : exaUsd + tavilyUsd(tavilyCredits),
        cached,
      });
      return { results };
    },
  });
}
