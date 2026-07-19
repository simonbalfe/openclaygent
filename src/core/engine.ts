import { z } from "zod";
import { buildAgent, buildFinalizer, DEFAULT_MODEL } from "./agent.ts";
import { debug } from "./debug.ts";
import { createRunContext, noteUrl, record, type RunContext } from "../tools/sink.ts";
import type { Action, AgentStep, Evidence, Row, RunResult } from "./types.ts";

export interface RunOptions {
  model?: string;
  maxSteps?: number;
  maxOutputTokens?: number;
  concurrency?: number;
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

function serializeEvidence(evidence: Evidence[]): string {
  return evidence
    .filter((item) => item.text)
    .map((item) => `# ${item.tool}: ${item.url}${item.via ? ` [${item.via}]` : ""}\n${item.text}`)
    .join("\n\n");
}

function finalizePrompt(task: string, evidence: Evidence[]): string {
  return [
    task,
    "Research already gathered for this row:",
    serializeEvidence(evidence),
    "Return the JSON now using only the findings above. A field you cannot support is null.",
  ].join("\n\n");
}

function seedRowUrls(context: RunContext, row: Row): void {
  for (const value of Object.values(row)) {
    if (typeof value !== "string") continue;
    for (const match of value.matchAll(/https?:\/\/\S+/g)) noteUrl(context, match[0]);
    for (const match of value.matchAll(/\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\b/gi))
      noteUrl(context, `https://${match[0]}`);
  }
}

function fillTemplate(template: string, row: Row): { text: string; missing: string[] } {
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

function skippedResult<S extends z.ZodType>(model: string, runId: string): RunResult<S> {
  return {
    runId,
    result: null,
    reasoning: null,
    sources: [],
    agentLog: [],
    tokens: { input: 0, output: 0 },
    durationMs: 0,
    model,
    skipped: true,
  };
}

function failedResult<S extends z.ZodType>(
  model: string,
  error: unknown,
  durationMs: number,
  context?: RunContext,
  tokens: { input: number; output: number } = { input: 0, output: 0 },
): RunResult<S> {
  return {
    runId: context?.runId ?? crypto.randomUUID(),
    result: null,
    reasoning: null,
    sources: context ? [...context.urls.sources] : [],
    agentLog: context ? context.trace.events : [],
    tokens,
    durationMs,
    model,
    error: error instanceof Error ? error.message : String(error),
  };
}

class RunFailure<S extends z.ZodType> extends Error {
  constructor(
    error: unknown,
    readonly context: RunContext,
    readonly model: string,
    readonly tokens: { input: number; output: number },
    readonly durationMs: number,
  ) {
    super(error instanceof Error ? error.message : String(error));
    this.name = "RunFailure";
  }
}

interface RunMetrics {
  inputTokens: number;
  outputTokens: number;
}

async function run<S extends z.ZodType>(
  action: Action<S>,
  row: Row,
  opts: RunOptions = {},
): Promise<RunResult<S>> {
  const model = opts.model ?? DEFAULT_MODEL;
  const context = createRunContext(crypto.randomUUID(), opts.onStep);
  if (action.conditionalRun && !action.conditionalRun(row)) return skippedResult(model, context.runId);

  const started = performance.now();
  const metrics: RunMetrics = { inputTokens: 0, outputTokens: 0 };
  seedRowUrls(context, row);
  try {
    return await executeRun(action, row, opts, model, context, metrics, started);
  } catch (error) {
    throw new RunFailure<S>(
      error,
      context,
      model,
      { input: metrics.inputTokens, output: metrics.outputTokens },
      Math.round(performance.now() - started),
    );
  }
}

async function executeRun<S extends z.ZodType>(
  action: Action<S>,
  row: Row,
  opts: RunOptions,
  model: string,
  context: RunContext,
  metrics: RunMetrics,
  started: number,
): Promise<RunResult<S>> {

  const { agent, provider } = buildAgent(context, model);
  const structuredOutput = {
    schema: structuredSchema(action.output),
    model: provider.chat(model),
    errorStrategy: "warn" as const,
  };
  const maxOutputTokens = opts.maxOutputTokens ?? DEFAULT_MAX_TOKENS;

  const { text, missing } = fillTemplate(action.template, row);
  if (missing.length) console.warn(`[${action.name}] row missing: ${missing.join(", ")}`);

  debug("engine", `[${context.runId}] [${action.name}] row start model=${model} task="${text.slice(0, 120)}"`);
  const systemPrompt = { role: "system", content: action.instructions } as const;
  let { object, inputTokens, outputTokens } = tally<S>(
    await agent.generate([systemPrompt, { role: "user", content: text }], {
      maxSteps: opts.maxSteps ?? DEFAULT_MAX_STEPS,
      modelSettings: { maxOutputTokens },
      structuredOutput,
    }),
  );
  metrics.inputTokens = inputTokens;
  metrics.outputTokens = outputTokens;
  debug(
    "engine",
    `[${context.runId}] [${action.name}] agent pass: ${inputTokens} in / ${outputTokens} out tok, ${context.trace.events.length} steps, object=${object !== null} ${Math.round(performance.now() - started)}ms`,
  );

  if (object === null) {
    debug("engine", `[${context.runId}] [${action.name}] structuring returned null → finalizer over ${context.evidence.length} evidence items`);
    const finalize = tally<S>(
      await buildFinalizer(provider, model).generate(
        [systemPrompt, { role: "user", content: finalizePrompt(text, context.evidence) }],
        { modelSettings: { maxOutputTokens: Math.max(maxOutputTokens, FINALIZE_MAX_TOKENS) }, structuredOutput },
      ),
    );
    object = finalize.object;
    inputTokens += finalize.inputTokens;
    outputTokens += finalize.outputTokens;
    metrics.inputTokens = inputTokens;
    metrics.outputTokens = outputTokens;
    debug("engine", `[${context.runId}] [${action.name}] finalizer: object=${object !== null}, +${finalize.inputTokens} in / +${finalize.outputTokens} out tok`);
  }
  record(context, { type: "answer" });

  return {
    runId: context.runId,
    result: object?.answer ?? null,
    reasoning: object?.reasoning ?? null,
    sources: [...context.urls.sources],
    agentLog: context.trace.events,
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
  const limit = Math.max(1, opts.concurrency ?? 5);
  const results = new Array<RunResult<S>>(rows.length);
  const model = opts.model ?? DEFAULT_MODEL;
  let next = 0;
  async function worker(): Promise<void> {
    while (next < rows.length) {
      const i = next++;
      const started = performance.now();
      try {
        results[i] = await run(action, rows[i]!, opts);
      } catch (e) {
        debug("engine", `row ${i} failed: ${e instanceof Error ? e.message : String(e)}`);
        if (e instanceof RunFailure) {
          results[i] = failedResult(model, e, e.durationMs, e.context, e.tokens);
        } else {
          results[i] = failedResult(model, e, Math.round(performance.now() - started));
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, worker));
  return results;
}
