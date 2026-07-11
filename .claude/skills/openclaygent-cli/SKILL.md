---
name: openclaygent-cli
description: Run the openclaygent CLI — per-row web research returning typed, cited JSON. Use when the user wants to enrich a company/person/row with live web facts, run a research brief over a CSV/JSON table, or test the openclaygent agent. Covers every flag, the schema short form, output modes, and cost/latency tuning.
---

# openclaygent CLI

One command = one research brief run over one or more rows. The agent searches the live
web (cheapest-first ladders), reads pages when snippets aren't enough, and returns JSON
validated against the schema you asked for, with reasoning and sources.

Invocations (identical behavior):
- `openclaygent <flags>` — global bin, linked by setup; runs from any directory.
- `bun run cli -- <flags>` — from a checkout (note the `--` separator).
- `docker compose run --rm claygent <flags>` — containerized, from a checkout.

Requires `OPENROUTER_API_KEY` in the checkout's `.env` (Bun auto-loads it). Free
search/fetch needs the Docker stack up (`docker compose up -d`); without it, set
`EXA_API_KEY` and it still works (paid search, plain HTTP fetch).

## The brief (required, unless --action)

| Flag | What | Why |
|---|---|---|
| `--instructions <text>` | System prompt: what to research and how to behave | This is the task definition. Be specific; name the page to check when you know it ("Check their pricing page") — it saves loop steps and money |
| `--template <text>` | User prompt with `{{field}}` slots filled from each row | Always include the entity's identifying fields; a template without the entity name forces the agent to guess queries |
| `--schema <json>` | Output shape (see short form below) | The whole value is a validated answer — right type, legal enum, nullable where allowed |
| `--action <file.json>` | Load `{ name, instructions, template, schema }` from a file instead of the three flags | Use for reusable briefs, anything with tricky shell quoting, or version-controlled actions |

### Schema short form

`--schema` accepts standard JSON Schema, or a flat short form — prefer the short form on
the command line:

- `"string"` · `"number"` · `"boolean"` — primitives
- `"a|b|c"` — enum (exact values enforced)
- trailing `?` — nullable, e.g. `"string?"` (use for any field that may legitimately be unfindable — the agent is told null beats a guess)
- `["a","b"]` — enum as an array

Example: `'{"crm":"string?","confidence":"low|medium|high","employees":"number?"}'`

## Rows (pick one)

| Flag | What | When |
|---|---|---|
| `--input k=v` | One row field; repeatable | Single lookups and testing a brief before a batch run |
| `--rows <file>` | Batch: `.json` (array of objects) or `.csv` (header row) | Real enrichment runs; results come back in row order |

Always test a brief on one `--input` row before pointing it at a big `--rows` file — a bad
brief on 500 rows is 500x the cost.

## Run tuning

| Flag | Default | Why change it |
|---|---|---|
| `--model <id>` | `google/gemini-3.1-flash-lite` | Any OpenRouter slug. Drop to `deepseek/deepseek-chat` for high-volume easy lookups (cheapest); go up (e.g. `x-ai/grok-4.3`, `anthropic/claude-haiku-4.5`) for hard rows — funding histories, conflicting firmographics. Tier table: `docs/decisions.md` (Model tiering). Second-pass pattern: run the table on the default, re-run only the null/low-confidence rows on a smarter model |
| `--max-steps <n>` | 5 | Each step is an LLM round-trip plus tools. 3 is enough for single-fact briefs and ~40% faster; keep 5+ for multi-fact briefs. If the budget runs out mid-research the finalizer still forces an answer from what was gathered |
| `--concurrency <n>` | 5 | Rows in parallel for `--rows`. Raise for big tables (speeds the batch, not each row); lower if you're rate-limited |
| `--fast` | off | Fetch never escalates to the slow anti-bot rungs (residential proxy, captcha solver). Caps worst-case page latency at seconds instead of minutes; hard-walled pages come back empty. Use for bulk runs where speed beats completeness |
| `--require <field>` | – | Skip any row missing this field, zero tokens spent. Use on dirty tables (e.g. `--require domain` when the brief needs a domain) — the cheapest row is the one you never research |

## Output modes

| Flag | Stdout | When |
|---|---|---|
| (default) | `{ result, reasoning, sources }` — the schema-shaped answer, a one-line why naming the deciding sources, the URLs read. Array under `--rows` | Piping into scripts/agents; the normal mode |
| `--json` | Full `RunResult` envelope: adds `agentLog` (every step + ladder trail), exact per-provider `cost`, `tokens`, `durationMs`, `model` | Auditing an answer, debugging a brief, cost analysis |
| `--pretty` | Human table with per-row stats and a batch total line | Eyeballing a batch result in the terminal |
| `--verbose` | Adds result previews (titles, URLs, snippets) to the live step trace | Watching what the agent actually saw |
| `--out <file>` | Also writes the full envelopes as JSON to a file | Keep the audit trail while stdout stays minimal |

The live step trace (`› search "…" [searxng] → 5 results`) always streams to **stderr**,
so stdout is clean JSON in every mode. Row errors also go to stderr; the batch never
aborts on one bad row.

Env extras: `OPENCLAY_DEBUG=1` traces internals to stderr (per-rung timings, swallowed
errors, cache hits, Apify status, per-LLM-call cost) — use when a run misbehaves.
`OPENCLAY_MODEL` sets the default model persistently (`.env`).

## Examples

Single lookup, minimal output:
```bash
openclaygent \
  --instructions "Does this company offer a free trial? Check their pricing page." \
  --template "Company: {{company}} ({{domain}})" \
  --schema '{"free_trial":"boolean","evidence_url":"string?"}' \
  --input company=Linear --input domain=linear.app
```

Batch a CSV, keep the audit trail, skip rows without a domain:
```bash
openclaygent \
  --instructions "What CRM does this company use? Prefer their own site and job posts." \
  --template "Company: {{company}} ({{domain}})" \
  --schema '{"crm":"string?","confidence":"low|medium|high"}' \
  --rows leads.csv --require domain --out enriched.json --concurrency 10 --fast
```

Reusable action file + a smarter model for hard rows:
```bash
openclaygent --action actions/funding.json --rows unresolved.json --model x-ai/grok-4.3 --json
```

Pipe just one field:
```bash
openclaygent ... --input company=Vercel | jq -r .result.industry
```

## Cost intuition

- An easy row (snippets answer it) ≈ $0.002 on the default model, a few seconds.
- Cost is input-dominated (tool results pile into context); model $/M-input is the number that moves a table's bill.
- Search/fetch/Apify results are cached (in-process per batch; cross-run when `OPENCLAY_CACHE_URL` is set), so repeated rows and re-runs get cheaper, and identical concurrent calls single-flight.
- LinkedIn/Crunchbase tools (need `APIFY_API_TOKEN`) cost real credits per call; the agent treats them as once-per-target lookups and Crunchbase as a last resort.
