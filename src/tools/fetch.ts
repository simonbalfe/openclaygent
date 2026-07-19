import { createTool } from "@mastra/core/tools";
import { extract, type ExtractAttempt } from "open-extract";
import { z } from "zod";
import { debug } from "../core/debug.ts";
import {
  assertVerifiedUrl,
  clip,
  noteUrl,
  noteUrlsInText,
  record,
  recordEvidence,
  type RunContext,
} from "./sink.ts";

function trailEntry(attempt: ExtractAttempt): string {
  const detail = attempt.detail ? ` (${attempt.detail})` : "";
  return `${attempt.provider}: ${attempt.outcome}${detail}, ${attempt.durationMs}ms`;
}

export function fetchPageTool(context: RunContext) {
  return createTool({
    id: "fetch_page",
    description:
      "Fetch the full cleaned text of one or more URLs. Use only when search snippets are insufficient. The extraction library retrieves HTML or PDFs, escalates blocked pages through its provider ladder, and returns bounded Markdown.",
    inputSchema: z.object({
      urls: z.array(z.string()).min(1).max(4).describe("URLs to read in full."),
    }),
    outputSchema: z.object({
      pages: z.array(z.object({ url: z.string(), text: z.string() })),
    }),
    execute: async ({ urls }: { urls: string[] }) => {
      for (const url of urls) {
        assertVerifiedUrl(
          context,
          url,
          "Only fetch URLs from a web_search result, this row's data, or links on a page you already fetched. web_search first.",
        );
      }

      const pages = await Promise.all(
        urls.map(async (url) => {
          const value = await extract(url);
          debug(
            "fetch.extract",
            `${url} → ${value.outcome} via ${value.provider}, ${value.content.length}c`,
          );
          return {
            url,
            text: value.content,
            via: value.provider,
            trail: value.attempts.map(trailEntry),
          };
        }),
      );

      for (const page of pages) {
        context.urls.sources.add(page.url);
        noteUrl(context, page.url);
        noteUrlsInText(context, page.text);
        recordEvidence(context, { tool: "fetch", url: page.url, text: page.text, via: page.via });
      }

      record(context, {
        type: "fetch",
        urls,
        resultCount: pages.length,
        results: pages.map((page) => ({
          url: page.url,
          chars: page.text.length,
          preview: clip(page.text),
          via: page.via,
          trail: page.trail,
        })),
      });

      return { pages: pages.map(({ url, text }) => ({ url, text })) };
    },
  });
}
