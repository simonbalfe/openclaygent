# openclaygent — agent guide

Per-row web-research agent: NL brief + Zod output schema → typed, cited JSON for each row
of a table. Runtime **Bun**. Spine **Mastra + OpenRouter** (one key, any model). Search and
fetch are both cheapest-first ladders (self-hosted rungs → paid fallback, each skipped when
its env is unset) — mechanism and rung order in `docs/architecture.md` (The tools) and
`docs/decisions.md` (Search ladder, Fetch ladder).

## Run it

- `bun run setup` — one-shot interactive setup (`scripts/setup.ts`): checks Bun/Docker, `bun install`, creates `.env`, prompts for keys (OpenRouter required; Exa/Tavily/Apify optional), offers `docker compose up -d`. The service URLs are auto-defaulted in code, never prompted.
- `bun run cli -- --help` — the CLI entry (`src/cli.ts`); see `docs/architecture.md` (CLI).
- `bun run api` — the HTTP entry (`src/api.ts`, Hono + OpenAPI): `POST /run`, `/docs`, `/openapi.json`, `/health` on `PORT` (default 8080). Both entries share `core/action.ts` + `runTable` — never duplicate run logic into either. See `docs/architecture.md` (HTTP API).
- `bun test` — the test suite (`tests/`); the live test is skipped unless `RUN_LIVE=1`.
- `bun run typecheck` — `tsc --noEmit`.
- `bun run knip` — dead-code / unused-export / unused-dep check (config: `knip.json`; entries are the CLI (auto-detected from package.json) + tests).
- `docker compose up -d` — starts the local stack: SearXNG on :8888 (`searxng/settings.yml` enables the JSON API the tool needs; `searxng/entrypoint.sh` injects the Evomi residential proxy from `EVOMI_*` env into `outgoing.proxies` at start, so engine scrapes are not CAPTCHA-blocked — see `docs/decisions.md`, Search ladder) and the patchright fetch service on :9223. The `claygent` CLI itself is `profiles: [cli]`, so `up` never starts it.
- `docker compose run --rm claygent <cli args>` — the CLI containerized (`Dockerfile`, profile `cli` so `up` never starts it); talks to SearXNG at `http://searxng:8080` inside the stack.
- Needs `OPENROUTER_API_KEY` in `.env` (Bun auto-loads it). `SEARXNG_URL` / `PATCHRIGHT_URL` are auto-defaulted to the compose ports (`localhost:8888` / `localhost:9223`); set them only to point elsewhere, or empty to disable that rung. `EXA_API_KEY` is optional (paid search fallback + no-Docker path).

## Key files

- `src/core/types.ts` — `Action` primitive + `RunResult` contract.
- `src/core/engine.ts` — `run` (one row), `runTable` (a table).
- `src/core/agent.ts` — Mastra agent + cost-tapped OpenRouter provider.
- `src/core/action.ts` — `ActionSpec` + `buildAction`, the shared adapter both frontends call (no duplicated assembly); `src/core/schema.ts` — JSON-Schema/short-form → Zod builder.
- `src/tools/` — one concern per file: `web.ts` (assembler) · `search.ts` (`web_search` + ladder) · `fetch.ts` (`fetch_page` + ladder, PDF via unpdf) · `providers.ts` (exa/tavily/impit clients) · `sink.ts` (`Sink`/`record`/`clip` + URL provenance: `noteUrl`/`assertVerifiedUrl`) · `extract.ts` (JSON-LD/meta structured data → Readability→prune→Turndown) · `apify.ts` (shared `runActor`) · `linkedin.ts` · `crunchbase.ts` (fallback-only).
- `src/core/cost.ts` — per-provider cost accumulator + OpenRouter response cost extractor (exact-USD reporting).
- `src/cli.ts` (CLI entry) + `src/cli/` (`args.ts` parse · `input.ts` rows/action/options · `render.ts` output).
- `src/api.ts` — HTTP entry (Hono + `@hono/zod-openapi`): `POST /run`, `/openapi.json`, `/docs`, `/health`.
- `tests/` — `bun test` suite (schema, skip path, template fill, extractor, search ladder, URL-fabrication guard; live opt-in).

## Docs (read before changing code)

- `docs/walkthrough.md` — plain-language tour of the whole flow + the reasoning for each step (the narrative "why"; points to architecture/decisions for detail).
- `docs/architecture.md` — the action primitive, the loop, the contract, the file map (canonical — other docs point here, never copy it), scope.
- `docs/decisions.md` — the non-obvious choices and the conventions that bite (Mastra v1 tool signature, separate structuring model, token cap, model choice, finalization fallback, model tiering). Read this before touching the agent, tools, or engine — each gotcha silently breaks a run.
- `docs/roadmap.md` — feature checklist: what's shipped and what's still to add (parity gaps vs Claygent + Ferret).

## Standing orders

- **No explanatory comments in source.** Architecture and rationale live in `docs/`, code stays comment-free. Zod `.describe()` and tool `description` strings are functional schema, not comments — keep those.
- Scope (what's built vs the deliberate extensions) is owned by `docs/architecture.md`; point there rather than restating it.
- `.claude/settings.json` carries the only hooks: a judgment-based doc-sync pair (SessionStart ownership pointer + Stop doc-update check); see `docs/decisions.md` for why nothing heavier.
- **Stay in this repo when the task is focused.** Reason only about openclaygent's own code, infra, and constraints. Do NOT pull in unrelated projects, external databases, or deployment details unless the task explicitly calls for them — that outside context biases a focused answer toward infra that isn't part of this problem.
