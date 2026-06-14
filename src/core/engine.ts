import type { z } from "zod";
import { buildAgent, DEFAULT_MODEL } from "./agent.ts";
import { emptyCost, tavilyUsd } from "./cost.ts";
import { noteUrl, record, type Sink } from "../tools/sink.ts";
import type { Action, AgentStep, Row, RunCost, RunResult } from "./types.ts";

export interface RunOptions {
  model?: string;
  maxSteps?: number;
  maxOutputTokens?: number;
  concurrency?: number;
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

const ZERO_COST: RunCost = {
  total: 0,
  llm: 0,
  tools: 0,
  byProvider: { openrouter: 0, exa: 0, apify: 0, tavily: 0 },
  tavilyCredits: 0,
};

function skippedResult<S extends z.ZodType>(model: string): RunResult<S> {
  return {
    result: null,
    sources: [],
    agentLog: [],
    tokens: { input: 0, output: 0 },
    cost: ZERO_COST,
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
  const sink: Sink = { sources: new Set(), seen: new Set(), log: [], onStep: opts.onStep, cost: emptyCost() };
  for (const value of Object.values(row)) {
    if (typeof value !== "string") continue;
    for (const match of value.matchAll(/https?:\/\/\S+/g)) noteUrl(sink, match[0]);
    for (const match of value.matchAll(/\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\b/gi))
      noteUrl(sink, `https://${match[0]}`);
  }
  const { agent, provider } = buildAgent(sink, model);
  const structuringModel = provider.chat(model);
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
        structuredOutput: { schema: action.output, model: structuringModel, errorStrategy: "warn" },
      },
    )) as Generated<S>;
    result = res.object ?? null;
    inputTokens += res.usage?.inputTokens ?? 0;
    outputTokens += res.usage?.outputTokens ?? 0;
  }
  record(sink, { type: "answer" });

  const tavily = tavilyUsd(sink.cost.tavilyCredits);
  const llm = sink.cost.openrouter;
  const tools = sink.cost.exa + sink.cost.apify + tavily;
  const cost: RunCost = {
    total: llm + tools,
    llm,
    tools,
    byProvider: { openrouter: llm, exa: sink.cost.exa, apify: sink.cost.apify, tavily },
    tavilyCredits: sink.cost.tavilyCredits,
  };

  return {
    result,
    sources: [...sink.sources],
    agentLog: sink.log,
    tokens: { input: inputTokens, output: outputTokens },
    cost,
    durationMs: Math.round(performance.now() - started),
    model,
  };
}

export async function runTable<S extends z.ZodType>(
  action: Action<S>,
  rows: Row[],
  opts: RunOptions = {},
): Promise<RunResult<S>[]> {
  const limit = Math.max(1, opts.concurrency ?? 5);
  const results = new Array<RunResult<S>>(rows.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < rows.length) {
      const i = next++;
      results[i] = await run(action, rows[i]!, opts);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, worker));
  return results;
}
