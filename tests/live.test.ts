import { expect, test } from "bun:test";
import { z } from "zod";
import { run } from "../src/core/engine.ts";
import { defineAction } from "../src/core/types.ts";

const live = test.skipIf(!process.env.RUN_LIVE);

live(
  "live: enriches a real company row with a cited answer",
  async () => {
    const action = defineAction({
      name: "industry",
      instructions: "What industry is this company in? Check their website first.",
      template: "Company: {{company}}\nWebsite: {{domain}}",
      output: z.object({ industry: z.string(), confidence: z.enum(["low", "medium", "high"]) }),
    });

    const r = await run(action, { company: "Linear", domain: "linear.app" }, { maxSteps: 4 });

    expect(r.result?.industry).toBeTruthy();
    expect(r.sources.length).toBeGreaterThan(0);
    expect(r.tokens.input).toBeGreaterThan(0);
  },
  90_000,
);
