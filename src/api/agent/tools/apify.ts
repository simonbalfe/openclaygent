import { runActor } from "open-apify";
import { z } from "zod";
import { debug } from "../../core/debug.ts";
import type { ToolStepType } from "../../core/types.ts";
import { clip, record, recordEvidence, type RunContext } from "../sink.ts";

export type ProviderView = {
  title?: string;
  url?: string;
  preview?: string;
};

async function runApify<T>(actor: string, input: unknown, itemSchema: z.ZodType<T>): Promise<T[]> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN is not set");
  debug("apify", `${actor} start ${JSON.stringify(input)}`);
  const result = await runActor({
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

export function createApifyRunner<T>(itemSchema: z.ZodType<T>) {
  return (actor: string, input: unknown): Promise<T[]> => runApify(actor, input, itemSchema);
}

export function recordProviderResults(
  context: RunContext,
  type: ToolStepType,
  query: string,
  results: ProviderView[],
  recordSources = true,
): void {
  if (recordSources) {
    for (const result of results) {
      if (!result.url) continue;
      context.urls.sources.add(result.url);
      recordEvidence(context, { tool: type, url: result.url, text: result.preview ?? "" });
    }
  }
  record(context, {
    type,
    query,
    resultCount: results.length,
    results: results.map(({ preview, ...result }) =>
      preview === undefined ? result : { ...result, preview: clip(preview) },
    ),
  });
}
