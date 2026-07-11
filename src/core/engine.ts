import { z } from "zod";
import { buildAgent, buildFinalizer, DEFAULT_MODEL } from "./agent.ts";
import type { Cache } from "./cache.ts";
import { createCacheFromEnv } from "./cache-pg.ts";
import { emptyCost, tavilyUsd } from "./cost.ts";
import { debug } from "./debug.ts";
import { noteUrl, record, type Sink } from "../tools/sink.ts";
import type { Action, AgentStep, Row, RunCost, RunResult } from "./types.ts";

export interface RunOptions {
  model?: string;
  maxSteps?: number;
  maxOutputTokens?: number;
  concurrency?: number;
  fast?: boolean;
  onStep?: (step: AgentStep) => void;
}

const DEFAULT_MAX_STEPS = 5;
const DEFAULT_MAX_TOKENS = 1500;
const FINALIZE_MAX_TOKENS = 4000;

interface Structured<S extends z.ZodType> {
  answer: z.infer<S>;
  reasoning?: string;
}

interface PassResult<S extends z.ZodType> {
  object: Structured<S> | null;
  inputTokens: number;
  outputTokens: number;
}

function tally<S extends z.ZodType>(res: unknown): PassResult<S> {
  const { object, usage } = res as {
    object?: Structured<S>;
    usage?: { inputTokens?: number; outputTokens?: number };
  };
  return {
    object: object ?? null,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
  };
}

function structuredSchema<S extends z.ZodType>(output: S) {
  return z.object({
    answer: output,
    reasoning: z
      .string()
      .describe("One or two sentences: which sources settled the answer and how. Cite the deciding URL(s)."),
  });
}

function serializeFindings(log: AgentStep[]): string {
  const blocks: string[] = [];
  for (const step of log) {
    if (step.type === "answer") continue;
    const head =
      step.type === "fetch"
        ? `fetched: ${(step.urls ?? []).join(", ")}`
        : `${step.type}: ${step.query ?? ""}${step.via ? ` [${step.via}]` : ""}`;
    const lines = (step.results ?? []).map((r) => {
      const label = [r.title, r.url].filter(Boolean).join(" — ");
      return `  - ${label}${r.preview ? `\n    ${r.preview}` : ""}`;
    });
    blocks.push(lines.length ? `# ${head}\n${lines.join("\n")}` : `# ${head}`);
  }
  return blocks.join("\n\n");
}

function finalizePrompt(task: string, log: AgentStep[]): string {
  return [
    task,
    "Research already gathered for this row:",
    serializeFindings(log),
    "Return the JSON now using only the findings above. A field you cannot support is null.",
  ].join("\n\n");
}

function seedRowUrls(sink: Sink, row: Row): void {
  for (const value of Object.values(row)) {
    if (typeof value !== "string") continue;
    for (const match of value.matchAll(/https?:\/\/\S+/g)) noteUrl(sink, match[0]);
    for (const match of value.matchAll(/\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\b/gi))
      noteUrl(sink, `https://${match[0]}`);
  }
}

function assembleCost(sink: Sink): RunCost {
  const tavily = tavilyUsd(sink.cost.tavilyCredits);
  const llm = sink.cost.openrouter;
  const tools = sink.cost.exa + sink.cost.apify + tavily;
  return {
    total: llm + tools,
    llm,
    tools,
    byProvider: { openrouter: llm, exa: sink.cost.exa, apify: sink.cost.apify, tavily },
    tavilyCredits: sink.cost.tavilyCredits,
  };
}

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
    reasoning: null,
    sources: [],
    agentLog: [],
    tokens: { input: 0, output: 0 },
    cost: ZERO_COST,
    durationMs: 0,
    model,
    skipped: true,
  };
}

function failedResult<S extends z.ZodType>(
  model: string,
  error: unknown,
  durationMs: number,
): RunResult<S> {
  return {
    result: null,
    reasoning: null,
    sources: [],
    agentLog: [],
    tokens: { input: 0, output: 0 },
    cost: ZERO_COST,
    durationMs,
    model,
    error: error instanceof Error ? error.message : String(error),
  };
}

export async function run<S extends z.ZodType>(
  action: Action<S>,
  row: Row,
  opts: RunOptions = {},
  cache: Cache = createCacheFromEnv(),
): Promise<RunResult<S>> {
  const model = opts.model ?? DEFAULT_MODEL;
  if (action.conditionalRun && !action.conditionalRun(row)) return skippedResult(model);

  const started = performance.now();
  const sink: Sink = { sources: new Set(), seen: new Set(), log: [], onStep: opts.onStep, cost: emptyCost() };
  seedRowUrls(sink, row);

  const { agent, provider } = buildAgent(sink, model, cache, opts.fast ?? false);
  const structuredOutput = {
    schema: structuredSchema(action.output),
    model: provider.chat(model),
    errorStrategy: "warn" as const,
  };
  const maxOutputTokens = opts.maxOutputTokens ?? DEFAULT_MAX_TOKENS;

  const { text, missing } = fillTemplate(action.template, row);
  if (missing.length) console.warn(`[${action.name}] row missing: ${missing.join(", ")}`);

  debug("engine", `[${action.name}] row start model=${model} task="${text.slice(0, 120)}"`);
  const systemPrompt = { role: "system", content: action.instructions } as const;
  let { object, inputTokens, outputTokens } = tally<S>(
    await agent.generate([systemPrompt, { role: "user", content: text }], {
      maxSteps: opts.maxSteps ?? DEFAULT_MAX_STEPS,
      modelSettings: { maxOutputTokens },
      structuredOutput,
    }),
  );
  debug(
    "engine",
    `[${action.name}] agent pass: ${inputTokens} in / ${outputTokens} out tok, ${sink.log.length} steps, object=${object !== null} ${Math.round(performance.now() - started)}ms`,
  );

  if (object === null) {
    debug("engine", `[${action.name}] structuring returned null → finalizer over ${sink.log.length} gathered steps`);
    const finalize = tally<S>(
      await buildFinalizer(provider, model).generate(
        [systemPrompt, { role: "user", content: finalizePrompt(text, sink.log) }],
        { modelSettings: { maxOutputTokens: Math.max(maxOutputTokens, FINALIZE_MAX_TOKENS) }, structuredOutput },
      ),
    );
    object = finalize.object;
    inputTokens += finalize.inputTokens;
    outputTokens += finalize.outputTokens;
    debug("engine", `[${action.name}] finalizer: object=${object !== null}, +${finalize.inputTokens} in / +${finalize.outputTokens} out tok`);
  }
  record(sink, { type: "answer" });

  return {
    result: object?.answer ?? null,
    reasoning: object?.reasoning ?? null,
    sources: [...sink.sources],
    agentLog: sink.log,
    tokens: { input: inputTokens, output: outputTokens },
    cost: assembleCost(sink),
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
  const cache = createCacheFromEnv();
  const model = opts.model ?? DEFAULT_MODEL;
  let next = 0;
  async function worker(): Promise<void> {
    while (next < rows.length) {
      const i = next++;
      const started = performance.now();
      try {
        results[i] = await run(action, rows[i]!, opts, cache);
      } catch (e) {
        debug("engine", `row ${i} failed: ${e instanceof Error ? e.message : String(e)}`);
        results[i] = failedResult(model, e, Math.round(performance.now() - started));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, worker));
  return results;
}
