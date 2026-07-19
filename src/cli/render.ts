import type { HttpRunResult } from "../core/http.ts";

export function printRow(label: string, r: HttpRunResult): void {
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
