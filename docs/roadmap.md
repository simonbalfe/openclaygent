# Roadmap

Feature checklist. Done = shipped and live-tested. The rest is grouped by theme, each with
the gap it closes (vs Clay's Claygent and the Ferret reference).

## Done

- [x] `Action` primitive — instructions + `{{template}}` + Zod `output` + `conditionalRun`
- [x] `run` (one row) and `runTable` (a table)
- [x] Mastra agent on OpenRouter (one key, any model)
- [x] Exa tools — `web_search` (inline contents) + `fetch_page`
- [x] Separate structuring model (so the agent can call tools)
- [x] One repair retry on empty structured output
- [x] `Sink` → `sources` + `agentLog` provenance
- [x] Conditional-run skip (the credit saver)
- [x] CLI — single (`--input`) and batch (`--rows` JSON/CSV), `--require`, `--json`, `--out`, `--model`
- [x] SearXNG search backend — `SEARXNG_URL` env switches `web_search` to a local SearXNG instance (zero-cost search); unset = Exa
- [x] Fetch ladder — impit (browser TLS) + Crawl4AI-style pruning extraction (`src/tools/extract.ts`), escalating through patchright (direct → +proxy → +solver) to paid Exa `/contents` + Tavily `/extract`. Mechanism in `architecture.md` (The tools) + `decisions.md` (Fetch ladder)
- [x] LinkedIn tools — `linkedin_profile` / `linkedin_posts` / `linkedin_post_reactions` / `linkedin_find_people` / `linkedin_company` (exact headcount, size range, industry, HQ, founded year, follower count) via Apify HarvestAPI actors (no-cookie, ~$2–4/1k items; employee search $4/1k, 3x with emails), env-gated on `APIFY_API_TOKEN`
- [x] `buildSchema` — turn a CLI JSON Schema / short form into the action's Zod `output`
- [x] Docs — architecture (+ Mermaid), decisions

## Reliability & cost (the Ferret hardening gap)

- [x] Per-run + per-step cost — exact USD per provider in `RunResult.cost` (`{ total, llm, tools, byProvider, tavilyCredits }`) and per paid tool step in `agentLog[].cost`. All figures are real, not estimated: OpenRouter via a fetch-tap on the per-run provider (captures every LLM call including the separate structuring call), Exa via `costDollars.total`, Apify via the run's `usageTotalUsd` (async start→poll→read), Tavily via `includeUsage` credits × `TAVILY_USD_PER_CREDIT`. Self-hosted rungs (SearXNG, impit, patchright) are $0. CLI prints it per row and as a table total. See `decisions.md` (Cost accounting).
- [ ] Per-request caching — re-search / re-fetch of the same query/URL is free
- [ ] Context compaction — truncate old tool results so long runs don't grow tokens quadratically
- [ ] Page read windows (offset) — read large pages in chunks instead of one capped slice
- [ ] Retry/backoff on provider 429/5xx — currently a single repair retry only

## Primitives (the catalog gap)

- [ ] `waterfall` — ranked providers, try in order until one returns (83 sheet rows use this)
- [ ] `recipe` — multi-step chains, output of A feeds B (13 sheet rows, blueprints in the CSV)
- [ ] Depth tiers — name a tier per action (helium/neon/argon) instead of a raw model id; each tier is a `{ model, maxSteps, maxOutputTokens }` preset so cheap rows get a shallow run and hard rows a deep one

## Inputs

- [ ] Metaprompt / auto-tune — rewrite a rough prompt into a hardened one (Clay's Sculptor; sheet `Metaprompt` column)
- [ ] Action library import — parse the Clay catalog CSV, convert prompt-bearing `action` rows into `Action`s
- [ ] Typed inputs — validate `Input Types` (company-domain, work-email, full-name) before a run

## Interfaces

- [x] HTTP `POST /run` endpoint (`src/api.ts`, Hono + `@hono/zod-openapi`) — single via `input`, batch via `rows`; zod-validated body (auto 400), generated `/openapi.json` + Scalar `/docs`. Shares `core/action.ts` + `runTable` with the CLI (no auth yet)
- [ ] API auth — bearer/API-key gate on `POST /run` before exposing the endpoint publicly
- [ ] CSV output — write results back as columns appended to the input rows
- [ ] Clay HTTP-column recipe — documented body shape for dropping it into a Clay table

## Fetch & providers

- [x] Browser tier — patchright compose service (stealth Chrome over plain HTTP, `patchright/`), headed inside Xvfb (`seccomp:unconfined` + launch-retry); `fetch_page` escalates on JS-shell/block-page detection. Cracks CSR/JS-shell pages; does NOT crack G2 (DataDome) or Crunchbase (interactive CF Turnstile) on its own
- [x] Residential proxy rung — Evomi (`EVOMI_*`) via `&proxy=1`; exit IP verified residential, `via: patchright+proxy` in the log. Helps IP-reputation walls; does NOT beat DataDome (G2) or Turnstile (Crunchbase) on its own
- [x] Turnstile widget solver — `&solve=1` interactive checkbox click (free, ~8s) makes an embedded `cf-turnstile` widget self-issue a real token; CapSolver `AntiTurnstileTaskProxyless` is the paid fallback. Verified on the WebUnlocker arena Level 2 live sitekey (752-char token, $0). This is the Crunchbase-class wall. Mechanism in `decisions.md` (Fetch ladder)
- [~] CapSolver interstitial rung — `&solve=1` `AntiCloudflareTask` + sticky Evomi session for full-page CF challenges (`just a moment`), `via: patchright+solver`. Wired; unproven for G2's DataDome (a different wall, not CF Turnstile)
- [x] Paid content fallback — last-resort Exa `/contents` then Tavily `/extract` when every self-hosted fetch rung fails `usable()`; cracks walled aggregators from Exa's cache. Mechanism in `decisions.md` (Fetch ladder)
- [x] Search provider cascade — SearXNG (free) → Exa → Tavily ladder, escalating on error or zero results. Mechanism in `decisions.md` (Search ladder). Tier-aware rung selection still waits on depth tiers
- [ ] Wire the solver to fire on gated-but-loaded pages — today `fetch_page` only escalates to `&solve=1` when an earlier rung fails `usable()`; a page whose shell loads but hides data behind an unsolved `cf-turnstile` widget never reaches the (working) Turnstile rung. Make `usable()` also fail on a present-but-unsolved widget so the solver triggers in real runs
- [ ] Enrichment tool — `enrich(provider, input)` for structured GTM data (LinkedIn, tech-stack, jobs) as a waterfall step

## Scale & ops

- [x] Concurrency in `runTable` — run N rows in parallel with a cap (`opts.concurrency`, default 5; CLI `--concurrency <n>`)
- [ ] Batch over Neon — read rows from / write results to a `leads-hub` schema
- [ ] Deploy — host the HTTP endpoint so callers hit a URL, not a local script

See `architecture.md` for what exists today and the vault `projects/claygent_clone/` for the
full target these extend toward.
