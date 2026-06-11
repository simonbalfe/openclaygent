# openclaygent

Open-source Claygent — a per-row web-research agent for the **last-mile data problem**.

Give it a natural-language question + the shape of the answer, and it researches the
live web for every row of a table and returns **typed, cited JSON**. The niche facts no
static provider (ZoomInfo, Apollo, Clearbit) sells — "does this company offer a free
trial?", "count their open eng roles", "what CRM do they use" — run as one reusable action
across a whole list, cheaply, on bring-your-own keys.

## How it works

```
input:   action (instructions + {{templated inputs}} + Zod output schema) + a row
agent:   Mastra agent on an OpenRouter model
tools:   web_search  ·  fetch_page          ← search snippets first, read pages only if needed
output:  { result, sources, agentLog, tokens, durationMs, model }
```

- **One key, any model** — OpenRouter spine (DeepSeek default; swap to Claude/GPT/Llama per run).
- **Conditional run** — skip rows that don't qualify before spending a token (Clay's #1 credit saver).
- **Repair retry** — one re-ask if the model returns no structured answer; the line between "usually works" and reliable at scale.
- **Provenance** — every source URL and tool step recorded for replay.

This is the single `use-ai` **action** loop — ~80% of Claygent's value. Waterfalls,
recipes, model-tiers, and batch-over-Neon are the documented next extensions.

## Setup

```bash
bun install
cp .env.example .env   # add OPENROUTER_API_KEY and TAVILY_API_KEY
bun run demo           # enriches 3 company rows into a free-trial column
```

## Define your own action

```ts
import { z } from "zod";
import { defineAction } from "./src/types.ts";
import { runTable } from "./src/engine.ts";

const action = defineAction({
  name: "uses_crm",
  instructions: "Identify which CRM the company uses, from their site or public posts.",
  template: "Company: {{company}}\nWebsite: {{domain}}",
  conditionalRun: (row) => Boolean(row.domain),
  output: z.object({
    crm: z.string().nullable(),
    evidence_url: z.string().nullable(),
    confidence: z.enum(["low", "medium", "high"]),
  }),
});

const rows = [{ company: "Linear", domain: "linear.app" }];
console.log(await runTable(action, rows));
```

## Layout

| File | Role |
|---|---|
| `src/types.ts`    | the `Action` primitive + `RunResult` contract |
| `src/tools/web.ts`| `web_search` + `fetch_page` (Tavily), record sources & steps |
| `src/agent.ts`    | Mastra agent on OpenRouter, tuned research behaviour |
| `src/engine.ts`   | `run()` one row · `runTable()` a table · template-fill · conditional-run · repair retry |
| `src/index.ts`    | runnable demo |
