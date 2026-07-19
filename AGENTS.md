# openclaygent — agent guide

Per-row web-research agent: NL brief + Zod output schema → typed, cited JSON for each row
of a table. Runtime **Bun**. Spine **Mastra + OpenRouter** (one key, any model). Search and
fetch are both cheapest-first ladders (self-hosted rungs → paid fallback, each skipped when
its env is unset) — mechanism and rung order in `docs/architecture.md` (The tools) and
`docs/decisions.md` (Search ladder, Fetch ladder).

## Run it

- `curl -fsSL <raw>/scripts/install.sh | bash` — the from-nothing entry (`scripts/install.sh`): clones the repo to `$HOME/openclaygent` (override `OPENCLAYGENT_DIR`/`OPENCLAYGENT_REPO`), installs Bun if missing, then execs `bun run scripts/setup.ts` with stdin bound to `/dev/tty` so the key prompts work even under `curl | bash`.
- `bun run setup` — the one-click entry once cloned (`scripts/setup.ts`, needs Bun): `bun install`, creates `.env`, reuses any keys already exported in the shell env (skips prompting for those; also lets non-interactive `curl | bash` self-configure), prompts only for the rest (OpenRouter required; Exa/Tavily/Apify optional), and offers `docker compose up -d` which brings up the free stack **and** the API. The service URLs are auto-defaulted in code, never prompted.
- `bun run cli -- --help` — the CLI entry (`src/cli.ts`); see `docs/architecture.md` (CLI). Setup runs `bun link`, so a global `openclaygent` command (package.json `bin`) also points at the install dir.
- `./scripts/uninstall.sh` — clean wipe (confirm-gated, `-y`/`OPENCLAYGENT_YES=1` to skip). Reverts only what the install adds: `docker compose down -v`, removes the `openclaygent-api` + patchright images (all tags), `bun unlink` + drops the global `openclaygent` bin (only if it links into an openclaygent checkout), deletes `$HOME/openclaygent` (override `OPENCLAYGENT_DIR`) but only after confirming it's an openclaygent checkout and not `/`/`$HOME`. Never touches the shared `searxng` base image, other projects, or `~/.zshrc` keys.
- `bun run api` — the HTTP entry (`src/api.ts`, Hono + OpenAPI): `POST /run`, `/docs`, `/openapi.json`, `/health` on `PORT` (default 8080). Both entries share `core/action.ts` + `runTable` — never duplicate run logic into either. See `docs/architecture.md` (HTTP API).
- `bun run test:e2e` — the single live end-to-end test; requires `OPENROUTER_API_KEY` and exercises one URL through the full agent flow.
- `bun run typecheck` — `tsc --noEmit`.
- `bun run knip` — dead-code / unused-export / unused-dependency check.
- `docker compose up -d` — pulls the three public GHCR images and starts SearXNG on :8888, Patchright on :9223, and the API on :8080. The `claygent` CLI is `profiles: [cli]`, so `up` never starts that one.
- `docker compose run --rm claygent <cli args>` — the CLI containerized (`Dockerfile`, profile `cli` so `up` never starts it); talks to SearXNG at `http://searxng:8080` inside the stack.
- Needs `OPENROUTER_API_KEY` in `.env` (Bun auto-loads it). `SEARXNG_URL` / `PATCHRIGHT_URL` are auto-defaulted to the compose ports (`localhost:8888` / `localhost:9223`); set them only to point elsewhere, or empty to disable that rung. `EXA_API_KEY` is optional (paid search fallback + no-Docker path).

## Key files

- `src/core/types.ts` — `Action` primitive + `RunResult` contract.
- `src/core/engine.ts` — `run` (one row), `runTable` (a table).
- `src/core/agent.ts` — Mastra agent + OpenRouter provider.
- `src/core/action.ts` — `ActionSpec` + `buildAction`, the shared adapter both frontends call (no duplicated assembly); `src/core/schema.ts` — JSON-Schema/short-form → Zod builder.
- `src/tools/` — Openclaygent adapters and enrichment tools: `web.ts` (assembler) · `search.ts` (evidence adapter around `open-search`) · `fetch.ts` (URL guard/evidence adapter around `open-extract`) · `sink.ts` (run provenance and trace) · `apify.ts` · `linkedin.ts` · `crunchbase.ts`.
- `packages/open-search/` — isolated query-to-results package with its own provider ladder, CLI, dependencies, and `searxng/` service configuration.
- `packages/open-extract/` — isolated URL-to-Markdown package with its own source, CLI, dependencies, and `patchright/` rendered-browser service.
- `src/core/debug.ts` — `OPENCLAY_DEBUG=1` stderr tracer (rung timings, swallowed errors, Apify status, and LLM latency).
- `src/cli.ts` (CLI entry) + `src/cli/` (`args.ts` parse · `input.ts` rows/action/options · `render.ts` output).
- `src/api.ts` — HTTP entry (Hono + `@hono/zod-openapi`): `POST /run`, `/openapi.json`, `/docs`, `/health`.

## Workspace routing

Use this root guide for every workspace. Route changes by ownership:

- `src/` is the Openclaygent application. It owns Mastra orchestration, row execution, schemas, provenance, evidence, traces, CLI, and HTTP API.
- `packages/open-search/` is the framework-agnostic search project. Its public operation is `search(query, options?)`. It owns the provider ladder, diagnostics, standalone CLI, and `searxng/` service configuration. It must never import from the root `src/` tree or own agent provenance and orchestration. Run `bun run typecheck` from that package after changes.
- `packages/open-extract/` is the framework-agnostic extraction project. Its public operation is `extract(url)`. It owns retrieval, HTML/PDF conversion, diagnostics, standalone CLI, and the `patchright/` service. It must never import from the root `src/` tree or own search, provenance, databases, or orchestration. Run `bun run typecheck` from that package after changes.
- Root adapters in `src/tools/search.ts` and `src/tools/fetch.ts` translate package results into Openclaygent evidence and trace records. Keep provider mechanics inside their packages.
- Keep source comment-free across every workspace and put durable rationale in the relevant Markdown documentation.

## Docs (read before changing code)

- `docs/architecture.md` — the action primitive, the loop, the contract, the file map (canonical — other docs point here, never copy it), scope.
- `docs/decisions.md` — the non-obvious choices and the conventions that bite (Mastra v1 tool signature, separate structuring model, token cap, model choice, finalization fallback, model tiering). Read this before touching the agent, tools, or engine — each gotcha silently breaks a run.
- `docs/roadmap.md` — feature checklist: what's shipped and what's still to add (parity gaps vs Claygent + Ferret).

## Standing orders

- **No explanatory comments in source.** Architecture and rationale live in `docs/`, code stays comment-free. Zod `.describe()` and tool `description` strings are functional schema, not comments — keep those.
- Scope (what's built vs the deliberate extensions) is owned by `docs/architecture.md`; point there rather than restating it.
- `.claude/settings.json` carries the only hooks: a judgment-based doc-sync pair (SessionStart ownership pointer + Stop doc-update check); see `docs/decisions.md` for why nothing heavier.
- **Stay in this repo when the task is focused.** Reason only about openclaygent's own code, infra, and constraints. Do NOT pull in unrelated projects, external databases, or deployment details unless the task explicitly calls for them — that outside context biases a focused answer toward infra that isn't part of this problem.
