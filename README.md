# openclaygent

A little web-research agent you hand a question and a table — it reads the live web for every
row and hands back clean, **cited JSON**.

It's the open-source take on Clay's Claygent, shipped as a **CLI and an HTTP API** so any
agent, script, or workflow can call it. Ask it the niche facts no data vendor sells — "does
this company offer a free trial?", "what CRM do they use?", "how many open engineering roles?"
— and get a typed answer with the sources to back it, one per row.

## The idea

Write the brief once: a plain-English question, the inputs it needs, and the shape of the
answer you want back.

```jsonc
{
  "instructions": "What industry is this company in? Check their website first.",
  "template":     "Company: {{company}}\nWebsite: {{domain}}",
  "schema":       { "industry": "string", "confidence": "low|medium|high" }
}
```

Point it at a row — `{ "company": "Linear", "domain": "linear.app" }` — and it searches, reads
the page if it needs to, and returns typed, cited JSON. Run the **same brief** over a 500-row
CSV and you get one result per row: the brief is fixed, the rows vary.

## How it works

The agent loops — reason, pick a tool, observe — until it can answer. Its two tools are
**waterfalls**: each rung runs only when the one above it fails or returns empty, so you spend
on a paid rung only after the free ones miss. An unset key is just a skipped rung.

```mermaid
flowchart TB
  A(["Agent loop · reason → act → observe"]) --> OUT(["Typed, cited JSON · sources · cost"])
  A -. web_search .-> S1
  A -. fetch_page .-> F1

  subgraph SEARCH ["Search — find URLs / facts"]
    direction TB
    S1["SearXNG · free"] -->|empty| S2["Exa · credit"] -->|empty| S3["Tavily · credit"]
  end

  subgraph FETCH ["Fetch — read a page (always live)"]
    direction TB
    F1["impit · free"] -->|blocked| F2["patchright · free"] -->|blocked| F3["+ residential proxy · paid (Evomi)"] -->|blocked| F4["+ Turnstile solver · free click, paid fallback (CapSolver)"] -->|fail| F5["Tavily /extract · credit"]
  end

  classDef io fill:#dbeafe,stroke:#60a5fa,color:#1e3a8a;
  classDef free fill:#dcfce7,stroke:#22c55e,color:#14532d;
  classDef paid fill:#fef3c7,stroke:#f59e0b,color:#92400e;
  class A,OUT io
  class S1,F1,F2 free
  class S2,S3,F3,F4,F5 paid
```

Green = free rung, amber = paid. The Turnstile **click** is free (a real browser ticks the
checkbox and the widget issues its own token); only the CapSolver fallback and the Evomi
proxy cost money — and those aren't metered in `RunResult.cost`, which tracks only the
LLM, Exa, Apify, and Tavily.

## Setup

Cost is the whole point — so the core setup is the **free, self-hosted search + fetch stack**.
You bring one key (the model); SearXNG and patchright do the web work for free. Paid providers
are extensions you only reach when the free rungs miss.

```bash
bun install
cp .env.example .env          # add OPENROUTER_API_KEY
docker compose up -d          # SearXNG (free search) + patchright (free fetch) — the cost core
```

**Required** — one key, the model brain:

| Variable | What it's for | Get one |
|---|---|---|
| `OPENROUTER_API_KEY` | Drives any model (DeepSeek default — cheap; Claude/GPT/Llama per run) | [openrouter.ai/keys](https://openrouter.ai/keys) |

**The free stack** — essential to the cost story, started by `docker compose up`:

| Variable | What it does |
|---|---|
| `SEARXNG_URL` | Free self-hosted search — the first (and usually only) search rung |
| `PATCHRIGHT_URL` | Free headless-browser fetch for JS-heavy / bot-walled pages |

**Paid extensions** — optional; each only fires when the free rung above it misses:

| Variable | Default | What it adds |
|---|---|---|
| `EXA_API_KEY` | – | Paid search fallback after SearXNG (also lets you skip Docker — see below) |
| `TAVILY_API_KEY` | – | Last-resort search rung + the live `fetch_page` fallback |
| `APIFY_API_TOKEN` | – | Enables the `linkedin_*` tools (profiles, posts, company data) |
| `EVOMI_*` · `CAPSOLVER_API_KEY` | – | Residential proxy + captcha solver for the toughest anti-bot pages |
| `OPENCLAY_MODEL` | `deepseek/deepseek-chat` | Default model id (override per run with `--model`) |
| `TAVILY_USD_PER_CREDIT` | `0.008` | Tunes the cost report to your Tavily plan |
| `PORT` | `8080` | Port for the HTTP API (`bun run api`) |

> **No-Docker quick try:** set `EXA_API_KEY` and skip `docker compose` — Exa does search and the
> built-in `impit` rung does fetch, zero infra. Fast to start, but you pay Exa per search; add
> the free stack to make runs (nearly) free.

The ladders try the cheapest configured rung first and fall through only on miss/fail — an
unset key is a skipped rung, never an error.

## Use it: CLI

The CLI is the quickest way in. With `--json` it prints a clean result to stdout (warnings go
to stderr), so it pipes straight into whatever you're building — a shell script, a cron job,
or an agent that shells out for a typed, cited answer instead of researching inline.

```bash
bun run cli -- --json \
  --instructions "Does this company offer a free trial? Check their pricing page." \
  --template "Company: {{company}}" \
  --schema '{"free_trial":"boolean","evidence_url":"string?"}' \
  --input company=Linear
# → { "result": { "free_trial": true, "evidence_url": "https://linear.app/pricing" },
#     "sources": [...], "cost": {...}, "model": "deepseek/deepseek-chat" }
```

Batch a list with `--rows leads.csv --out enriched.json`, and skip rows that don't qualify
with `--require domain` before a token is spent. Full flags: `bun run cli -- --help`.

## Use it: HTTP API

The same engine over the wire, so any service or workflow can call it. `bun run api` serves
`POST /run`, with interactive docs at `/docs`.

```bash
bun run api    # :8080
curl -s localhost:8080/run -H 'content-type: application/json' -d '{
  "instructions": "Identify which CRM the company uses.",
  "template": "Company: {{company}} ({{domain}})",
  "schema": {"crm":"string?","confidence":"low|medium|high"},
  "rows": [{"company":"Linear","domain":"linear.app"}]
}'
```

See `docs/architecture.md` (HTTP API) for the full request/response shape.

## Docs

- `docs/walkthrough.md` — a plain-language tour of the whole flow and *why* each step works the way it does. Start here.
- `docs/architecture.md` — how it works: the action, the loop, the contract, the file map.
- `docs/decisions.md` — the non-obvious choices and the conventions that bite.
- `docs/roadmap.md` — what's shipped and what's next.
