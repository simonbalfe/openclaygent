import type { AgentStep, Evidence } from "../core/types.ts";

interface UrlLedger {
  sources: Set<string>;
  seen: Set<string>;
}

interface RunTrace {
  events: AgentStep[];
  onStep?: (step: AgentStep) => void;
}

export interface RunContext {
  runId: string;
  urls: UrlLedger;
  evidence: Evidence[];
  trace: RunTrace;
}

export function createRunContext(runId: string, onStep?: (step: AgentStep) => void): RunContext {
  return { runId, urls: { sources: new Set(), seen: new Set() }, evidence: [], trace: { events: [], onStep } };
}

export function record(context: RunContext, step: AgentStep): void {
  context.trace.events.push(step);
  context.trace.onStep?.(step);
}

export function recordEvidence(context: RunContext, evidence: Evidence): void {
  context.evidence.push(evidence);
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

export function noteUrl(context: RunContext, url: string): void {
  if (url) context.urls.seen.add(normalizeUrl(url));
}

function isVerifiedUrl(context: RunContext, url: string): boolean {
  return context.urls.seen.has(normalizeUrl(url));
}

export function assertVerifiedUrl(context: RunContext, url: string, hint: string): void {
  if (!isVerifiedUrl(context, url))
    throw new Error(
      `Refusing the URL "${url}": it did not come from a web_search result, a page you already fetched, or this row's input. Never guess or construct URLs. ${hint}`,
    );
}

const URL_IN_TEXT = /https?:\/\/[^\s)<>"'\]]+/g;

export function noteUrlsInText(context: RunContext, text: string): void {
  for (const match of text.matchAll(URL_IN_TEXT)) noteUrl(context, match[0].replace(/[.,;:]+$/, ""));
}

export function clip(text: string, max = 180): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
