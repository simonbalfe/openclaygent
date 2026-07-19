import type { HttpRow, HttpRunResult } from "../api/http.ts";
import type { Flags } from "./args.ts";

function printRow(label: string, r: HttpRunResult): void {
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
  const fields = Object.entries(r.result);
  const width = Math.max(0, ...fields.map(([k]) => k.length));
  for (const [k, v] of fields)
    console.log(`  ${k.padEnd(width)}  ${typeof v === "string" ? v : JSON.stringify(v)}`);
  if (r.reasoning) console.log(`  » ${r.reasoning}`);
}

function printPretty(rows: HttpRow[], results: HttpRunResult[]): void {
  results.forEach((result, index) => {
    const label = Object.values(rows[index] ?? {})[0]?.toString() ?? `row ${index + 1}`;
    printRow(label, result);
  });

  const tokens = results.reduce(
    (total, result) => ({
      input: total.input + result.tokens.input,
      output: total.output + result.tokens.output,
    }),
    { input: 0, output: 0 },
  );
  console.log(
    `\n${rows.length} rows · ${tokens.input} in / ${tokens.output} out tok · ${results[0]?.model}`,
  );
}

function printAnswers(results: HttpRunResult[]): void {
  results.forEach((result, index) => {
    if (result.error) console.error(`row ${index + 1} error: ${result.error}`);
  });
  const answers = results.map(({ result, reasoning, sources }) => ({ result, reasoning, sources }));
  console.log(JSON.stringify(answers.length === 1 ? answers[0] : answers, null, 2));
}

export function renderResults(rows: HttpRow[], results: HttpRunResult[], flags: Flags): void {
  if (flags.json) {
    console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
  } else if (flags.pretty) {
    printPretty(rows, results);
  } else {
    printAnswers(results);
  }
}
