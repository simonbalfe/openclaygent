import { createTool } from "@mastra/core/tools";
import { search } from "open-search";
import { z } from "zod";
import { clip, noteUrl, record, recordEvidence, type RunContext } from "../sink.ts";

export function webSearchTool(context: RunContext) {
  return createTool({
    id: "web_search",
    description:
      "Search the web. Returns titles, URLs, and content snippets. Use snippets to locate the right source and to answer a field when they cleanly and consistently settle it; when they are missing, ambiguous, or conflict, fetch_page the primary source instead of guessing from a snippet.",
    inputSchema: z.object({
      query: z.string().describe("A specific query. Always include the entity name."),
      max_results: z.number().int().min(1).max(8).default(5),
    }),
    outputSchema: z.object({
      results: z.array(z.object({ title: z.string(), url: z.string(), content: z.string() })),
    }),
    execute: async ({ query, max_results }) => {
      const searchResult = await search(query, { maxResults: max_results });
      const trail = searchResult.attempts.map((attempt) => {
        const detail = attempt.detail ? ` ${attempt.detail}` : "";
        const count = attempt.resultCount ? ` ${attempt.resultCount} results` : "";
        return `${attempt.provider}: ${attempt.outcome}${count}${detail}`;
      });
      for (const result of searchResult.results) {
        context.urls.sources.add(result.url);
        noteUrl(context, result.url);
        recordEvidence(context, { tool: "search", url: result.url, text: result.content, via: searchResult.provider });
      }
      record(context, {
        type: "search",
        query,
        via: searchResult.provider,
        trail,
        resultCount: searchResult.results.length,
        results: searchResult.results.map((result) => ({
          title: result.title,
          url: result.url,
          preview: clip(result.content),
        })),
      });
      return { results: searchResult.results };
    },
  });
}
