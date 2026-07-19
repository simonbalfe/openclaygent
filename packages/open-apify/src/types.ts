import { z } from "zod";

export const ActorRunSchema = z.object({
  id: z.string(),
  status: z.string(),
  defaultDatasetId: z.string(),
});

export type ActorRun = z.infer<typeof ActorRunSchema>;

export type ActorRunResult<T> = {
  items: T[];
  runId: string;
  datasetId: string;
  status: string;
  durationMs: number;
};

export type ApifyFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type RunActorOptions<T> = {
  actor: string;
  input: unknown;
  itemSchema: z.ZodType<T>;
  token: string;
  timeoutMs?: number;
  waitForFinishSeconds?: number;
  baseUrl?: string;
  fetch?: ApifyFetch;
  onStatus?: (run: ActorRun) => void;
};
