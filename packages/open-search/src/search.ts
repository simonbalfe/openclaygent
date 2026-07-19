import { tavily } from "@tavily/core";
import Exa from "exa-js";
import type { SearchAttempt, SearchHit, SearchOptions, SearchProvider, SearchResult } from "./types.ts";

interface Rung {
  provider: SearchProvider;
  enabled: boolean;
  execute: (query: string, maxResults: number) => Promise<SearchHit[]>;
}

function debug(message: string): void {
  if (process.env.OPEN_SEARCH_DEBUG === "1") console.error(`[open-search] ${message}`);
}

function concise(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 120 ? `${message.slice(0, 120)}…` : message;
}

async function searxngSearch(baseUrl: string, query: string, maxResults: number): Promise<SearchHit[]> {
  const url = new URL("/search", baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`SearXNG ${response.status}: ${await response.text()}`);
  const data = (await response.json()) as { results?: { title?: string; url: string; content?: string }[] };
  return (data.results ?? []).slice(0, maxResults).map((result) => ({
    title: result.title ?? "",
    url: result.url,
    content: result.content ?? "",
  }));
}

function ladder(): Rung[] {
  const searxngUrl = process.env.SEARXNG_URL ?? "http://localhost:8888";
  const exaKey = process.env.EXA_API_KEY ?? "";
  const tavilyKey = process.env.TAVILY_API_KEY ?? "";
  return [
    {
      provider: "searxng",
      enabled: Boolean(searxngUrl),
      execute: (query, maxResults) => searxngSearch(searxngUrl, query, maxResults),
    },
    {
      provider: "exa",
      enabled: Boolean(exaKey),
      execute: async (query, maxResults) => {
        const data = await new Exa(exaKey).searchAndContents(query, {
          type: "auto",
          numResults: maxResults,
          text: { maxCharacters: 1200 },
        });
        return data.results.map((result) => ({
          title: result.title ?? "",
          url: result.url,
          content: result.text ?? "",
        }));
      },
    },
    {
      provider: "tavily",
      enabled: Boolean(tavilyKey),
      execute: async (query, maxResults) => {
        const data = await tavily({ apiKey: tavilyKey }).search(query, { maxResults });
        return data.results.slice(0, maxResults).map((result) => ({
          title: result.title ?? "",
          url: result.url,
          content: result.content ?? "",
        }));
      },
    },
  ];
}

export async function search(query: string, options: SearchOptions = {}): Promise<SearchResult> {
  const normalized = query.trim();
  if (!normalized) throw new Error("Search query cannot be empty");
  const maxResults = Math.min(8, Math.max(1, options.maxResults ?? 5));
  const attempts: SearchAttempt[] = [];
  let lastError: unknown;
  let lastProvider: SearchProvider = "searxng";

  debug(`start ${JSON.stringify(normalized)} max=${maxResults}`);
  for (const rung of ladder()) {
    lastProvider = rung.provider;
    if (!rung.enabled) {
      attempts.push({ provider: rung.provider, outcome: "skipped", durationMs: 0, resultCount: 0, detail: "Not configured" });
      debug(`${rung.provider} skipped`);
      continue;
    }
    const started = performance.now();
    try {
      const results = await rung.execute(normalized, maxResults);
      const durationMs = Math.round(performance.now() - started);
      const outcome = results.length ? "ok" : "empty";
      attempts.push({ provider: rung.provider, outcome, durationMs, resultCount: results.length });
      debug(`${rung.provider} ${outcome} ${durationMs}ms results=${results.length}`);
      if (results.length) return { query: normalized, results, provider: rung.provider, attempts };
    } catch (error) {
      lastError = error;
      const durationMs = Math.round(performance.now() - started);
      attempts.push({ provider: rung.provider, outcome: "error", durationMs, resultCount: 0, detail: concise(error) });
      debug(`${rung.provider} error ${durationMs}ms: ${concise(error)}`);
    }
  }

  if (attempts.some((attempt) => attempt.outcome === "empty")) {
    return { query: normalized, results: [], provider: lastProvider, attempts };
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("No search provider configured: start SearXNG or set EXA_API_KEY or TAVILY_API_KEY");
}
