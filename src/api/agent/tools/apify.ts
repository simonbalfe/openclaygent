import { createTool } from "@mastra/core/tools";
import { runActor } from "open-apify";
import { z } from "zod";
import { debug } from "../../core/debug.ts";
import type { ToolStepType } from "../../core/types.ts";
import { assertVerifiedUrl, clip, record, recordEvidence, type RunContext } from "../sink.ts";

async function actorItems<T>(actor: string, input: unknown, itemSchema: z.ZodType<T>): Promise<T[]> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN is not set");
  debug("apify", `${actor} start ${JSON.stringify(input)}`);
  const result = await runActor<T>({
    actor,
    input,
    itemSchema,
    token,
    onStatus: (run) => debug("apify", `${actor} run ${run.id} status ${run.status}`),
  });
  debug(
    "apify",
    `${actor} run ${result.runId} ${result.status} → ${result.items.length} items ${result.durationMs}ms`,
  );
  return result.items;
}

interface StepView {
  title?: string;
  url?: string;
  preview?: string;
}

interface ApifyToolSpec<S extends z.ZodTypeAny, Raw, Item> {
  id: string;
  description: string;
  type: ToolStepType;
  inputSchema: S;
  rawSchema: z.ZodType<Raw>;
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
  context: RunContext,
  spec: ApifyToolSpec<S, Raw, Item>,
) {
  return createTool({
    id: spec.id,
    description: spec.description,
    inputSchema: spec.inputSchema,
    outputSchema: z.object({ [spec.outputKey]: spec.single ? z.unknown() : z.array(z.unknown()) }),
    execute: async (input: z.output<S>) => {
      const { actor, actorInput, query, guard } = spec.prepare(input);
      if (guard) assertVerifiedUrl(context, guard.url, guard.hint);
      const items = await actorItems(actor, actorInput, spec.rawSchema);
      const mapped = spec.map(items, input);
      for (const item of mapped) {
        const url = spec.sourceUrl?.(item);
        if (url) {
          context.urls.sources.add(url);
          recordEvidence(context, { tool: spec.type, url, text: spec.view(item).preview ?? "" });
        }
      }
      record(context, {
        type: spec.type,
        query,
        resultCount: mapped.length,
        results: mapped.map((item) => {
          const { preview, ...rest } = spec.view(item);
          return preview === undefined ? rest : { ...rest, preview: clip(preview) };
        }),
      });
      return { [spec.outputKey]: spec.single ? (mapped[0] ?? null) : mapped };
    },
  });
}
