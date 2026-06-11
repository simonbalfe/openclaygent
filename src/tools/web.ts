import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { AgentStep } from "../types.ts";

const EXA = "https://api.exa.ai";

export interface Sink {
  sources: Set<string>;
  log: AgentStep[];
}

async function exa<T>(path: string, body: unknown): Promise<T> {
  const key = process.env.EXA_API_KEY;
  if (!key) throw new Error("EXA_API_KEY is not set");
  const res = await fetch(`${EXA}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Exa ${path} ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
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
      const data = await exa<{
        results: { title?: string; url: string; text?: string; highlights?: string[] }[];
      }>("/search", {
        query,
        type: "auto",
        numResults: max_results,
        contents: { text: { maxCharacters: 1200 } },
      });
      const results = data.results.map((r) => ({
        title: r.title ?? "",
        url: r.url,
        content: r.highlights?.join(" ") || r.text || "",
      }));
      for (const r of results) sink.sources.add(r.url);
      sink.log.push({ type: "search", query, resultCount: results.length });
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
      const data = await exa<{ results: { url: string; text?: string }[] }>("/contents", {
        urls,
        text: true,
      });
      const pages = data.results.map((r) => ({
        url: r.url,
        text: (r.text ?? "").slice(0, 12000),
      }));
      for (const p of pages) sink.sources.add(p.url);
      sink.log.push({ type: "fetch", urls, resultCount: pages.length });
      return { pages };
    },
  });

  return { web_search, fetch_page };
}
