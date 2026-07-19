import { z } from "@hono/zod-openapi";

const RowSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .openapi("Row", { example: { company: "Linear", domain: "linear.app" } });

export const RunRequestSchema = z
  .object({
    name: z.string().optional(),
    instructions: z.string().openapi({ example: "Identify which CRM the company uses." }),
    template: z.string().openapi({ example: "Company: {{company}} ({{domain}})" }),
    schema: z
      .record(z.string(), z.unknown())
      .openapi({ example: { crm: "string?", confidence: "low|medium|high" } }),
    rows: z.array(RowSchema).optional().openapi({ description: "Batch of rows." }),
    input: RowSchema.optional().openapi({ description: "A single row (used when `rows` is absent)." }),
    model: z.string().optional(),
    maxSteps: z.number().int().positive().optional(),
    concurrency: z.number().int().positive().optional(),
    require: z.string().optional().openapi({ description: "Skip any row missing this field." }),
  })
  .openapi("RunRequest");

const RunResultSchema = z
  .object({
    runId: z.string(),
    result: z.unknown(),
    reasoning: z.string().nullable(),
    sources: z.array(z.string()),
    agentLog: z.array(z.unknown()),
    tokens: z.object({ input: z.number(), output: z.number() }),
    durationMs: z.number(),
    model: z.string(),
    skipped: z.boolean().optional(),
    error: z.string().optional(),
  })
  .openapi("RunResult");

export const RunResponseSchema = z.object({ results: z.array(RunResultSchema) }).openapi("RunResponse");
export const ErrorResponseSchema = z.object({ error: z.string() }).openapi("Error");

export type RunRequest = z.infer<typeof RunRequestSchema>;
export type HttpRunResult = z.infer<typeof RunResultSchema>;
