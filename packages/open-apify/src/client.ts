import { z } from "zod";
import {
  ActorRunSchema,
  type ActorRun,
  type ActorRunResult,
  type ApifyFetch,
  type RunActorOptions,
} from "./types.ts";

const DEFAULT_BASE_URL = "https://api.apify.com/v2";
const ACTIVE_STATUSES = new Set(["READY", "RUNNING"]);
const ActorRunResponseSchema = z.object({ data: ActorRunSchema });

function actorRun(value: unknown): ActorRun {
  const parsed = ActorRunResponseSchema.safeParse(value);
  if (!parsed.success) throw new Error("Apify returned an invalid run response");
  return parsed.data.data;
}

async function responseError(response: Response): Promise<string> {
  return (await response.text()).slice(0, 300);
}

async function requestJson(fetcher: ApifyFetch, url: URL, label: string, init?: RequestInit): Promise<unknown> {
  const response = await fetcher(url, init);
  if (!response.ok) throw new Error(`${label} ${response.status}: ${await responseError(response)}`);
  return response.json();
}

function endpoint(baseUrl: string, path: string, token: string, params?: Record<string, string>): URL {
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/${path}`);
  url.searchParams.set("token", token);
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
  return url;
}

export async function runActor<T>(options: RunActorOptions<T>): Promise<ActorRunResult<T>> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = options.timeoutMs ?? 150_000;
  const waitForFinishSeconds = options.waitForFinishSeconds ?? 30;
  const started = performance.now();
  let run = actorRun(
    await requestJson(
      fetcher,
      endpoint(baseUrl, `acts/${options.actor}/runs`, options.token),
      `Apify ${options.actor}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options.input),
      },
    ),
  );
  options.onStatus?.(run);

  const deadline = Date.now() + timeoutMs;
  while (ACTIVE_STATUSES.has(run.status)) {
    if (Date.now() > deadline) throw new Error(`Apify ${options.actor} timed out (run ${run.id})`);
    run = actorRun(
      await requestJson(
        fetcher,
        endpoint(baseUrl, `actor-runs/${run.id}`, options.token, { waitForFinish: String(waitForFinishSeconds) }),
        `Apify ${options.actor} poll`,
      ),
    );
    options.onStatus?.(run);
  }

  const dataset = z.array(options.itemSchema).safeParse(
    await requestJson(
      fetcher,
      endpoint(baseUrl, `datasets/${run.defaultDatasetId}/items`, options.token),
      `Apify ${options.actor} items`,
    ),
  );
  if (!dataset.success) throw new Error(`Apify ${options.actor} returned an invalid dataset`);
  return {
    items: dataset.data,
    runId: run.id,
    datasetId: run.defaultDatasetId,
    status: run.status,
    durationMs: Math.round(performance.now() - started),
  };
}
