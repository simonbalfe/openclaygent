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

This is the single `use-ai` **action** loop — ~80% of Claygent's value. For what's
deliberately out of scope and the extensions it grows toward, see `docs/architecture.md` (Scope).

## Setup

```bash
bun install
cp .env.example .env   # add OPENROUTER_API_KEY and EXA_API_KEY
bun test               # run the test suite (live test skipped unless RUN_LIVE=1)
```

## CLI

```bash
bun run cli -- \
  --instructions "What industry is this company in? Check their website." \
  --template "Company: {{company}}\nWebsite: {{domain}}" \
  --schema '{"industry":"string","confidence":"low|medium|high"}' \
  --input company=Linear --input domain=linear.app
```

Batch a CSV/JSON of rows with `--rows file.csv`, skip rows missing a field with
`--require domain`, get raw JSON with `--json`. Full flag reference: `bun run cli -- --help`
and `docs/architecture.md` (CLI).

## Define your own action

Save a reusable action as JSON and run it over any row file:

```json
{
  "name": "uses_crm",
  "instructions": "Identify which CRM the company uses, from their site or public posts.",
  "template": "Company: {{company}}\nWebsite: {{domain}}",
  "schema": {
    "crm": "string?",
    "evidence_url": "string?",
    "confidence": "low|medium|high"
  }
}
```

```bash
bun run cli -- --action uses_crm.json --rows companies.csv --require domain --out results.json
```

## Tests

```bash
bun test               # deterministic tests: schema building, skip path, template fill, extractor, search ladder
RUN_LIVE=1 bun test    # also runs the live end-to-end test (needs API keys + credits)
```

## Layout

The canonical file map lives in `docs/architecture.md` (File map). In brief: `src/` is the
engine, agent, tools, and CLI; `tests/` is the `bun test` suite; `docs/` is architecture,
decisions, and roadmap.

## Docs

- `docs/architecture.md` — the action primitive, the loop, the contract, scope.
- `docs/decisions.md` — non-obvious choices and the conventions that bite.
- `docs/roadmap.md` — feature checklist: shipped vs still to add.
