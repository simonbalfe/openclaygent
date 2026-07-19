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
  --rows <file.csv>       A batch of rows from a CSV file with a header.

Options:
  --model <id>            OpenRouter model id (default: google/gemini-3.1-flash-lite).
  --max-steps <n>         Max agent loop iterations (default: 5).
  --concurrency <n>       Rows to research in parallel (default: 5).
  --api-url <url>         Openclaygent API (overrides required OPENCLAYGENT_API_URL).
  --json                  Print the full RunResult envelope (sources, agentLog, tokens)
                          instead of just the result.
  --pretty                Human-readable per-row view with token stats.
  --out <file>            Also write the full results as JSON to this file.
  --help                  Show this.

By default stdout carries the answer: { result, reasoning, sources } — the schema-shaped
result, a one-line why, and the URLs behind it (an array for --rows). The CLI always sends
the run to the Openclaygent API; steps and tokens are there when you ask (--json).`;

const FlagsSchema = z
  .object({
    action: z.string().optional(),
    instructions: z.string().optional(),
    template: z.string().optional(),
    schema: z.string().optional(),
    require: z.string().optional(),
    rows: z.string().optional(),
    model: z.string().optional(),
    "max-steps": z.coerce.number().int().positive().optional(),
    concurrency: z.coerce.number().int().positive().optional(),
    "api-url": z.string().optional(),
    out: z.string().optional(),
    json: z.boolean().default(false),
    pretty: z.boolean().default(false),
    help: z.boolean().default(false),
  })
  .strict();

export type Flags = z.infer<typeof FlagsSchema>;

export interface Parsed {
  flags: Flags;
  inputs: Record<string, string>;
}

export function parseArgs(argv: string[]): Parsed {
  const flags: Record<string, string | boolean> = {};
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
  return { flags: FlagsSchema.parse(flags), inputs };
}
import { z } from "zod";
