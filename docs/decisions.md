# Decisions

The non-obvious choices, and the conventions that bite. Each one cost a debugging cycle —
they are recorded here so the next change does not pay it again.

## Mastra v1 tool signature: `(inputData)`, not `({ context })`

In Mastra v1, a tool's `execute` receives the validated input as its **first argument**:

```ts
execute: async (inputData) => { /* inputData.query */ }
```

The Mastra v0 shape `execute: async ({ context }) => { context.query }` silently fails in
v1: `context` is `undefined`, so every call throws before doing anything. Symptom seen:
the agent calls `web_search` repeatedly, hits the step cap, and never answers, while the
tool's side effects (recorded sources/steps) never happen.

## Structured output needs a separate model

`structuredOutput` must be passed `{ schema, model }` with its **own** model:

```ts
structuredOutput: { schema: action.output, model: openrouter.chat(model) }
```

Passing only `{ schema }` forces a single structured generation pass that **disables
tool-calling**. The agent then answers from parametric memory and never searches. The
separate structuring model lets the main agent loop with tools in text mode first, then a
second pass shapes the final text into the schema.

## Output token cap lives in `modelSettings`

The per-call cap is `modelSettings: { maxOutputTokens }`, not a top-level `generate`
option (which does not exist in Mastra v1 and fails typecheck). The cap matters because
OpenRouter reserves the model's full `max_tokens` against the account balance up front; a
near-empty balance returns `402` ("can only afford N tokens") unless the cap is lowered.

## Default model: `deepseek/deepseek-chat`

`openai/gpt-4o-mini` via OpenRouter intermittently returns `431` ("request headers are too
large") on tool-calling loops once the accumulated context grows. DeepSeek is the default
instead: cheap, open-weight, reliable here, and the right fit for the open-source thesis
(skip Clay's credit margin on bring-your-own keys). Override per run with `opts.model` or
the `OPENCLAY_MODEL` env var. The model id must be a valid OpenRouter slug; an invalid one
returns `404 No endpoints found`.

## One repair retry

`run` retries once when the structured answer comes back null. Models intermittently end a
turn on empty or non-JSON output, leaving the structurer nothing to shape. The retry
re-asks with a nudge to return the JSON using what was already found. In testing this
turned an intermittent 2/3 success rate into a consistent 3/3. The vault calls this "the
line between usually works and reliable across thousands of rows."

## Per-run tools and the Sink

Tools are built fresh inside each `run` and closed over a `Sink` (`{ sources, log }`)
rather than reading/writing module-level state. This keeps concurrent runs isolated and
lets `RunResult` report exactly the URLs and steps that this run produced.

## Search backend: Exa

`web_search` and `fetch_page` (`src/tools/web.ts`) call Exa's REST API (`api.exa.ai`,
auth via the `x-api-key` header). Chosen over Tavily because Exa's `/search` returns page
text **inline** via `contents` — for indexable public pages the search step often already
carries the answer, so the agent never needs a separate `fetch_page`/`/contents` round.
That is the cheapest, lowest-latency retrieval path. Search requests cap inline text
(`contents.text.maxCharacters`) to keep tool output bounded; `fetch_page` pulls full text
via `/contents` only when a snippet is insufficient. The two tools are the swap seam — the
agent and engine are unaware of the provider.

## No `.claude/` rules or hooks

Deliberate. At this size — a handful of source files, a lean CLAUDE.md, this `docs/`
folder, and no live/deployed claims — there is no drift pressure for an enforcement layer
to guard against. Revisit when the scope extensions land and the surface grows.
