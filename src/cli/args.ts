export const HELP = `openclaygent — per-row web-research agent

Usage:
  openclaygent --instructions <text> --template <text> --schema <json> [row options]
  openclaygent --action <file.json> [row options]

Define the research:
  --instructions <text>  What the agent should research and how it should behave.
  --template <text>      Per-row prompt with {{field}} slots, e.g. "Company: {{company}}".
  --schema <json>        Exact output shape as JSON Schema or short form:
                         '{"industry":"string","confidence":"low|medium|high"}'
                         Types: string | number | boolean | a|b|c | trailing ? for nullable.
  --action <file.json>   Load { name, instructions, template, schema } from one file.

Choose rows:
  --input k=v            Add a field to one row. Repeat for multiple fields.
                         Example: --input company=Clay --input domain=clay.com
  --rows <file.csv>      Research every row in a CSV file with a header.
  --require <field>      Skip rows where this field is empty.

Control the research:
  --model <id>           OpenRouter model id (default: google/gemini-3.1-flash-lite).
  --max-steps <n>        Maximum agent tool/reasoning steps per row (default: 5).
  --concurrency <n>      Rows researched in parallel (default: 5).

Search and extraction:
  Search is automatic: SearXNG → Serper → Exa → Tavily.
  Page extraction is automatic: HTTP → rendered browser → anti-bot fallbacks.
  Provider rungs are enabled by the API service environment; there are no CLI provider flags.

Connect to the API:
  --api-url <url>        API URL for this run. Otherwise uses OPENCLAYGENT_API_URL.

Choose output:
  --json                Full result including sources, agent steps, tokens, and timing.
  --pretty              Human-readable result with token and timing statistics.
  --out <file>          Write the full results to a JSON file.
  --help                Show this page.

Default stdout is { result, reasoning, sources }. The CLI only sends requests; search,
extraction, model calls, and per-run trace files are owned by the API service.`;

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
