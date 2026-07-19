# openclaygent

Openclaygent runs a web-research agent once per table row and returns typed, cited JSON.
It uses Bun, Mastra, OpenRouter, and an HTTP API with a thin CLI client.

Humans and agents use the same documentation. Keep headings descriptive, paragraphs short,
and operational steps in bullets. Each fact has one canonical home. Other files link to it.

## Start here

- `README.md`: purpose, quick start, and a minimal example.
- `docs/usage-guide.md`: CLI and API procedures, schemas, batches, and troubleshooting.
- `docs/architecture.md`: current runtime, contracts, boundaries, and file ownership.
- `docs/decisions.md`: rationale and constraints that are easy to break accidentally.
- `docs/roadmap.md`: current gaps and planned work.

Read `docs/architecture.md` before changing boundaries or runtime wiring. Read the relevant
section of `docs/decisions.md` before changing the agent, engine, or tools.

## Common commands

- `bun run setup`: install dependencies, link the CLI, configure keys, and optionally start Compose.
- `bun run api`: run the research API.
- `bun run cli -- --help`: show CLI usage.
- `bun run typecheck`: check TypeScript.
- `bun run knip`: check unused files, exports, and dependencies.
- `bun run test:e2e`: run the live end-to-end test. Requires `OPENROUTER_API_KEY`.

Full installation, usage, and troubleshooting procedures live in `docs/usage-guide.md`.

## Repository boundaries

- `src/api/` owns the HTTP runtime, agent, engine, evidence, provenance, and schemas.
- `src/api/http.ts` owns the transport contract and must not import runtime or agent code.
- `src/cli/` is an HTTP client. It may depend on `src/api/http.ts`, but never on the engine or agent.
- `packages/open-search/` owns framework-independent search and its provider ladder.
- `packages/open-extract/` owns framework-independent URL retrieval and extraction.
- `packages/open-apify/` owns framework-independent Apify actor execution.
- Agent adapters under `src/api/agent/tools/` translate package results into evidence and traces.

The complete file map and dependency direction live in `docs/architecture.md`.

## Standing rules

- Code is the source of truth. Update its canonical document when behavior or wiring changes.
- Keep source comment-free. Put durable rationale in `docs/decisions.md` or architecture in
  `docs/architecture.md`. Functional schema and tool descriptions are not comments.
- Keep provider mechanics inside their package and agent-specific behavior inside `src/api/`.
- Stay within this repository unless the task explicitly requires an external system.
