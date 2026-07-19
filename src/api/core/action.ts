import type { z } from "zod";
import { buildSchema } from "./schema.ts";
import { type Action, defineAction, type Row } from "./types.ts";

export interface ActionSpec {
  name?: string;
  instructions: string;
  template: string;
  schema: Record<string, unknown>;
}

export function buildAction(
  spec: ActionSpec,
  opts: { requireField?: string } = {},
): Action<z.ZodType> {
  const requireField = opts.requireField;
  return defineAction({
    name: spec.name ?? "action",
    instructions: spec.instructions,
    template: spec.template,
    schema: spec.schema,
    output: buildSchema(spec.schema),
    conditionalRun: requireField ? (row: Row) => Boolean(row[requireField]) : undefined,
  });
}
