import { createTool } from "@mastra/core/tools";
import { extractText, getDocumentProxy } from "unpdf";
import { z } from "zod";
import { tavilyUsd } from "../core/cost.ts";
import { htmlToMarkdown } from "./extract.ts";
import { impit, tavilyClient } from "./providers.ts";
import { clip, record, type Sink } from "./sink.ts";

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

async function impitFetch(url: string): Promise<string> {
  try {
    const res = await impit.fetch(url);
    if (!res.ok) return "";
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("pdf") || url.toLowerCase().endsWith(".pdf")) return pdfToText(await res.arrayBuffer());
    if (type && !type.includes("html") && !type.includes("text")) return "";
    return htmlToMarkdown(await res.text(), url);
  } catch {
    return "";
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

export function fetchPageTool(sink: Sink) {
  return createTool({
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
      const pages: { url: string; text: string; via: string; tavilyCredits: number }[] =
        await Promise.all(
          urls.map(async (url: string) => {
          const local = await impitFetch(url);
          if (usable(local)) return { url, text: local.slice(0, PAGE_CAP), via: "impit", tavilyCredits: 0 };

          const rendered = await patchrightFetch(url);
          if (usable(rendered)) return { url, text: rendered.slice(0, PAGE_CAP), via: "patchright", tavilyCredits: 0 };

          const proxied = await patchrightFetch(url, { proxy: true });
          if (usable(proxied))
            return { url, text: proxied.slice(0, PAGE_CAP), via: "patchright+proxy", tavilyCredits: 0 };

          const solved = await patchrightFetch(url, { proxy: true, solve: true });
          if (usable(solved))
            return { url, text: solved.slice(0, PAGE_CAP), via: "patchright+solver", tavilyCredits: 0 };

          const tav = await tavilyExtractFetch(url);
          if (usable(tav.text))
            return { url, text: tav.text.slice(0, PAGE_CAP), via: "tavily", tavilyCredits: tav.credits };

          const best = tav.text || solved || proxied || rendered || local;
          const via = tav.text ? "tavily" : rendered ? "patchright" : "impit";
          return { url, text: best.slice(0, PAGE_CAP), via, tavilyCredits: tav.credits };
        }),
      );
      for (const p of pages) sink.sources.add(p.url);
      let tavilyCredits = 0;
      for (const p of pages) tavilyCredits += p.tavilyCredits;
      sink.cost.tavilyCredits += tavilyCredits;
      record(sink, {
        type: "fetch",
        urls,
        resultCount: pages.length,
        results: pages.map((p) => ({ url: p.url, chars: p.text.length, preview: clip(p.text), via: p.via })),
        cost: tavilyUsd(tavilyCredits),
      });
      return { pages: pages.map(({ url, text }) => ({ url, text })) };
    },
  });
}
