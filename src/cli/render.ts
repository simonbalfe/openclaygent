import type { z } from "zod";
import type { AgentStep, RunCost, RunResult } from "../core/types.ts";

export function money(n: number): string {
  return `$${n.toFixed(4)}`;
}

export function formatStep(s: AgentStep, detailed = false): string[] {
  const lines: string[] = [];
  const details = detailed ? (s.results ?? []) : [];
  if (s.type === "search") {
    lines.push(
      `search    "${s.query}"${s.via ? ` [${s.via}]` : ""} → ${s.resultCount} results${s.cached ? " (cached)" : ""}`,
    );
    details.forEach((r, i) => {
      lines.push(`    ${i + 1}. ${r.title || r.url || ""}`);
      if (r.title && r.url) lines.push(`       ${r.url}`);
      if (r.preview) lines.push(`       "${r.preview}"`);
    });
  } else if (s.type === "fetch") {
    (s.urls ?? []).forEach((u, i) => {
      const d = details[i];
      const via = d?.via ? ` [${d.via}]` : "";
      const chars = d?.chars !== undefined ? ` → ${d.chars} chars` : "";
      lines.push(`fetch     ${u}${via}${chars}`);
      if (d?.preview) lines.push(`       "${d.preview}"`);
    });
  } else if (s.type === "linkedin" || s.type === "crunchbase") {
    lines.push(`${s.type}  ${s.query} → ${s.resultCount} items`);
    details.forEach((r, i) => {
      lines.push(`    ${i + 1}. ${[r.title, r.preview].filter(Boolean).join(" — ")}`);
      if (r.url) lines.push(`       ${r.url}`);
    });
  } else {
    lines.push("answer");
  }
  if (s.cost && lines[0]) lines[0] += ` · ${money(s.cost)}`;
  return lines;
}

function costBreakdown(c: RunCost): string {
  const parts = [`LLM ${money(c.llm)}`];
  if (c.byProvider.exa > 0) parts.push(`exa ${money(c.byProvider.exa)}`);
  if (c.byProvider.apify > 0) parts.push(`apify ${money(c.byProvider.apify)}`);
  if (c.byProvider.tavily > 0) parts.push(`tavily ${money(c.byProvider.tavily)} (${c.tavilyCredits}c)`);
  return parts.join(" · ");
}

export function printRow(label: string, r: RunResult<z.ZodType>, showSteps: boolean): void {
  console.log("");
  if (r.skipped) {
    console.log(`${label}  (skipped)`);
    return;
  }
  if (r.error) {
    console.log(`${label}  error: ${r.error}`);
    return;
  }
  const stats = `${(r.durationMs / 1000).toFixed(1)}s · ${money(r.cost.total)} · ${r.tokens.input} in / ${r.tokens.output} out tok · ${r.sources.length} sources`;
  console.log(`${label}  ${stats}`);
  if (r.cost.tools > 0) console.log(`  cost  ${costBreakdown(r.cost)}`);
  if (showSteps) for (const s of r.agentLog) for (const line of formatStep(s)) console.log(`  ${line}`);
  if (r.result === null || typeof r.result !== "object") {
    console.log(`  ${r.result === null ? "no result" : String(r.result)}`);
    return;
  }
  const fields = Object.entries(r.result as Record<string, unknown>);
  const width = Math.max(0, ...fields.map(([k]) => k.length));
  for (const [k, v] of fields)
    console.log(`  ${k.padEnd(width)}  ${typeof v === "string" ? v : JSON.stringify(v)}`);
}
