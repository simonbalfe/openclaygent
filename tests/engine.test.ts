import { expect, test } from "bun:test";
import { z } from "zod";
import { fillTemplate, run } from "../src/engine.ts";
import { defineAction } from "../src/types.ts";

test("fillTemplate substitutes row values and flags missing ones", () => {
  expect(fillTemplate("Hi {{a}} at {{b}}", { a: "x" })).toEqual({
    text: "Hi x at [MISSING:b]",
    missing: ["b"],
  });
});

test("conditionalRun=false skips the row with no LLM call", async () => {
  const action = defineAction({
    name: "skip_test",
    instructions: "irrelevant",
    template: "Company: {{company}}",
    conditionalRun: (row) => Boolean(row.domain),
    output: z.object({ ok: z.boolean() }),
  });

  const r = await run(action, { company: "X" });

  expect(r.skipped).toBe(true);
  expect(r.result).toBeNull();
  expect(r.tokens).toEqual({ input: 0, output: 0 });
  expect(r.cost.total).toBe(0);
  expect(r.sources).toEqual([]);
  expect(r.agentLog).toEqual([]);
});
