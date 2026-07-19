import { expect, test } from "bun:test";
import { z } from "zod";
import { runTable } from "../src/core/engine.ts";
import { defineAction } from "../src/core/types.ts";

const live = test.skipIf(!process.env.RUN_LIVE || !process.env.OPENROUTER_API_KEY);

live(
  "researches one URL and returns a cited structured answer",
  async () => {
    const action = defineAction({
      name: "example_domain_check",
      instructions: "Open the supplied URL and identify what the page says example domains are intended for. Use live web evidence and answer conservatively.",
      template: "URL: {{url}}",
      output: z.object({
        intended_for_documentation: z.boolean(),
        owner: z.string(),
      }),
    });

    const [result] = await runTable(
      action,
      [{ url: "https://www.iana.org/help/example-domains" }],
      { maxSteps: 4, concurrency: 1 },
    );

    expect(result?.error).toBeUndefined();
    expect(result?.result).toEqual({
      intended_for_documentation: true,
      owner: expect.stringMatching(/IANA|Internet Assigned Numbers Authority/i),
    });
    expect(result?.sources.some((url) => url.includes("iana.org/help/example-domains"))).toBeTrue();
    expect(result?.agentLog.some((step) => step.type === "fetch")).toBeTrue();
    expect(result?.tokens.input).toBeGreaterThan(0);
  },
  90_000,
);
