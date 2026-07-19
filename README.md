# openclaygent

A web-research agent: hand it a question and a table, it reads the live web for every row
and returns typed, **cited JSON**. The open-source take on Clay's Claygent, with one Dockerized
API runtime and a thin CLI client.

## The idea

Write the brief once — a plain-English question, the inputs, and the shape of the answer:

```jsonc
{
  "instructions": "What industry is this company in? Check their website first.",
  "template":     "Company: {{company}}\nWebsite: {{domain}}",
  "schema":       { "industry": "string", "confidence": "low|medium|high" }
}
```

Point it at a row — `{ "company": "Linear", "domain": "linear.app" }` — and it searches,
reads pages when it needs to, and returns typed, cited JSON. Run the same brief over a
500-row CSV and you get one result per row.

## How it works

The agent loops — reason, pick a tool, observe — until it can answer. Its two web tools are
cheapest-first ladders: a rung runs only when the one above it fails or returns empty, and
an unset key is a skipped rung, never an error. You pay only when the free rungs miss.

```mermaid
flowchart TB
  A(["Agent loop · reason → act → observe"]) --> OUT(["Typed, cited JSON · sources · trace"])
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

Green = local, amber = external. The trace records which provider handled each step.

## Setup

One line from nothing:

```bash
curl -fsSL https://raw.githubusercontent.com/simonbalfe/openclaygent/main/scripts/install.sh | bash
```

It clones the repo, installs Bun for the thin CLI, creates `.env`, prompts for keys (only
OpenRouter is required), pulls the three published images from GHCR, and waits until the API,
search, and browser services are healthy. When it finishes: API at
`http://localhost:8080/docs`, CLI available globally as `openclaygent`.

- Already cloned? `bun run setup`
- Manual instead: `cp .env.example .env`, edit `.env`, then `docker compose up -d --wait`
- No Docker? Run the API with `bun run api`; the CLI still calls it over HTTP. Set `EXA_API_KEY`
  when running without the self-hosted SearXNG service.

**Required:**

| Variable | What it's for | Get one |
|---|---|---|
| `OPENROUTER_API_KEY` | The model (Gemini Flash Lite default; any OpenRouter model per run) | [openrouter.ai/keys](https://openrouter.ai/keys) |

**Optional** — each key just enables its rung or tool:

| Variable | What it adds |
|---|---|
| `EXA_API_KEY` | Paid search fallback (and the no-Docker path) |
| `TAVILY_API_KEY` | Last-resort search rung + live `fetch_page` fallback |
| `APIFY_API_TOKEN` | `linkedin_*` and `crunchbase_company` enrichment tools |
| `EVOMI_*` · `CAPSOLVER_API_KEY` | Residential proxy + captcha solver for the hardest pages |
| `OPENCLAY_MODEL` | Default model id (per-run override: `--model`) |
| `OPENCLAY_DEBUG` | `1` = detailed stderr trace (rung timings, errors, and LLM calls) |

The full list, including per-actor overrides, is in `.env.example`.

## Use it: CLI

```bash
openclaygent \
  --instructions "Does this company offer a free trial? Check their pricing page." \
  --template "Company: {{company}}" \
  --schema '{"free_trial":"boolean","evidence_url":"string?"}' \
  --input company=Linear
# → { "result": { "free_trial": true, "evidence_url": "https://linear.app/pricing" },
#     "reasoning": "linear.app/pricing shows a free plan, no trial period.",
#     "sources": ["https://linear.app/pricing", ...] }
```

By default stdout is just the answer — the schema-shaped `result` plus a one-line
`reasoning` and the `sources` behind it, so it pipes straight into scripts and agents.
`--json` adds the full envelope with agent log and
tokens; `--pretty` is a human table. Batch with
`--rows leads.csv --out enriched.json`; skip unqualified rows with `--require domain`; add
Full flags: `openclaygent --help`.

The CLI always calls the API at `http://localhost:8080`. Override it with `--api-url` or
`OPENCLAYGENT_API_URL` for a remote service.

## Use it: HTTP API

```bash
docker compose up -d --wait
curl -s localhost:8080/run -H 'content-type: application/json' -d '{
  "instructions": "Identify which CRM the company uses.",
  "template": "Company: {{company}} ({{domain}})",
  "schema": {"crm":"string?","confidence":"low|medium|high"},
  "rows": [{"company":"Linear","domain":"linear.app"}]
}'
```

Full request/response shape: `docs/architecture.md` (HTTP API).

## Uninstall

```bash
~/openclaygent/scripts/uninstall.sh    # or: curl -fsSL <raw>/scripts/uninstall.sh | bash
```

Removes containers, images, the global link, and the install directory; leaves your
`~/.zshrc` keys alone. Confirms first (`-y` to skip).

## Docs

- `docs/usage-guide.md` — copy-paste examples for single rows, CSV batches, reusable actions, schemas, API calls, and troubleshooting.
- `docs/architecture.md` — the mechanism: action, loop, contract, file map. Start here.
- `docs/decisions.md` — the non-obvious choices and the conventions that bite.
- `docs/roadmap.md` — what's shipped and what's next.
