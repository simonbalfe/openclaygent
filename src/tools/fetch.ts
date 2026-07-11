import { createTool } from "@mastra/core/tools";
import { extractText, getDocumentProxy } from "unpdf";
import { z } from "zod";
import type { Cache } from "../core/cache.ts";
import { tavilyUsd } from "../core/cost.ts";
import { debug, reason } from "../core/debug.ts";
import { fitToBudget, htmlToMarkdown } from "./extract.ts";
import { impit, tavilyClient } from "./providers.ts";
import { assertVerifiedUrl, clip, noteUrl, noteUrlsInText, normalizeUrl, record, type Sink } from "./sink.ts";

async function pdfToText(buf: ArrayBuffer): Promise<string> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  } catch (e) {
    debug("fetch.pdf", reason(e));
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

function patchrightBase(): string {
  return process.env.PATCHRIGHT_URL ?? "http://localhost:9223";
}

async function patchrightFetch(
  url: string,
  opts: { proxy?: boolean; solve?: boolean } = {},
): Promise<{ text: string }> {
  const base = patchrightBase();
  const q = new URLSearchParams({ url });
  if (opts.proxy) q.set("proxy", "1");
  if (opts.solve) q.set("solve", "1");
  const timeout = opts.solve ? 120000 : 45000;
  try {
    const res = await fetch(`${base}/fetch?${q}`, { signal: AbortSignal.timeout(timeout) });
    if (!res.ok) {
      debug("fetch.patchright", `${url} http ${res.status}`);
      return { text: "" };
    }
    return { text: htmlToMarkdown(await res.text(), url) };
  } catch (e) {
    debug("fetch.patchright", `${url} ${reason(e)}`);
    return { text: "" };
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
  } catch (e) {
    debug("fetch.impit", `${url} ${reason(e)}`);
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
  } catch (e) {
    debug("fetch.tavily", `${url} ${reason(e)}`);
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
  trail: string[];
}

function unusableReason(text: string, status?: number): string {
  if (status !== undefined && status === 0) return "fetch error";
  if (status !== undefined && status !== 200) return `http ${status}`;
  if (!text) return "empty";
  if (text.length < MIN_USABLE_CHARS) return `too short (${text.length}c)`;
  return `bot-wall/shell (${text.length}c)`;
}

interface FetchRung {
  name: string;
  enabled: () => boolean;
  run: (url: string) => Promise<{ text: string; status?: number; credits?: number }>;
}

const patchrightEnabled = () => patchrightBase() !== "";

const FETCH_LADDER: FetchRung[] = [
  { name: "impit", enabled: () => true, run: impitFetch },
  { name: "patchright", enabled: patchrightEnabled, run: (url) => patchrightFetch(url) },
  { name: "patchright+proxy", enabled: patchrightEnabled, run: (url) => patchrightFetch(url, { proxy: true }) },
  { name: "patchright+solver", enabled: patchrightEnabled, run: (url) => patchrightFetch(url, { proxy: true, solve: true }) },
  { name: "tavily", enabled: () => Boolean(tavilyClient()), run: tavilyExtractFetch },
];

async function fetchLadder(url: string): Promise<FetchResult> {
  const trail: string[] = [];
  const best = { text: "", via: "impit" };
  let tavilyCredits = 0;
  for (const rung of FETCH_LADDER) {
    if (!rung.enabled()) {
      trail.push(`${rung.name}: skipped (no env)`);
      continue;
    }
    const started = performance.now();
    const { text, status, credits } = await rung.run(url);
    debug(
      "fetch.ladder",
      `${rung.name} ${url} → ${usable(text) ? `ok (${text.length}c)` : unusableReason(text, status)} ${Math.round(performance.now() - started)}ms`,
    );
    tavilyCredits += credits ?? 0;
    if (usable(text)) {
      trail.push(`${rung.name}: ok (${text.length}c)`);
      return { text, via: rung.name, tavilyCredits, outcome: "ok", trail };
    }
    trail.push(`${rung.name}: ${unusableReason(text, status)}`);
    if (status !== undefined && isDeadStatus(status))
      return { text: "", via: rung.name, tavilyCredits, outcome: "dead", trail };
    if (text) {
      best.text = text;
      best.via = rung.name;
    }
  }
  return { ...best, tavilyCredits, outcome: "transient", trail };
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
      const raw: { url: string; text: string; via: string; trail: string[]; tavilyCredits: number; cached: boolean }[] =
        await Promise.all(
        urls.map(async (url: string) => {
          const { value, cached } = await cache.getOrCompute("fetch", normalizeUrl(url), () => fetchLadder(url), {
            cacheable: (r) => r.outcome === "ok" || r.outcome === "dead",
            ttlMs: (r) => (r.outcome === "dead" ? DEAD_TTL_MS : undefined),
          });
          return { url, text: value.text, via: value.via, trail: value.trail, tavilyCredits: cached ? 0 : value.tavilyCredits, cached };
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
        results: pages.map((p) => ({ url: p.url, chars: p.text.length, preview: clip(p.text), via: p.via, trail: p.trail })),
        cost: tavilyUsd(tavilyCredits),
        cached: pages.length > 0 && pages.every((p) => p.cached),
      });
      return { pages: pages.map(({ url, text }) => ({ url, text })) };
    },
  });
}
