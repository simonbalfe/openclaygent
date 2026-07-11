export const HELP = `openclaygent — per-row web-research agent

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
  --model <id>            OpenRouter model id (default: google/gemini-3.1-flash-lite).
  --max-steps <n>         Max agent loop iterations (default: 5).
  --concurrency <n>       Rows to research in parallel (default: 5).
  --fast                  Fetch never escalates to the slow anti-bot rungs (proxy, solver) —
                          caps worst-case page latency; hard-walled pages come back empty.
  --json                  Print the full RunResult envelope (sources, agentLog, cost,
                          tokens) instead of just the result.
  --pretty                Human-readable per-row view with cost/token stats.
  --verbose               Adds result previews (titles, URLs, snippets) to the live step
                          trace. The trace always streams to stderr.
  --out <file>            Also write the full results as JSON to this file.
  --help                  Show this.

By default stdout carries the answer: { result, reasoning, sources } — the schema-shaped
result, a one-line why, and the URLs behind it (an array for --rows). Steps, cost, and
tokens are there when you ask (--json).`;

export type Flags = Record<string, string | boolean>;

export interface Parsed {
  flags: Flags;
  inputs: Record<string, string>;
}

export function parseArgs(argv: string[]): Parsed {
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
