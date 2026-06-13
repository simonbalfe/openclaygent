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

## A run, end to end

Say you have a list of companies and want each one's industry, confirmed against the
company's own site (not a stale directory). You write the brief **once**:

```jsonc
// the action: a reusable research brief
{
  "instructions": "What industry is this company in? Check their website first.",
  "template":     "Company: {{company}}\nWebsite: {{domain}}",
  "schema":       { "industry": "string", "confidence": "low|medium|high" }
}
```

and point it at a row:

```jsonc
{ "company": "Linear", "domain": "linear.app" }
```

The agent fills the template (`Company: Linear / Website: linear.app`), then loops
reason → tool → observe, recording every step. A typical run:

1. **search** — `web_search("Linear linear.app product industry")`; the SearXNG rung
   answers, snippets come back. Snippets are often enough, but here it wants the primary
   source.
2. **fetch** — `fetch_page("https://linear.app")`; impit pulls the page, the pruning
   extractor strips nav/footer and hands back ~5k chars of real content as markdown.
3. **answer** — it has enough, so it stops and emits the final text, which the structuring
   model shapes into your schema.

What you get back is the **typed, cited** `RunResult` (values illustrative):

```jsonc
{
  "result":   { "industry": "Project management & software development tools",
                "confidence": "high" },
  "sources":  ["https://linear.app", "https://linear.app/about"],
  "agentLog": [ /* the search → fetch → answer steps above, each with result previews */ ],
  "tokens":   { "input": 3140, "output": 88 },
  "durationMs": 7421,
  "model":    "deepseek/deepseek-chat"
}
```

On the CLI that prints as:

```
Linear  7.4s · 3140 in / 88 out tok · 2 sources
  search    "Linear linear.app product industry" [searxng] → 5 results
  fetch     https://linear.app [impit] → 4812 chars
  answer
  industry    Project management & software development tools
  confidence  high

1 rows · 3140 in / 88 out tok · deepseek/deepseek-chat
```

Run the **same action** over a 500-row CSV and you get one of these per row — the brief is
fixed, the row varies. Rows that fail `--require` are skipped before a token is spent.

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

## From Claude Code (the core use)

The point of openclaygent is to be the **per-row web-research primitive an agent reaches
for** — not a chat you babysit. With `--json` the CLI prints a clean `RunResult` to stdout
and nothing else, so Claude Code (or any coding agent) drives it as a plain Bash tool:
hand it a brief + a row, read back typed, cited JSON, act on it.

Why shell out instead of doing the research inline:

- **Context stays clean** — 500 rows of search/fetch noise never touch the agent's
  conversation. Each call is isolated; only the compact JSON result comes back.
- **Cited and typed** — the agent gets `result` + `sources` it can trust and quote, not a
  prose answer it has to re-parse.
- **Cheap model on the grunt work** — the research loop runs on DeepSeek (or whatever you
  set) while your agent stays on its own model. Bring-your-own keys, no Clay credit margin.

A single lookup the agent can run and parse:

```bash
bun run cli -- --json \
  --instructions "Does this company offer a free trial? Check their pricing page." \
  --template "Company: {{company}}\nWebsite: {{domain}}" \
  --schema '{"free_trial":"boolean","evidence_url":"string?","confidence":"low|medium|high"}' \
  --input company=Linear --input domain=linear.app
# → { "result": { "free_trial": true, "evidence_url": "https://linear.app/pricing", ... },
#     "sources": [...], "tokens": {...}, "model": "deepseek/deepseek-chat" }
```

Batch the same way — `--rows leads.csv --out enriched.json` — and the agent hands you one
`RunResult` per row to merge back into the table. (`--json` puts warnings on stderr, so
stdout stays a clean pipe.) A first-class wrapper — an MCP server / `POST /run` endpoint so
it's a registered tool rather than a shell-out — is the natural next step; see
`docs/roadmap.md` (Interfaces).

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
