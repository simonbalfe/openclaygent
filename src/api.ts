import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { buildAction } from "./core/action.ts";
import { runTable, type RunOptions } from "./core/engine.ts";
import type { Row } from "./core/types.ts";

const RowSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .openapi("Row", { example: { company: "Linear", domain: "linear.app" } });

const RunRequest = z
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
    result: z.unknown(),
    sources: z.array(z.string()),
    agentLog: z.array(z.unknown()),
    tokens: z.object({ input: z.number(), output: z.number() }),
    cost: z.object({
      total: z.number(),
      llm: z.number(),
      tools: z.number(),
      byProvider: z.object({
        openrouter: z.number(),
        exa: z.number(),
        apify: z.number(),
        tavily: z.number(),
      }),
      tavilyCredits: z.number(),
    }),
    durationMs: z.number(),
    model: z.string(),
    skipped: z.boolean().optional(),
  })
  .openapi("RunResult");

const RunResponse = z.object({ results: z.array(RunResultSchema) }).openapi("RunResponse");
const ErrorResponse = z.object({ error: z.string() }).openapi("Error");

const runRoute = createRoute({
  method: "post",
  path: "/run",
  request: { body: { content: { "application/json": { schema: RunRequest } }, required: true } },
  responses: {
    200: { content: { "application/json": { schema: RunResponse } }, description: "Research results, one per row." },
    400: { content: { "application/json": { schema: ErrorResponse } }, description: "Invalid request." },
  },
});

const app = new OpenAPIHono();

app.openapi(runRoute, async (c) => {
  const body = c.req.valid("json");
  let action: ReturnType<typeof buildAction>;
  try {
    action = buildAction(body, { requireField: body.require });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "invalid schema" }, 400);
  }
  const rows: Row[] = body.rows ?? [body.input ?? {}];
  const opts: RunOptions = {};
  if (body.model) opts.model = body.model;
  if (body.maxSteps) opts.maxSteps = body.maxSteps;
  if (body.concurrency) opts.concurrency = body.concurrency;
  const results = await runTable(action, rows, opts);
  return c.json({ results }, 200);
});

app.get("/health", (c) => c.json({ ok: true }));
app.doc("/openapi.json", { openapi: "3.0.0", info: { title: "openclaygent", version: "0.0.1" } });
app.get("/docs", Scalar({ url: "/openapi.json", pageTitle: "openclaygent API" }));

export default { port: Number(process.env.PORT) || 8080, fetch: app.fetch };
