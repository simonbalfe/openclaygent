import type { z } from "zod";
import { buildAgent, DEFAULT_MODEL } from "./agent.ts";
import type { Sink } from "./tools/web.ts";
import type { Action, Row, RunResult } from "./types.ts";

export interface RunOptions {
  /** OpenRouter model id. Defaults to OPENCLAY_MODEL / gpt-4o-mini. */
  model?: string;
  /** Hard cap on agent loop iterations. */
  maxSteps?: number;
  /** Cap output tokens so requests fit a small OpenRouter balance. */
  maxOutputTokens?: number;
}

/** Fill {{field}} slots from the row; record which were missing. */
function fillTemplate(template: string, row: Row): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = row[key];
    if (v === undefined || v === null || v === "") {
      missing.push(key);
      return `[MISSING:${key}]`;
    }
    return String(v);
  });
  return { text, missing };
}

/** Run one action against one row. The core Claygent unit. */
export async function run<S extends z.ZodType>(
  action: Action<S>,
  row: Row,
  opts: RunOptions = {},
): Promise<RunResult<S>> {
  const model = opts.model ?? DEFAULT_MODEL;
  const started = performance.now();

  // Conditional run — skip rows that don't qualify (Clay's credit saver).
  if (action.conditionalRun && !action.conditionalRun(row)) {
    return {
      result: null,
      sources: [],
      agentLog: [],
      tokens: { input: 0, output: 0 },
      durationMs: 0,
      model,
      skipped: true,
    };
  }

  const sink: Sink = { sources: new Set(), log: [] };
  const agent = buildAgent(sink, model);
  const { text, missing } = fillTemplate(action.template, row);
  if (missing.length) console.warn(`[${action.name}] row missing: ${missing.join(", ")}`);

  const res = await agent.generate(
    [
      { role: "system", content: action.instructions },
      { role: "user", content: text },
    ],
    {
      maxSteps: opts.maxSteps ?? 5,
      modelSettings: { maxOutputTokens: opts.maxOutputTokens ?? 1500 },
      structuredOutput: { schema: action.output },
    },
  );

  const out = (res as { object?: z.infer<S> }).object ?? null;
  sink.log.push({ type: "answer" });
  const usage = (res as { usage?: { inputTokens?: number; outputTokens?: number } }).usage ?? {};

  return {
    result: out,
    sources: [...sink.sources],
    agentLog: sink.log,
    tokens: { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0 },
    durationMs: Math.round(performance.now() - started),
    model,
  };
}

/** Run one action across a whole table — the per-row enrichment shape. */
export async function runTable<S extends z.ZodType>(
  action: Action<S>,
  rows: Row[],
  opts: RunOptions = {},
): Promise<RunResult<S>[]> {
  const results: RunResult<S>[] = [];
  for (const row of rows) {
    results.push(await run(action, row, opts));
  }
  return results;
}
