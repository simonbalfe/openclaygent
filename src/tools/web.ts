import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { AgentStep } from "../types.ts";

const TAVILY = "https://api.tavily.com";

/** Where each run accumulates its sources + step log. */
export interface Sink {
  sources: Set<string>;
  log: AgentStep[];
}

async function tavily<T>(path: string, body: unknown): Promise<T> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error("TAVILY_API_KEY is not set");
  const res = await fetch(`${TAVILY}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Tavily ${path} ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

/**
 * Both tools for one run. They share a sink so the engine can report every
 * URL touched and every step taken — no global state.
 */
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
    execute: async ({ context }) => {
      const data = await tavily<{
        results: { title: string; url: string; content: string }[];
      }>("/search", {
        query: context.query,
        max_results: context.max_results,
        search_depth: "basic",
        include_answer: false,
      });
      for (const r of data.results) sink.sources.add(r.url);
      sink.log.push({ type: "search", query: context.query, resultCount: data.results.length });
      return { results: data.results };
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
    execute: async ({ context }) => {
      const data = await tavily<{ results: { url: string; raw_content: string }[] }>(
        "/extract",
        { urls: context.urls },
      );
      const pages = data.results.map((r) => ({
        url: r.url,
        // keep a sane read window so token cost stays bounded
        text: (r.raw_content ?? "").slice(0, 12000),
      }));
      for (const p of pages) sink.sources.add(p.url);
      sink.log.push({ type: "fetch", urls: context.urls, resultCount: pages.length });
      return { pages };
    },
  });

  return { web_search, fetch_page };
}
