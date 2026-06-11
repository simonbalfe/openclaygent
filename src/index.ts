import { z } from "zod";
import { runTable } from "./engine.ts";
import { defineAction } from "./types.ts";

const freeTrial = defineAction({
  name: "free_trial_check",
  instructions:
    "Determine whether the given company offers a free trial or free tier of its product. Check the company's own site (pricing/product pages) first.",
  template: "Company: {{company}}\nWebsite: {{domain}}",
  conditionalRun: (row) => Boolean(row.domain),
  output: z.object({
    has_free_trial: z.boolean().nullable().describe("true if a free trial OR free tier exists"),
    plan_type: z
      .enum(["free_trial", "free_tier", "freemium", "none", "unknown"])
      .describe("Which kind of free offering, if any"),
    evidence_url: z.string().nullable().describe("The exact page proving the answer"),
    confidence: z.enum(["low", "medium", "high"]),
  }),
});

const table = [
  { company: "Linear", domain: "linear.app" },
  { company: "Clay", domain: "clay.com" },
  { company: "Notion", domain: "notion.so" },
];

console.log(`\nEnriching ${table.length} rows  ·  action="${freeTrial.name}"\n`);

const results = await runTable(freeTrial, table, { maxSteps: 4, maxOutputTokens: 1200 });

let inTok = 0;
let outTok = 0;
table.forEach((row, i) => {
  const r = results[i]!;
  inTok += r.tokens.input;
  outTok += r.tokens.output;
  if (r.skipped) {
    console.log(`• ${row.company.padEnd(10)} SKIPPED (no domain)`);
    return;
  }
  const o = r.result;
  console.log(
    `• ${row.company.padEnd(10)} ${JSON.stringify(o)}\n` +
      `  steps=${r.agentLog.map((s) => s.type).join("→")}  ${r.durationMs}ms  ${r.tokens.input}/${r.tokens.output} tok  src=${r.sources.length}`,
  );
});

console.log(`\nTotal tokens: ${inTok} in / ${outTok} out  (model: ${results[0]?.model})\n`);
