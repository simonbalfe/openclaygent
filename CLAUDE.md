# openclaygent — agent guide

Open-source Claygent: per-row web-research agent. NL brief + Zod output schema → typed,
cited JSON for each row of a table. Runtime: **Bun**. Spine: **Mastra + OpenRouter** (one
key, any model). Search/fetch: **Tavily**.

## Run it

- `bun run demo` — runs `src/index.ts` (3-company free-trial enrichment).
- `bun run typecheck` — `tsc --noEmit`.
- Needs `OPENROUTER_API_KEY` + `TAVILY_API_KEY` in `.env` (Bun auto-loads it).

## Shape (one fact, one home)

- The **action** primitive lives in `src/types.ts` (`Action` = instructions + `{{templated}}` inputs + Zod `output` + optional `conditionalRun`). This mirrors Clay's `use-ai` action.
- The **loop** lives in `src/engine.ts` (`run` one row, `runTable` a table). It fills the template, gates on `conditionalRun`, runs the agent, and does **one repair retry** when the structured answer is null.
- The **agent + tools** live in `src/agent.ts` and `src/tools/web.ts`. Tools record into a per-run `Sink` so `sources`/`agentLog` come back on every result.

## Conventions that bite

- **Mastra v1 tool signature**: `execute: async (inputData) => …` — the validated input is the **first arg**, NOT `{ context }`. The old v0 `{ context }` shape silently throws on every call.
- **Structured output needs a separate model**: pass `structuredOutput: { schema, model }`. Schema-only forces a single structured pass that **disables tool-calling** (agent answers from memory, never searches).
- **Token cap** goes in `modelSettings: { maxOutputTokens }`, not a top-level generate option.
- **Model choice**: `openai/gpt-4o-mini` via OpenRouter intermittently 431s ("request headers too large") on tool loops. Default is `deepseek/deepseek-chat` (cheap, open, reliable here). Override per run with `opts.model` or `OPENCLAY_MODEL`.

## Scope

MVP = the single action loop only (~80% of Claygent's value). NOT built yet, by design:
waterfall (ranked-provider fallback), recipe (multi-step chains), model-tiers, batch-over-Neon.
See the vault `projects/claygent_clone/` for the full architecture these extend toward.
