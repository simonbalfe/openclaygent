import type { CostAccumulator } from "../core/cost.ts";
import type { AgentStep } from "../core/types.ts";

export interface Sink {
  sources: Set<string>;
  seen: Set<string>;
  log: AgentStep[];
  onStep?: (step: AgentStep) => void;
  cost: CostAccumulator;
}

export function record(sink: Sink, step: AgentStep): void {
  sink.log.push(step);
  sink.onStep?.(step);
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.host.replace(/^www\./i, "").toLowerCase();
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    return `${host}${path}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

export function noteUrl(sink: Sink, url: string): void {
  if (url) sink.seen.add(normalizeUrl(url));
}

export function isVerifiedUrl(sink: Sink, url: string): boolean {
  return sink.seen.has(normalizeUrl(url));
}

export function assertVerifiedUrl(sink: Sink, url: string, hint: string): void {
  if (!isVerifiedUrl(sink, url))
    throw new Error(
      `Refusing the URL "${url}": it did not come from a web_search result, a page you already fetched, or this row's input. Never guess or construct URLs. ${hint}`,
    );
}

const URL_IN_TEXT = /https?:\/\/[^\s)<>"'\]]+/g;

export function noteUrlsInText(sink: Sink, text: string): void {
  for (const match of text.matchAll(URL_IN_TEXT)) noteUrl(sink, match[0].replace(/[.,;:]+$/, ""));
}

export function clip(text: string, max = 180): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
