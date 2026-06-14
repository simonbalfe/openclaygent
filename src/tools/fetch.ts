import { createTool } from "@mastra/core/tools";
import { extractText, getDocumentProxy } from "unpdf";
import { z } from "zod";
import type { Cache } from "../core/cache.ts";
import { tavilyUsd } from "../core/cost.ts";
import { fitToBudget, htmlToMarkdown } from "./extract.ts";
import { impit, tavilyClient } from "./providers.ts";
import { assertVerifiedUrl, clip, noteUrl, noteUrlsInText, normalizeUrl, record, type Sink } from "./sink.ts";

async function pdfToText(buf: ArrayBuffer): Promise<string> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  } catch {
    return "";
  }
}

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

async function impitFetch(url: string): Promise<{ text: string; status: number }> {
  try {
    const res = await impit.fetch(url);
    if (!res.ok) return { text: "", status: res.status };
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("pdf") || url.toLowerCase().endsWith(".pdf"))
      return { text: await pdfToText(await res.arrayBuffer()), status: res.status };
    if (type && !type.includes("html") && !type.includes("text")) return { text: "", status: res.status };
    return { text: htmlToMarkdown(await res.text(), url), status: res.status };
  } catch {
    return { text: "", status: 0 };
  }
}

async function tavilyExtractFetch(url: string): Promise<{ text: string; credits: number }> {
  const client = tavilyClient();
  if (!client) return { text: "", credits: 0 };
  try {
    const data = await client.extract([url], {
      extractDepth: "advanced",
      format: "markdown",
      includeUsage: true,
    });
    return { text: data.results[0]?.rawContent ?? "", credits: data.usage?.credits ?? 0 };
  } catch {
    return { text: "", credits: 0 };
  }
}

type Outcome = "ok" | "dead" | "transient";

const DEAD_STATUS = new Set([401, 404, 410]);
const DEAD_TTL_MS = 7 * 24 * 3600_000;

export function isDeadStatus(status: number): boolean {
  return DEAD_STATUS.has(status);
}

interface FetchResult {
  text: string;
  via: string;
  tavilyCredits: number;
  outcome: Outcome;
}

async function fetchLadder(url: string): Promise<FetchResult> {
  const local = await impitFetch(url);
  if (usable(local.text)) return { text: local.text, via: "impit", tavilyCredits: 0, outcome: "ok" };
  if (isDeadStatus(local.status)) return { text: "", via: "impit", tavilyCredits: 0, outcome: "dead" };

  const rendered = await patchrightFetch(url);
  if (usable(rendered)) return { text: rendered, via: "patchright", tavilyCredits: 0, outcome: "ok" };

  const proxied = await patchrightFetch(url, { proxy: true });
  if (usable(proxied)) return { text: proxied, via: "patchright+proxy", tavilyCredits: 0, outcome: "ok" };

  const solved = await patchrightFetch(url, { proxy: true, solve: true });
  if (usable(solved)) return { text: solved, via: "patchright+solver", tavilyCredits: 0, outcome: "ok" };

  const tav = await tavilyExtractFetch(url);
  if (usable(tav.text)) return { text: tav.text, via: "tavily", tavilyCredits: tav.credits, outcome: "ok" };

  const best = tav.text || solved || proxied || rendered || local.text;
  const via = tav.text ? "tavily" : rendered ? "patchright" : "impit";
  return { text: best, via, tavilyCredits: tav.credits, outcome: "transient" };
}

export function fetchPageTool(sink: Sink, cache: Cache) {
  return createTool({
    id: "fetch_page",
    description:
      "Fetch the full cleaned text of one or more URLs. Use only when search snippets are insufficient. For long pages, pass `query` (what you are looking for) so the tool returns the most relevant sections instead of a blind truncation.",
    inputSchema: z.object({
      urls: z.array(z.string()).min(1).max(4).describe("URLs to read in full."),
      query: z
        .string()
        .optional()
        .describe("What you are looking for on the page; used to keep the most relevant sections of long pages."),
    }),
    outputSchema: z.object({
      pages: z.array(z.object({ url: z.string(), text: z.string() })),
    }),
    execute: async ({ urls, query }) => {
      for (const url of urls)
        assertVerifiedUrl(sink, url, "Only fetch URLs from a web_search result, this row's data, or links on a page you already fetched. web_search first.");
      const raw: { url: string; text: string; via: string; tavilyCredits: number; cached: boolean }[] =
        await Promise.all(
        urls.map(async (url: string) => {
          const { value, cached } = await cache.getOrCompute("fetch", normalizeUrl(url), () => fetchLadder(url), {
            cacheable: (r) => r.outcome === "ok" || r.outcome === "dead",
            ttlMs: (r) => (r.outcome === "dead" ? DEAD_TTL_MS : undefined),
          });
          return { url, text: value.text, via: value.via, tavilyCredits: cached ? 0 : value.tavilyCredits, cached };
        }),
      );
      const pages = raw.map((p) => ({ ...p, text: fitToBudget(p.text, query, PAGE_CAP) }));
      for (const p of pages) {
        sink.sources.add(p.url);
        noteUrl(sink, p.url);
        noteUrlsInText(sink, p.text);
      }
      let tavilyCredits = 0;
      for (const p of pages) tavilyCredits += p.tavilyCredits;
      sink.cost.tavilyCredits += tavilyCredits;
      record(sink, {
        type: "fetch",
        urls,
        resultCount: pages.length,
        results: pages.map((p) => ({ url: p.url, chars: p.text.length, preview: clip(p.text), via: p.via })),
        cost: tavilyUsd(tavilyCredits),
        cached: pages.length > 0 && pages.every((p) => p.cached),
      });
      return { pages: pages.map(({ url, text }) => ({ url, text })) };
    },
  });
}
