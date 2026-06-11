import type { z } from "zod";
import { buildAgent, DEFAULT_MODEL, openrouter } from "./agent.ts";
import type { Sink } from "./tools/web.ts";
import type { Action, Row, RunResult } from "./types.ts";

export interface RunOptions {
  model?: string;
  maxSteps?: number;
  maxOutputTokens?: number;
}

export function fillTemplate(template: string, row: Row): { text: string; missing: string[] } {
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

export async function run<S extends z.ZodType>(
  action: Action<S>,
  row: Row,
  opts: RunOptions = {},
): Promise<RunResult<S>> {
  const model = opts.model ?? DEFAULT_MODEL;
  const started = performance.now();

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

  let out: z.infer<S> | null = null;
  let usage: { inputTokens?: number; outputTokens?: number } = {};
  for (let attempt = 0; attempt < 2 && out === null; attempt++) {
    const nudge =
      attempt === 0
        ? text
        : `${text}\n\n(Your previous attempt returned no structured answer. Use what you found and return the JSON now.)`;
    const res = await agent.generate(
      [
        { role: "system", content: action.instructions },
        { role: "user", content: nudge },
      ],
      {
        maxSteps: opts.maxSteps ?? 5,
        modelSettings: { maxOutputTokens: opts.maxOutputTokens ?? 1500 },
        structuredOutput: { schema: action.output, model: openrouter.chat(model) },
      },
    );
    out = (res as { object?: z.infer<S> }).object ?? null;
    const u = (res as { usage?: { inputTokens?: number; outputTokens?: number } }).usage ?? {};
    usage = {
      inputTokens: (usage.inputTokens ?? 0) + (u.inputTokens ?? 0),
      outputTokens: (usage.outputTokens ?? 0) + (u.outputTokens ?? 0),
    };
  }
  sink.log.push({ type: "answer" });

  return {
    result: out,
    sources: [...sink.sources],
    agentLog: sink.log,
    tokens: { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0 },
    durationMs: Math.round(performance.now() - started),
    model,
  };
}

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
