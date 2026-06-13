# openclaygent — agent guide

Per-row web-research agent: NL brief + Zod output schema → typed, cited JSON for each row
of a table. Runtime **Bun**. Spine **Mastra + OpenRouter** (one key, any model). Search and
fetch are both cheapest-first ladders (self-hosted rungs → paid fallback, each skipped when
its env is unset) — mechanism and rung order in `docs/architecture.md` (The tools) and
`docs/decisions.md` (Search ladder, Fetch ladder).

## Run it

- `bun run cli -- --help` — the CLI, the only runtime entry (`src/cli.ts`); see `docs/architecture.md` (CLI).
- `bun test` — the test suite (`tests/`); the live test is skipped unless `RUN_LIVE=1`.
- `bun run typecheck` — `tsc --noEmit`.
- `bun run knip` — dead-code / unused-export / unused-dep check (config: `knip.json`; entries are the CLI (auto-detected from package.json) + tests).
- `docker compose up -d` — starts the local stack: SearXNG on :8888 (`searxng/settings.yml` enables the JSON API the tool needs) and the patchright fetch service on :9223. The `claygent` CLI itself is `profiles: [cli]`, so `up` never starts it.
- `docker compose run --rm claygent <cli args>` — the CLI containerized (`Dockerfile`, profile `cli` so `up` never starts it); talks to SearXNG at `http://searxng:8080` inside the stack.
- Needs `OPENROUTER_API_KEY` + `EXA_API_KEY` in `.env` (Bun auto-loads it); `SEARXNG_URL=http://localhost:8888` routes search through the compose service.

## Key files

- `src/types.ts` — `Action` primitive + `RunResult` contract.
- `src/engine.ts` — `run` (one row), `runTable` (a table).
- `src/agent.ts` + `src/tools/web.ts` — Mastra agent + `web_search`/`fetch_page`.
- `src/cost.ts` — per-provider cost accumulator + OpenRouter response cost extractor (exact-USD reporting).
- `src/cli.ts` + `src/schema.ts` — CLI front end + JSON-Schema/short-form → Zod builder.
- `tests/` — `bun test` suite (schema, skip path, template fill, extractor, search ladder; live opt-in).

## Docs (read before changing code)

- `docs/architecture.md` — the action primitive, the loop, the contract, the file map (canonical — other docs point here, never copy it), scope.
- `docs/decisions.md` — the non-obvious choices and the conventions that bite (Mastra v1 tool signature, separate structuring model, token cap, model choice, repair retry). Read this before touching the agent, tools, or engine — each gotcha silently breaks a run.
- `docs/roadmap.md` — feature checklist: what's shipped and what's still to add (parity gaps vs Claygent + Ferret).

## Standing orders

- **No explanatory comments in source.** Architecture and rationale live in `docs/`, code stays comment-free. Zod `.describe()` and tool `description` strings are functional schema, not comments — keep those.
- Scope (what's built vs the deliberate extensions) is owned by `docs/architecture.md`; point there rather than restating it.
- `.claude/settings.json` carries the only hooks: a judgment-based doc-sync pair (SessionStart ownership pointer + Stop doc-update check); see `docs/decisions.md` for why nothing heavier.
