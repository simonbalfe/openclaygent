import type { ActionSpec } from "../core/action.ts";
import type { RunOptions } from "../core/engine.ts";
import type { Row } from "../core/types.ts";
import type { Flags } from "./args.ts";
import { formatStep } from "./render.ts";

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

export async function loadRows(path: string): Promise<Row[]> {
  const text = await Bun.file(path).text();
  if (path.toLowerCase().endsWith(".csv")) return parseCSV(text);
  const data = JSON.parse(text);
  return Array.isArray(data) ? data : [data];
}

export async function loadActionSpec(flags: Flags): Promise<ActionSpec> {
  if (typeof flags.action === "string") return JSON.parse(await Bun.file(flags.action).text());
  if (typeof flags.instructions !== "string" || typeof flags.template !== "string" || typeof flags.schema !== "string") {
    console.error("Need --instructions, --template, and --schema (or --action <file>). See --help.");
    process.exit(1);
  }
  return { instructions: flags.instructions, template: flags.template, schema: JSON.parse(flags.schema) };
}

export function buildOptions(flags: Flags): RunOptions {
  const opts: RunOptions = {};
  if (typeof flags.model === "string") opts.model = flags.model;
  if (typeof flags["max-steps"] === "string") {
    const n = Number(flags["max-steps"]);
    if (Number.isFinite(n)) opts.maxSteps = n;
  }
  if (typeof flags.concurrency === "string") {
    const n = Number(flags.concurrency);
    if (Number.isFinite(n)) opts.concurrency = n;
  }
  opts.onStep = (s) =>
    formatStep(s, Boolean(flags.verbose)).forEach((line) =>
      console.error(line.startsWith(" ") ? `    ${line}` : `  › ${line}`),
    );
  return opts;
}
