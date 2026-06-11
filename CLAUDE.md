# openclaygent — agent guide

Per-row web-research agent: NL brief + Zod output schema → typed, cited JSON for each row
of a table. Runtime **Bun**. Spine **Mastra + OpenRouter** (one key, any model). Search/
fetch via **Exa**.

## Run it

- `bun run cli -- --help` — the CLI, the only runtime entry (`src/cli.ts`); see `docs/architecture.md` (CLI).
- `bun test` — the test suite (`tests/`); the live test is skipped unless `RUN_LIVE=1`.
- `bun run typecheck` — `tsc --noEmit`.
- `bun run knip` — dead-code / unused-export / unused-dep check (config: `knip.json`, library surface is `src/engine.ts`).
- Needs `OPENROUTER_API_KEY` + `EXA_API_KEY` in `.env` (Bun auto-loads it).

## Key files

- `src/types.ts` — `Action` primitive + `RunResult` contract.
- `src/engine.ts` — `run` (one row), `runTable` (a table).
- `src/agent.ts` + `src/tools/web.ts` — Mastra agent + `web_search`/`fetch_page`.
- `src/cli.ts` + `src/schema.ts` — CLI front end + JSON-Schema/short-form → Zod builder.
- `tests/` — `bun test` suite (schema, skip path; live opt-in).

## Docs (read before changing code)

- `docs/architecture.md` — the action primitive, the loop, the contract, file map, scope.
- `docs/decisions.md` — the non-obvious choices and the conventions that bite (Mastra v1 tool signature, separate structuring model, token cap, model choice, repair retry). Read this before touching the agent, tools, or engine — each gotcha silently breaks a run.
- `docs/roadmap.md` — feature checklist: what's shipped and what's still to add (parity gaps vs Claygent + Ferret).

## Standing orders

- **No explanatory comments in source.** Architecture and rationale live in `docs/`, code stays comment-free. Zod `.describe()` and tool `description` strings are functional schema, not comments — keep those.
- Scope (what's built vs the deliberate extensions) is owned by `docs/architecture.md`; point there rather than restating it.
- No `.claude/` rules or hooks yet — deliberate; see `docs/decisions.md`.
