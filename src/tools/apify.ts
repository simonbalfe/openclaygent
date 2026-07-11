import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { Cache } from "../core/cache.ts";
import { debug } from "../core/debug.ts";
import type { AgentStep } from "../core/types.ts";
import { assertVerifiedUrl, clip, record, type Sink } from "./sink.ts";

const APIFY = "https://api.apify.com/v2";

interface ApifyRun {
  id: string;
  status: string;
  defaultDatasetId: string;
  usageTotalUsd?: number;
}

async function runActor<T>(actor: string, input: unknown): Promise<{ items: T[]; usd: number }> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN is not set");
  const started = performance.now();
  debug("apify", `${actor} start ${JSON.stringify(input)}`);
  const start = await fetch(`${APIFY}/acts/${actor}/runs?token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!start.ok) throw new Error(`Apify ${actor} ${start.status}: ${(await start.text()).slice(0, 300)}`);
  let run = ((await start.json()) as { data: ApifyRun }).data;

  const deadline = Date.now() + 150_000;
  while (run.status === "READY" || run.status === "RUNNING") {
    if (Date.now() > deadline) throw new Error(`Apify ${actor} timed out (run ${run.id})`);
    const poll = await fetch(`${APIFY}/actor-runs/${run.id}?token=${token}&waitForFinish=30`);
    if (!poll.ok) throw new Error(`Apify ${actor} poll ${poll.status}: ${(await poll.text()).slice(0, 300)}`);
    run = ((await poll.json()) as { data: ApifyRun }).data;
    debug("apify", `${actor} run ${run.id} status ${run.status}`);
  }

  const itemsRes = await fetch(`${APIFY}/datasets/${run.defaultDatasetId}/items?token=${token}`);
  if (!itemsRes.ok) throw new Error(`Apify ${actor} items ${itemsRes.status}`);
  const items = (await itemsRes.json()) as T[];
  debug(
    "apify",
    `${actor} run ${run.id} ${run.status} → ${items.length} items $${(run.usageTotalUsd ?? 0).toFixed(4)} ${Math.round(performance.now() - started)}ms`,
  );
  return { items, usd: run.usageTotalUsd ?? 0 };
}

async function runActorCached<T>(
  cache: Cache,
  actor: string,
  input: unknown,
): Promise<{ items: T[]; usd: number; cached: boolean }> {
  const { value, cached } = await cache.getOrCompute(
    "apify",
    `${actor}|${JSON.stringify(input)}`,
    () => runActor<T>(actor, input),
    { cacheable: (r) => r.items.length > 0 },
  );
  return { items: value.items as T[], usd: cached ? 0 : value.usd, cached };
}

interface StepView {
  title?: string;
  url?: string;
  preview?: string;
}

interface ApifyToolSpec<S extends z.ZodTypeAny, Raw, Item> {
  id: string;
  description: string;
  type: AgentStep["type"];
  inputSchema: S;
  outputKey: string;
  single?: boolean;
  prepare: (input: z.output<S>) => {
    actor: string;
    actorInput: unknown;
    query: string;
    guard?: { url: string; hint: string };
  };
  map: (items: Raw[], input: z.output<S>) => Item[];
  view: (item: Item) => StepView;
  sourceUrl?: (item: Item) => string;
}

export function apifyTool<S extends z.ZodTypeAny, Raw, Item>(
  sink: Sink,
  cache: Cache,
  spec: ApifyToolSpec<S, Raw, Item>,
) {
  return createTool({
    id: spec.id,
    description: spec.description,
    inputSchema: spec.inputSchema,
    outputSchema: z.object({ [spec.outputKey]: spec.single ? z.unknown() : z.array(z.unknown()) }),
    execute: async (input: z.output<S>) => {
      const { actor, actorInput, query, guard } = spec.prepare(input);
      if (guard) assertVerifiedUrl(sink, guard.url, guard.hint);
      const { items, usd, cached } = await runActorCached<Raw>(cache, actor, actorInput);
      sink.cost.apify += usd;
      const mapped = spec.map(items, input);
      for (const item of mapped) {
        const url = spec.sourceUrl?.(item);
        if (url) sink.sources.add(url);
      }
      record(sink, {
        type: spec.type,
        query,
        resultCount: mapped.length,
        results: mapped.map((item) => {
          const { preview, ...rest } = spec.view(item);
          return preview === undefined ? rest : { ...rest, preview: clip(preview) };
        }),
        cost: usd,
        cached,
      });
      return { [spec.outputKey]: spec.single ? (mapped[0] ?? null) : mapped };
    },
  });
}
