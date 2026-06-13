import { tavily } from "@tavily/core";
import { createTool } from "@mastra/core/tools";
import Exa from "exa-js";
import { Impit } from "impit";
import { z } from "zod";
import type { AgentStep } from "../types.ts";
import { htmlToMarkdown } from "./extract.ts";

const PAGE_CAP = 12000;
const MIN_USABLE_CHARS = 200;
const SHELL_MARKERS = [
  "enable javascript",
  "please enable js",
  "you need to enable javascript",
  "checking your browser",
  "captcha",
  "are you a human",
  "access denied",
  "cf-browser-verification",
  "request unsuccessful",
  "ddos protection",
];

function usable(text: string): boolean {
  if (text.length < MIN_USABLE_CHARS) return false;
  if (text.length < 3000) {
    const head = text.slice(0, 4000).toLowerCase();
    if (SHELL_MARKERS.some((m) => head.includes(m))) return false;
  }
  return true;
}

const impit = new Impit({ browser: "chrome", timeout: 15000 });

let exaClientInstance: Exa | null = null;
function exaClient(): Exa | null {
  const key = process.env.EXA_API_KEY;
  if (!key) return null;
  if (!exaClientInstance) exaClientInstance = new Exa(key);
  return exaClientInstance;
}

let tavilyClientInstance: ReturnType<typeof tavily> | null = null;
function tavilyClient(): ReturnType<typeof tavily> | null {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return null;
  if (!tavilyClientInstance) tavilyClientInstance = tavily({ apiKey: key });
  return tavilyClientInstance;
}

async function patchrightFetch(
  url: string,
  opts: { proxy?: boolean; solve?: boolean } = {},
): Promise<string> {
  const base = process.env.PATCHRIGHT_URL;
  if (!base) return "";
  const q = new URLSearchParams({ url });
  if (opts.proxy) q.set("proxy", "1");
  if (opts.solve) q.set("solve", "1");
  const timeout = opts.solve ? 120000 : 45000;
  try {
    const res = await fetch(`${base}/fetch?${q}`, { signal: AbortSignal.timeout(timeout) });
    if (!res.ok) return "";
    return htmlToMarkdown(await res.text(), url);
  } catch {
    return "";
  }
}

async function impitFetch(url: string): Promise<string> {
  try {
    const res = await impit.fetch(url);
    if (!res.ok) return "";
    const type = res.headers.get("content-type") ?? "";
    if (type && !type.includes("html") && !type.includes("text")) return "";
    return htmlToMarkdown(await res.text(), url);
  } catch {
    return "";
  }
}

async function exaContentsFetch(url: string): Promise<string> {
  const client = exaClient();
  if (!client) return "";
  try {
    const data = await client.getContents(url, {
      text: { maxCharacters: PAGE_CAP },
      livecrawl: "fallback",
      livecrawlTimeout: 12000,
    });
    return data.results[0]?.text ?? "";
  } catch {
    return "";
  }
}

async function tavilyExtractFetch(url: string): Promise<string> {
  const client = tavilyClient();
  if (!client) return "";
  try {
    const data = await client.extract([url], { extractDepth: "advanced", format: "markdown" });
    return data.results[0]?.rawContent ?? "";
  } catch {
    return "";
  }
}

export interface Sink {
  sources: Set<string>;
  log: AgentStep[];
  onStep?: (step: AgentStep) => void;
}

export function record(sink: Sink, step: AgentStep): void {
  sink.log.push(step);
  sink.onStep?.(step);
}

export function clip(text: string, max = 180): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

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

async function exaSearch(query: string, n: number): Promise<SearchResult[]> {
  const client = exaClient();
  if (!client) throw new Error("EXA_API_KEY is not set");
  const data = await client.searchAndContents(query, {
    type: "auto",
    numResults: n,
    text: { maxCharacters: 1200 },
  });
  return data.results.map((r) => ({
    title: r.title ?? "",
    url: r.url,
    content: r.text ?? "",
  }));
}

async function tavilySearch(query: string, n: number): Promise<SearchResult[]> {
  const client = tavilyClient();
  if (!client) throw new Error("TAVILY_API_KEY is not set");
  const data = await client.search(query, { maxResults: n });
  return data.results.slice(0, n).map((r) => ({
    title: r.title ?? "",
    url: r.url,
    content: r.content ?? "",
  }));
}

interface SearchRung {
  name: string;
  enabled: () => boolean;
  search: (query: string, n: number) => Promise<SearchResult[]>;
}

const SEARCH_LADDER: SearchRung[] = [
  {
    name: "searxng",
    enabled: () => Boolean(process.env.SEARXNG_URL),
    search: (q, n) => searxngSearch(process.env.SEARXNG_URL!, q, n),
  },
  { name: "exa", enabled: () => Boolean(process.env.EXA_API_KEY), search: exaSearch },
  { name: "tavily", enabled: () => Boolean(process.env.TAVILY_API_KEY), search: tavilySearch },
];

export async function searchWeb(
  query: string,
  n: number,
): Promise<{ results: SearchResult[]; via: string }> {
  let lastError: unknown;
  let emptyVia: string | undefined;
  for (const rung of SEARCH_LADDER) {
    if (!rung.enabled()) continue;
    try {
      const results = await rung.search(query, n);
      if (results.length) return { results, via: rung.name };
      emptyVia = rung.name;
    } catch (e) {
      lastError = e;
    }
  }
  if (emptyVia) return { results: [], via: emptyVia };
  throw lastError instanceof Error
    ? lastError
    : new Error("No search provider configured: set SEARXNG_URL, EXA_API_KEY, or TAVILY_API_KEY");
}

export function webTools(sink: Sink) {
  const web_search = createTool({
    id: "web_search",
    description:
      "Search the web. Returns titles, URLs, and content snippets. Snippets are often enough to answer — only call fetch_page if you need the full text of a specific page.",
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
      const { results, via } = await searchWeb(query, max_results);
      for (const r of results) sink.sources.add(r.url);
      record(sink, {
        type: "search",
        query,
        via,
        resultCount: results.length,
        results: results.map((r) => ({ title: r.title, url: r.url, preview: clip(r.content) })),
      });
      return { results };
    },
  });

  const fetch_page = createTool({
    id: "fetch_page",
    description:
      "Fetch the full cleaned text of one or more URLs. Use only when search snippets are insufficient.",
    inputSchema: z.object({
      urls: z.array(z.string()).min(1).max(4).describe("URLs to read in full."),
    }),
    outputSchema: z.object({
      pages: z.array(z.object({ url: z.string(), text: z.string() })),
    }),
    execute: async ({ urls }) => {
      const pages: { url: string; text: string; via: string }[] = await Promise.all(
        urls.map(async (url: string) => {
          const local = await impitFetch(url);
          if (usable(local)) return { url, text: local.slice(0, PAGE_CAP), via: "impit" };

          const rendered = await patchrightFetch(url);
          if (usable(rendered)) return { url, text: rendered.slice(0, PAGE_CAP), via: "patchright" };

          const proxied = await patchrightFetch(url, { proxy: true });
          if (usable(proxied))
            return { url, text: proxied.slice(0, PAGE_CAP), via: "patchright+proxy" };

          const solved = await patchrightFetch(url, { proxy: true, solve: true });
          if (usable(solved))
            return { url, text: solved.slice(0, PAGE_CAP), via: "patchright+solver" };

          const exaText = await exaContentsFetch(url);
          if (usable(exaText)) return { url, text: exaText.slice(0, PAGE_CAP), via: "exa" };

          const tavilyText = await tavilyExtractFetch(url);
          if (usable(tavilyText)) return { url, text: tavilyText.slice(0, PAGE_CAP), via: "tavily" };

          const best = tavilyText || exaText || solved || proxied || rendered || local;
          const via = tavilyText ? "tavily" : exaText ? "exa" : rendered ? "patchright" : "impit";
          return { url, text: best.slice(0, PAGE_CAP), via };
        }),
      );
      for (const p of pages) sink.sources.add(p.url);
      record(sink, {
        type: "fetch",
        urls,
        resultCount: pages.length,
        results: pages.map((p) => ({ url: p.url, chars: p.text.length, preview: clip(p.text), via: p.via })),
      });
      return { pages: pages.map(({ url, text }) => ({ url, text })) };
    },
  });

  return { web_search, fetch_page };
}
