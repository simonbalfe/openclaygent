# Architecture

openclaygent turns a natural-language research brief plus an output schema into a
typed, cited JSON answer for each row of a table, by researching the live web.

## Flow at a glance

The action is fixed, the rows vary. An entry point builds the action, the engine runs it
against each row, the agent does the web research, a structuring pass shapes the answer.

```mermaid
flowchart LR
  CLI["CLI<br/>(entry point)"] --> ACT["Action<br/>instructions · template · schema · skip rule"]
  CLI --> ROWS["Row(s)<br/>company · domain · ..."]
  ACT --> ENG
  ROWS --> ENG
  ENG["Engine<br/>run / runTable"] --> AG["Agent<br/>Mastra + OpenRouter"]
  AG <-->|"web_search · fetch_page"| EXA["SearXNG · Exa · Tavily"]
  AG --> STR["Structuring model<br/>text → Zod schema"]
  STR --> RR["RunResult<br/>result · sources · agentLog · tokens · cost"]
  RR --> ENG
```

## One row through `run`

Each row passes the skip gate, gets its template filled, runs the agent loop, and is
shaped into the schema — with one repair retry if the structured answer comes back empty.

```mermaid
flowchart TD
  S(["run(action, row)"]) --> C{"conditionalRun<br/>passes?"}
  C -- no --> SK["return skipped: true<br/>(0 tokens)"]
  C -- yes --> F["fill template from row"]
  F --> G["agent.generate<br/>(search / fetch loop)"]
  G --> ST["structuring model → Zod"]
  ST --> Q{"structured<br/>answer?"}
  Q -- "no, attempt 1" --> N["re-ask with nudge"] --> G
  Q -- "no, attempt 2" --> NULL["result = null"]
  Q -- yes --> OK["result = object"]
  OK --> OUT(["RunResult"])
  NULL --> OUT
  SK --> OUT
```

## Inside the agent loop

The model decides each step: search the web, optionally read a page, then answer. Tools
write every URL and step into the run's `Sink`.

```mermaid
flowchart LR
  R["Reason"] --> D{"next action?"}
  D -- web_search --> WS["SearXNG → Exa → Tavily<br/>(snippets)"] --> O["Observe"]
  D -- fetch_page --> FP["impit + pruning extractor<br/>(full page text)"] --> O
  O --> R
  D -- answer --> A["final text → structuring"]
  WS -.->|"record url + step"| SINK[("Sink")]
  FP -.-> SINK
```

## The unit: an action

An **action** (`src/types.ts`, `Action<S>`) is a reusable research brief. It mirrors
Clay's `use-ai` action from the catalog. Four parts:

| Field | Role |
|---|---|
| `name` | stable id, e.g. `free_trial_check` |
| `instructions` | system prompt: the persona + the task |
| `template` | user prompt with `{{field}}` slots filled from the row |
| `output` | Zod schema the final answer must match (the submit-answer shape) |
| `conditionalRun?` | predicate on the row; return false to skip the row before spending a token |

One action runs against many rows. That is the per-row enrichment shape: the brief is
fixed, the row varies.

## The loop

`run(action, row, opts)` in `src/engine.ts` is the core unit. Flow:

1. **Conditional gate** — if `conditionalRun` returns false, return immediately with
   `skipped: true`, zero tokens. This is Clay's #1 credit saver.
2. **Template fill** — `{{field}}` slots are replaced from the row; missing fields are
   marked `[MISSING:field]` and warned, not failed.
3. **Agent loop** — a fresh Mastra agent (`src/agent.ts`) runs with two tools and the
   tuned research behaviour, looping reason → tool → observe until it answers. The system
   context stacks three layers, fixed-first so prompt caching holds across rows: the
   research doctrine (`BEHAVIOUR` in `src/agent.ts` — search/navigation/evidence/answer
   discipline, our equivalent of Claygent's hidden tuned system prompt), then the action's
   `instructions`, then the templated row task. Doctrine rules lose to action rules on
   conflict.
4. **Structure** — a separate structuring model shapes the final text into the action's
   Zod schema (see `decisions.md` for why it must be separate).
5. **Repair retry** — if the structured answer is null, re-ask once with a nudge. See
   `decisions.md`.
6. **Return the contract** — `RunResult<S>`: `result`, `sources`, `agentLog`, `tokens`,
   `cost`, `durationMs`, `model`.

`runTable(action, rows, opts)` runs the loop across a whole table, returning one
`RunResult` per row.

## The tools

`src/tools/web.ts` builds two tools **per run**, bound to a `Sink` so every URL and step
is recorded without global state:

- `web_search(query)` — a cheapest-first provider ladder: self-hosted SearXNG
  (`SEARXNG_URL`, zero-cost) → Exa (`EXA_API_KEY`, /search with inline contents) →
  Tavily (`TAVILY_API_KEY`). A rung is skipped when its env is unset and the ladder
  escalates when a rung throws or returns zero results; the winning rung is recorded as
  `via` on the step. Returns title/url/snippet. Snippets are usually enough to answer.
- `fetch_page(urls)` — impit (browser-TLS HTTP) + the pruning extractor
  (`src/tools/extract.ts`, see decisions.md) renders the page as markdown for free; when
  the result looks like a JS shell or block page it escalates to the **patchright** compose
  service (`PATCHRIGHT_URL`, real rendered Chrome — see decisions.md), recorded as
  `via: patchright` in the step. When every self-hosted rung fails, two paid content rungs
  run last — **Exa `/contents`** (`via: exa`) then **Tavily `/extract`** (`via: tavily`),
  both via their official SDKs. Capped at a bounded read window. Only used when snippets are
  insufficient.

Cheapest-first: the agent is told to prefer search snippets and only fetch when it needs a
specific page's full text. Full verbatim examples of what `fetch_page` returns live in
`docs/examples/` (an index page and a long case-study page, captured live).

## The contract

Every run returns `RunResult<S>` (`src/types.ts`):

- `result` — the schema-shaped answer, or null (null when skipped, or when both attempts
  failed to produce structured output).
- `sources` — every URL the tools touched.
- `agentLog` — ordered `AgentStep[]`, the replay log of search/fetch/answer steps. Each
  step carries `results: StepResult[]` — what the tool actually returned (title, URL,
  preview snippet, fetched char count) — and `cost` (USD for that paid tool step) — so a
  run is auditable after the fact.
- `cost` — `RunCost`: exact spend for the run, `{ total, llm, tools, byProvider, tavilyCredits }`,
  all real provider figures (never estimated). Mechanism in `decisions.md` (Cost accounting).
- `tokens`, `durationMs`, `model` — usage and provenance.

## File map

| File | Role |
|---|---|
| `src/types.ts` | `Action` primitive, `RunResult` contract, `defineAction` helper |
| `src/tools/web.ts` | `web_search` (SearXNG→Exa→Tavily ladder) + `fetch_page` (impit→patchright→Exa /contents→Tavily /extract ladder), the per-run `Sink` |
| `src/tools/extract.ts` | pruning extractor — Crawl4AI-port scoring + Turndown GFM render |
| `src/tools/linkedin.ts` | `linkedin_profile` / `linkedin_posts` / `linkedin_post_reactions` / `linkedin_find_people` / `linkedin_company` (Apify HarvestAPI actors; registered only when `APIFY_API_TOKEN` is set) |
| `src/agent.ts` | per-run cost-tapped OpenRouter provider (`buildOpenRouter`), default model, research behaviour, `buildAgent` |
| `src/cost.ts` | `CostAccumulator` + `emptyCost`, Tavily credit→USD rate, `extractCostUsd` (reads `usage.cost` from JSON or SSE OpenRouter responses) |
| `src/engine.ts` | `run` (one row), `runTable` (a table), template fill, conditional gate, repair retry, `RunCost` assembly |
| `src/cli.ts` | CLI front end: parse args, build the action, load rows, print results |
| `src/schema.ts` | `buildSchema` — turn a CLI JSON Schema / short form into the action's Zod `output` |
| `tests/` | `bun test` suite: schema building, skip path, template fill, extractor, search ladder; live test opt-in via `RUN_LIVE` |

## CLI

`src/cli.ts` is the command-line front end. It builds an `Action` from flags (or an
`--action` file), loads rows (a single `--input` row, or a `--rows` JSON/CSV batch), runs
`runTable`, and prints results.

Single row:

```bash
bun run cli -- \
  --instructions "What industry is this company in? Check their website." \
  --template "Company: {{company}}\nWebsite: {{domain}}" \
  --schema '{"industry":"string","confidence":"low|medium|high"}' \
  --input company=Linear --input domain=linear.app
```

Batch from CSV (header row supplies the `{{slots}}`), skipping rows missing a field:

```bash
bun run cli -- \
  --instructions "What industry is this company in?" \
  --template "Company: {{company}}\nWebsite: {{domain}}" \
  --schema '{"industry":"string","confidence":"low|medium|high"}' \
  --require domain --rows rows.csv
```

`--schema` accepts **standard JSON Schema** (the conventional interchange — converted to
Zod at the boundary via `zod-from-json-schema`) **or** a short form for flat outputs:
`string` | `number` | `boolean` | `a|b|c` (enum) | trailing `?` for nullable. `src/schema.ts`
detects which (a real JSON Schema has `type:"object"`/`properties`) and routes accordingly;
either way the engine receives a Zod schema. `--json` prints raw JSON; `--out <file>` writes
results to disk; `--model <id>` overrides the model per run; `--max-steps <n>` caps the agent
loop iterations (default 5); `--verbose` streams agent steps
live as they happen with result previews — search hits (title, URL, snippet), fetched page
sizes and text previews (wired as `RunOptions.onStep`, fired by the same `record()` that
appends to `agentLog`; goes to stderr under `--json` so stdout stays pipeable).

## Scope

This is the single action loop only — about 80% of Claygent's value. Deliberately not
built: waterfall (ranked-provider fallback), recipe (multi-step chains), model-tiers,
batch-over-Neon. The vault note `projects/claygent_clone/` holds the full architecture
these extend toward.
