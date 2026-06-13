import type { z } from "zod";
import { buildAgent, DEFAULT_MODEL, openrouter } from "./agent.ts";
import { record, type Sink } from "./tools/web.ts";
import type { Action, AgentStep, Row, RunResult } from "./types.ts";

export interface RunOptions {
  model?: string;
  maxSteps?: number;
  maxOutputTokens?: number;
  onStep?: (step: AgentStep) => void;
}

type Generated<S extends z.ZodType> = {
  object?: z.infer<S>;
  usage?: { inputTokens?: number; outputTokens?: number };
};

const RETRY_NUDGE =
  "Your previous attempt returned no structured answer. Use what you found and return the JSON now.";

export function fillTemplate(template: string, row: Row): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const value = row[key];
    if (value === undefined || value === null || value === "") {
      missing.push(key);
      return `[MISSING:${key}]`;
    }
    return String(value);
  });
  return { text, missing };
}

function skippedResult<S extends z.ZodType>(model: string): RunResult<S> {
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

export async function run<S extends z.ZodType>(
  action: Action<S>,
  row: Row,
  opts: RunOptions = {},
): Promise<RunResult<S>> {
  const model = opts.model ?? DEFAULT_MODEL;
  if (action.conditionalRun && !action.conditionalRun(row)) return skippedResult(model);

  const started = performance.now();
  const sink: Sink = { sources: new Set(), log: [], onStep: opts.onStep };
  const agent = buildAgent(sink, model);
  const structuringModel = openrouter.chat(model);
  const { text, missing } = fillTemplate(action.template, row);
  if (missing.length) console.warn(`[${action.name}] row missing: ${missing.join(", ")}`);

  let result: z.infer<S> | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  for (let attempt = 0; attempt < 2 && result === null; attempt++) {
    const prompt = attempt === 0 ? text : `${text}\n\n(${RETRY_NUDGE})`;
    const res = (await agent.generate(
      [
        { role: "system", content: action.instructions },
        { role: "user", content: prompt },
      ],
      {
        maxSteps: opts.maxSteps ?? 5,
        modelSettings: { maxOutputTokens: opts.maxOutputTokens ?? 1500 },
        structuredOutput: { schema: action.output, model: structuringModel },
      },
    )) as Generated<S>;
    result = res.object ?? null;
    inputTokens += res.usage?.inputTokens ?? 0;
    outputTokens += res.usage?.outputTokens ?? 0;
  }
  record(sink, { type: "answer" });

  return {
    result,
    sources: [...sink.sources],
    agentLog: sink.log,
    tokens: { input: inputTokens, output: outputTokens },
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
