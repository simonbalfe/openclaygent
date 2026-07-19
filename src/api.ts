import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { buildAction } from "./core/action.ts";
import { runTable, type RunOptions } from "./core/engine.ts";
import { ErrorResponseSchema, RunRequestSchema, RunResponseSchema } from "./core/http.ts";
import type { Row } from "./core/types.ts";

const runRoute = createRoute({
  method: "post",
  path: "/run",
  request: { body: { content: { "application/json": { schema: RunRequestSchema } }, required: true } },
  responses: {
    200: { content: { "application/json": { schema: RunResponseSchema } }, description: "Research results, one per row." },
    400: { content: { "application/json": { schema: ErrorResponseSchema } }, description: "Invalid request." },
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
