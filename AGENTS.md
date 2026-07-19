# openclaygent — agent guide

Per-row web-research agent: NL brief + Zod output schema → typed, cited JSON for each row
of a table. Runtime **Bun**. Spine **Mastra + OpenRouter** (one key, any model). Search and
fetch are both cheapest-first ladders (self-hosted rungs → paid fallback, each skipped when
its env is unset) — mechanism and rung order in `docs/architecture.md` (The tools) and
`docs/decisions.md` (Search ladder, Fetch ladder).

## Run it

- `curl -fsSL <raw>/scripts/install.sh | bash` — the from-nothing entry (`scripts/install.sh`): clones the repo to `$HOME/openclaygent` (override `OPENCLAYGENT_DIR`/`OPENCLAYGENT_REPO`), installs Bun if missing, then execs `bun run scripts/setup.ts` with stdin bound to `/dev/tty` so the key prompts work even under `curl | bash`.
- `bun run setup` — the one-click entry once cloned (`scripts/setup.ts`, needs Bun): installs and links the thin CLI, creates `.env`, reuses exported keys, prompts only for missing keys, pulls the three public images, then runs `docker compose up -d --wait --wait-timeout 180`. Success means the API, SearXNG, and Patchright health checks all passed.
- `bun run cli -- --help` — the thin HTTP CLI (`src/cli.ts`); it parses local files, calls `POST /run` at `OPENCLAYGENT_API_URL` (default `localhost:8080`), and renders the response. It never imports or runs the engine. Setup runs `bun link`, so a global `openclaygent` command also points at the install dir.
- `./scripts/uninstall.sh` — clean wipe (confirm-gated, `-y`/`OPENCLAYGENT_YES=1` to skip). Reverts only what the install adds: `docker compose down -v`, removes the `openclaygent-api` + patchright images (all tags), `bun unlink` + drops the global `openclaygent` bin (only if it links into an openclaygent checkout), deletes `$HOME/openclaygent` (override `OPENCLAYGENT_DIR`) but only after confirming it's an openclaygent checkout and not `/`/`$HOME`. Never touches the shared `searxng` base image, other projects, or `~/.zshrc` keys.
- `bun run api` — the only research runtime (`src/api.ts`, Hono + OpenAPI): `POST /run`, `/docs`, `/openapi.json`, `/health` on `PORT` (default 8080). It owns `buildAction` + `runTable`; the CLI is only a client. See `docs/architecture.md` (HTTP API).
- `bun run test:e2e` — the single live end-to-end test; requires `OPENROUTER_API_KEY` and exercises one URL through the full agent flow.
- `bun run typecheck` — `tsc --noEmit`.
- `bun run knip` — dead-code / unused-export / unused-dependency check.
- `docker compose up -d --wait` — pulls the three public GHCR images and starts SearXNG on :8888, Patchright on :9223, and the sole research runtime/API on :8080; returns only after every health check passes.
- Needs `OPENROUTER_API_KEY` in `.env` (Bun auto-loads it). `SEARXNG_URL` / `PATCHRIGHT_URL` are auto-defaulted to the compose ports (`localhost:8888` / `localhost:9223`); set them only to point elsewhere, or empty to disable that rung. `EXA_API_KEY` is optional (paid search fallback + no-Docker path).

## Key files

- `src/core/types.ts` — `Action` primitive + `RunResult` contract.
- `src/core/engine.ts` — `run` (one row), `runTable` (a table).
- `src/core/agent.ts` — Mastra agent + OpenRouter provider.
- `src/core/action.ts` — `ActionSpec` + `buildAction`, used by the API runtime; `src/core/schema.ts` — JSON-Schema/short-form → Zod builder; `src/core/http.ts` — shared validated HTTP contract.
- `src/tools/` — Openclaygent adapters and enrichment tools: `web.ts` (assembler) · `search.ts` (evidence adapter around `open-search`) · `fetch.ts` (URL guard/evidence adapter around `open-extract`) · `sink.ts` (run provenance and trace) · `apify.ts` · `linkedin.ts` · `crunchbase.ts`.
- `packages/open-search/` — isolated query-to-results package with its own provider ladder, CLI, dependencies, and `searxng/` service configuration.
- `packages/open-extract/` — isolated URL-to-Markdown package with its own source, CLI, dependencies, and `patchright/` rendered-browser service.
- `src/core/debug.ts` — `OPENCLAY_DEBUG=1` API stderr tracer (adapter outcomes, swallowed errors, Apify status, and LLM latency). The standalone search and extraction CLIs use `--debug`.
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
- Documentation synchronization is review-driven; update the canonical owner named above whenever behavior or wiring changes.
- **Stay in this repo when the task is focused.** Reason only about openclaygent's own code, infra, and constraints. Do NOT pull in unrelated projects, external databases, or deployment details unless the task explicitly calls for them — that outside context biases a focused answer toward infra that isn't part of this problem.
