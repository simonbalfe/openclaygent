import {
  HttpRowSchema,
  RequestActionSchema,
  type HttpRow,
  type RequestAction,
  type RunRequest,
} from "../api/http.ts";
import type { Flags } from "./args.ts";

type RequestOptions = Pick<RunRequest, "model" | "maxSteps" | "concurrency" | "require">;

const DEFAULT_API_URL = "http://localhost:8080";

function parseCSV(text: string): HttpRow[] {
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
  const rows = grid.map((row) =>
    Object.fromEntries(header.map((column, index) => [column.trim(), row[index] ?? ""])),
  );
  return HttpRowSchema.array().parse(rows);
}

async function loadCsvRows(path: string): Promise<HttpRow[]> {
  if (!path.toLowerCase().endsWith(".csv")) throw new Error("--rows requires a .csv file");
  return parseCSV(await Bun.file(path).text());
}

export async function resolveRows(flags: Flags, inputs: HttpRow): Promise<HttpRow[]> {
  return flags.rows ? loadCsvRows(flags.rows) : [inputs];
}

export function prepareRows(rows: HttpRow[]): HttpRow[] {
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)),
  );
}

export function resolveApiUrl(flags: Flags): string {
  return flags["api-url"] ?? process.env.OPENCLAYGENT_API_URL ?? DEFAULT_API_URL;
}

export async function loadActionSpec(flags: Flags): Promise<RequestAction> {
  if (flags.action) {
    const action: unknown = JSON.parse(await Bun.file(flags.action).text());
    return RequestActionSchema.parse(action);
  }
  if (!flags.instructions || !flags.template || !flags.schema) {
    throw new Error("Need --instructions, --template, and --schema (or --action <file>). See --help.");
  }
  const schema: unknown = JSON.parse(flags.schema);
  return RequestActionSchema.parse({ instructions: flags.instructions, template: flags.template, schema });
}

export function buildRequestOptions(flags: Flags): RequestOptions {
  const opts: RequestOptions = {};
  if (flags.model) opts.model = flags.model;
  if (flags["max-steps"]) opts.maxSteps = flags["max-steps"];
  if (flags.concurrency) opts.concurrency = flags.concurrency;
  if (flags.require) opts.require = flags.require;
  return opts;
}
