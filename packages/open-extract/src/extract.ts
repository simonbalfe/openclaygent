import { tavily } from "@tavily/core";
import { Impit } from "impit";
import { htmlToMarkdown } from "./html.ts";
import { pdfToText } from "./pdf.ts";
import type { ExtractAttempt, ExtractProvider, ExtractResult } from "./types.ts";

interface Retrieved {
  content: string;
  contentType: ExtractResult["contentType"];
  status?: number;
}

interface Rung {
  provider: ExtractProvider;
  enabled: boolean;
  retrieve: (url: string) => Promise<Retrieved>;
}

const MAX_CHARACTERS = 12_000;
const MIN_USABLE_CHARACTERS = 200;
const DEAD_STATUSES = new Set([401, 404, 410]);
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

const impit = new Impit({ browser: "chrome", timeout: 15_000 });

function debug(message: string): void {
  if (process.env.OPEN_EXTRACT_DEBUG === "1") console.error(`[open-extract] ${message}`);
}

function validateUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must use http or https");
  }
  return url.href;
}

function isUsable(content: string): boolean {
  if (content.length < MIN_USABLE_CHARACTERS) return false;
  if (content.length >= 3000) return true;
  const head = content.slice(0, 4000).toLowerCase();
  return !SHELL_MARKERS.some((marker) => head.includes(marker));
}

function bounded(content: string): string {
  if (content.length <= MAX_CHARACTERS) return content;
  return `${content.slice(0, MAX_CHARACTERS)}\n\n[truncated]`;
}

function classify(content: string, status?: number): ExtractAttempt["outcome"] {
  if (status !== undefined && status >= 400) return status === 403 || status === 429 ? "blocked" : "http-error";
  if (!content) return "empty";
  return isUsable(content) ? "ok" : "blocked";
}

function detail(content: string, status?: number): string | undefined {
  if (status !== undefined && status >= 400) return `HTTP ${status}`;
  if (!content) return "No content returned";
  if (content.length < MIN_USABLE_CHARACTERS) return `Only ${content.length} characters returned`;
  if (!isUsable(content)) return "Response appears to be a JavaScript shell or block page";
  return undefined;
}

async function retrieveWithImpit(url: string): Promise<Retrieved> {
  const response = await impit.fetch(url);
  if (!response.ok) return { content: "", contentType: "unknown", status: response.status };
  const header = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (header.includes("pdf") || new URL(url).pathname.toLowerCase().endsWith(".pdf")) {
    return { content: await pdfToText(await response.arrayBuffer()), contentType: "pdf", status: response.status };
  }
  if (header.includes("html") || !header) {
    return { content: htmlToMarkdown(await response.text(), url), contentType: "html", status: response.status };
  }
  if (header.includes("text")) {
    return { content: (await response.text()).trim(), contentType: "text", status: response.status };
  }
  return { content: "", contentType: "unknown", status: response.status };
}

function patchrightRetriever(baseUrl: string, proxy: boolean, solve: boolean): (url: string) => Promise<Retrieved> {
  return async (url) => {
    const query = new URLSearchParams({ url });
    if (proxy) query.set("proxy", "1");
    if (solve) query.set("solve", "1");
    const timeout = solve ? 120_000 : 45_000;
    const response = await fetch(`${baseUrl}/fetch?${query}`, { signal: AbortSignal.timeout(timeout) });
    if (!response.ok) return { content: "", contentType: "unknown", status: response.status };
    return { content: htmlToMarkdown(await response.text(), url), contentType: "html", status: response.status };
  };
}

function tavilyRetriever(apiKey: string): (url: string) => Promise<Retrieved> {
  const client = tavily({ apiKey });
  return async (url) => {
    const response = await client.extract([url], { extractDepth: "advanced", format: "markdown" });
    return { content: response.results[0]?.rawContent?.trim() ?? "", contentType: "text" };
  };
}

function ladder(): Rung[] {
  const patchrightUrl = (process.env.PATCHRIGHT_URL ?? "http://localhost:9223").replace(/\/+$/, "");
  const tavilyApiKey = process.env.TAVILY_API_KEY ?? "";
  return [
    { provider: "impit", enabled: true, retrieve: retrieveWithImpit },
    { provider: "patchright", enabled: Boolean(patchrightUrl), retrieve: patchrightRetriever(patchrightUrl, false, false) },
    { provider: "patchright+proxy", enabled: Boolean(patchrightUrl), retrieve: patchrightRetriever(patchrightUrl, true, false) },
    { provider: "patchright+solver", enabled: Boolean(patchrightUrl), retrieve: patchrightRetriever(patchrightUrl, true, true) },
    { provider: "tavily", enabled: Boolean(tavilyApiKey), retrieve: tavilyRetriever(tavilyApiKey) },
  ];
}

export async function extract(input: string): Promise<ExtractResult> {
  const url = validateUrl(input);
  debug(`start ${url}`);
  const attempts: ExtractAttempt[] = [];
  let lastProvider: ExtractProvider = "impit";
  let lastType: ExtractResult["contentType"] = "unknown";

  for (const rung of ladder()) {
    lastProvider = rung.provider;
    if (!rung.enabled) {
      attempts.push({ provider: rung.provider, outcome: "skipped", durationMs: 0, detail: "Not configured" });
      debug(`${rung.provider} skipped`);
      continue;
    }
    const started = performance.now();
    try {
      const result = await rung.retrieve(url);
      lastType = result.contentType;
      const outcome = classify(result.content, result.status);
      attempts.push({
        provider: rung.provider,
        outcome,
        durationMs: Math.round(performance.now() - started),
        detail: detail(result.content, result.status),
      });
      debug(`${rung.provider} ${outcome} ${attempts.at(-1)?.durationMs ?? 0}ms${result.status ? ` HTTP ${result.status}` : ""}`);
      if (result.status !== undefined && DEAD_STATUSES.has(result.status)) {
        debug(`stop dead ${rung.provider}`);
        return { url, content: "", contentType: result.contentType, provider: rung.provider, outcome: "dead", attempts };
      }
      if (outcome === "ok") {
        debug(`complete ${rung.provider} ${result.content.length} chars`);
        return { url, content: bounded(result.content), contentType: result.contentType, provider: rung.provider, outcome: "ok", attempts };
      }
    } catch (error) {
      attempts.push({
        provider: rung.provider,
        outcome: "error",
        durationMs: Math.round(performance.now() - started),
        detail: error instanceof Error ? error.message : String(error),
      });
      debug(`${rung.provider} error ${attempts.at(-1)?.durationMs ?? 0}ms: ${attempts.at(-1)?.detail ?? "unknown"}`);
    }
  }

  debug("failed all providers");
  return { url, content: "", contentType: lastType, provider: lastProvider, outcome: "failed", attempts };
}
