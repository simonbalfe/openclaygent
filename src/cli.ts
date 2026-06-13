import { runTable, type RunOptions } from "./engine.ts";
import { buildSchema } from "./schema.ts";
import { defineAction, type AgentStep, type Row, type RunResult } from "./types.ts";
import type { z } from "zod";

const HELP = `openclaygent — per-row web-research agent

Usage:
  openclaygent --instructions <text> --template <text> --schema <json> [rows] [options]
  openclaygent --action <file.json> [rows] [options]

Action (inline):
  --instructions <text>   What to research / how to behave (system prompt).
  --template <text>       User prompt with {{field}} slots, e.g. "Company: {{company}}".
  --schema <json>         Output shape. Standard JSON Schema, or the short form:
                          '{"industry":"string","confidence":"low|medium|high"}'.
                          Short types: string | number | boolean | a|b|c (enum) | trailing ? = nullable.
  --action <file.json>    Load { name, instructions, template, schema } from a file instead.
  --require <field>       Skip any row missing this field (conditionalRun).

Rows (pick one):
  --input k=v             A single row field. Repeatable: --input company=Clay --input domain=clay.com
  --rows <file.json|csv>  A batch of rows (JSON array of objects, or CSV with a header).

Options:
  --model <id>            OpenRouter model id (default: deepseek/deepseek-chat).
  --max-steps <n>         Max agent loop iterations (default: 5).
  --json                  Print raw JSON results instead of the table.
  --verbose               Stream agent steps live with result previews (titles, URLs,
                          snippets, page sizes). Goes to stderr when --json is set.
  --out <file>            Also write results as JSON to this file.
  --help                  Show this.`;

type Flags = Record<string, string | boolean>;

interface Parsed {
  flags: Flags;
  inputs: Record<string, string>;
}

function parseArgs(argv: string[]): Parsed {
  const flags: Flags = {};
  const inputs: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (key === "input") {
      const [name, ...rest] = (next ?? "").split("=");
      if (name && rest.length) inputs[name] = rest.join("=");
      i++;
    } else if (next === undefined || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i++;
    }
  }
  return { flags, inputs };
}

function parseCSV(text: string): Row[] {
  const grid: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += c;
    } else if (c === '"') {
      inQ = true;
    } else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      field = "";
      if (record.length > 1 || record[0] !== "") grid.push(record);
      record = [];
    } else field += c;
  }
  if (field !== "" || record.length) {
    record.push(field);
    grid.push(record);
  }
  const header = grid.shift();
  if (!header) return [];
  return grid.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ""])));
}

async function loadRows(path: string): Promise<Row[]> {
  const text = await Bun.file(path).text();
  if (path.toLowerCase().endsWith(".csv")) return parseCSV(text);
  const data = JSON.parse(text);
  return Array.isArray(data) ? data : [data];
}

function formatStep(s: AgentStep, detailed = false): string[] {
  const lines: string[] = [];
  const details = detailed ? (s.results ?? []) : [];
  if (s.type === "search") {
    lines.push(`search    "${s.query}"${s.via ? ` [${s.via}]` : ""} → ${s.resultCount} results`);
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
  } else if (s.type === "linkedin") {
    lines.push(`linkedin  ${s.query} → ${s.resultCount} items`);
    details.forEach((r, i) => {
      lines.push(`    ${i + 1}. ${[r.title, r.preview].filter(Boolean).join(" — ")}`);
      if (r.url) lines.push(`       ${r.url}`);
    });
  } else {
    lines.push("answer");
  }
  return lines;
}

function printRow(label: string, r: RunResult<z.ZodType>, showSteps: boolean): void {
  console.log("");
  if (r.skipped) {
    console.log(`${label}  (skipped)`);
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
}

interface ActionSpec {
  name?: string;
  instructions: string;
  template: string;
  schema: Record<string, unknown>;
}

async function loadActionSpec(flags: Flags): Promise<ActionSpec> {
  if (typeof flags.action === "string") return JSON.parse(await Bun.file(flags.action).text());
  if (typeof flags.instructions !== "string" || typeof flags.template !== "string" || typeof flags.schema !== "string") {
    console.error("Need --instructions, --template, and --schema (or --action <file>). See --help.");
    process.exit(1);
  }
  return { instructions: flags.instructions, template: flags.template, schema: JSON.parse(flags.schema) };
}

function buildOptions(flags: Flags): RunOptions {
  const opts: RunOptions = {};
  if (typeof flags.model === "string") opts.model = flags.model;
  if (typeof flags["max-steps"] === "string") opts.maxSteps = Number(flags["max-steps"]);
  if (flags.verbose) {
    const emit = flags.json ? console.error : console.log;
    opts.onStep = (s) =>
      formatStep(s, true).forEach((line) =>
        emit(line.startsWith(" ") ? `    ${line}` : `  › ${line}`),
      );
  }
  return opts;
}

const { flags, inputs } = parseArgs(Bun.argv.slice(2));

if (flags.help || Bun.argv.length <= 2) {
  console.log(HELP);
  process.exit(0);
}

const spec = await loadActionSpec(flags);
const requireField = typeof flags.require === "string" ? flags.require : undefined;
const action = defineAction({
  name: spec.name ?? "cli_action",
  instructions: spec.instructions,
  template: spec.template,
  output: buildSchema(spec.schema),
  conditionalRun: requireField ? (row) => Boolean(row[requireField]) : undefined,
});

const rows: Row[] = typeof flags.rows === "string" ? await loadRows(flags.rows) : [inputs];
const results = await runTable(action, rows, buildOptions(flags));

if (flags.json) {
  console.log(JSON.stringify(rows.length === 1 ? results[0] : results, null, 2));
} else {
  rows.forEach((row, i) =>
    printRow(Object.values(row)[0]?.toString() ?? `row ${i + 1}`, results[i]!, !flags.verbose),
  );
  const totals = results.reduce(
    (acc, r) => ({ input: acc.input + r.tokens.input, output: acc.output + r.tokens.output }),
    { input: 0, output: 0 },
  );
  console.log(`\n${rows.length} rows · ${totals.input} in / ${totals.output} out tok · ${results[0]?.model}`);
}

if (typeof flags.out === "string") {
  await Bun.write(flags.out, JSON.stringify(results, null, 2));
  console.log(`Wrote ${flags.out}`);
}
