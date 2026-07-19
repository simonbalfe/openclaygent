import type { z } from "zod";
import type { AgentStep, RunResult } from "../core/types.ts";

export function formatStep(s: AgentStep, detailed = false): string[] {
  const lines: string[] = [];
  if (s.type === "search") {
    const details = detailed ? s.results : [];
    lines.push(
      `search    "${s.query}" [${s.via}] → ${s.resultCount} results`,
    );
    if (s.trail?.length) lines.push(`    ladder: ${s.trail.join(" → ")}`);
    details.forEach((r, i) => {
      lines.push(`    ${i + 1}. ${r.title || r.url || ""}`);
      if (r.title && r.url) lines.push(`       ${r.url}`);
      if (r.preview) lines.push(`       "${r.preview}"`);
    });
  } else if (s.type === "fetch") {
    s.urls.forEach((u, i) => {
      const all = s.results;
      const d = all[i];
      const via = d?.via ? ` [${d.via}]` : "";
      const chars = d?.chars !== undefined ? ` → ${d.chars} chars` : "";
      lines.push(`fetch     ${u}${via}${chars}`);
      if (d?.trail?.length) lines.push(`    ladder: ${d.trail.join(" → ")}`);
      if (detailed && d?.preview) lines.push(`       "${d.preview}"`);
    });
  } else if (s.type === "linkedin" || s.type === "crunchbase") {
    const details = detailed ? s.results : [];
    lines.push(`${s.type}  ${s.query} → ${s.resultCount} items`);
    details.forEach((r, i) => {
      lines.push(`    ${i + 1}. ${[r.title, r.preview].filter(Boolean).join(" — ")}`);
      if (r.url) lines.push(`       ${r.url}`);
    });
  } else {
    lines.push("answer");
  }
  return lines;
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
  const stats = `${(r.durationMs / 1000).toFixed(1)}s · ${r.tokens.input} in / ${r.tokens.output} out tok · ${r.sources.length} sources`;
  console.log(`${label}  ${stats}`);
  if (showSteps) for (const s of r.agentLog) for (const line of formatStep(s)) console.log(`  ${line}`);
  if (r.result === null || typeof r.result !== "object") {
    console.log(`  ${r.result === null ? "no result" : String(r.result)}`);
    return;
  }
  const fields = Object.entries(r.result as Record<string, unknown>);
  const width = Math.max(0, ...fields.map(([k]) => k.length));
  for (const [k, v] of fields)
    console.log(`  ${k.padEnd(width)}  ${typeof v === "string" ? v : JSON.stringify(v)}`);
  if (r.reasoning) console.log(`  » ${r.reasoning}`);
}
