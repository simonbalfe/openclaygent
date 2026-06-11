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
- [x] `jsonToZod` — build the output schema from a CLI JSON shape
- [x] Docs — architecture (+ Mermaid), decisions

## Reliability & cost (the Ferret hardening gap)

- [ ] Per-step cost / tier in `agentLog` — match Claygent's activity trace and Ferret's `agent_log`
- [ ] Per-request caching — re-search / re-fetch of the same query/URL is free
- [ ] Context compaction — truncate old tool results so long runs don't grow tokens quadratically
- [ ] Page read windows (offset) — read large pages in chunks instead of one capped slice
- [ ] Retry/backoff on provider 429/5xx — currently a single repair retry only

## Primitives (the catalog gap)

- [ ] `waterfall` — ranked providers, try in order until one returns (83 sheet rows use this)
- [ ] `recipe` — multi-step chains, output of A feeds B (13 sheet rows, blueprints in the CSV)
- [ ] Model tiers — name a tier per action (helium/neon/argon) instead of a raw model id

## Inputs

- [ ] Metaprompt / auto-tune — rewrite a rough prompt into a hardened one (Clay's Sculptor; sheet `Metaprompt` column)
- [ ] Action library import — parse the Clay catalog CSV, convert `use-ai` rows into `Action`s
- [ ] Typed inputs — validate `Input Types` (company-domain, work-email, full-name) before a run

## Interfaces

- [ ] HTTP `POST /run` endpoint (`Bun.serve`) — single via `inputs`, batch via `rows`
- [ ] CSV output — write results back as columns appended to the input rows
- [ ] Clay HTTP-column recipe — documented body shape for dropping it into a Clay table

## Fetch & providers

- [ ] Multi-tier fetch cascade for hard sites — native → browser → paid proxy (Ferret has 5 tiers; Exa alone won't crack JS/anti-bot/login pages)
- [ ] Search provider seam — swap Exa for SearXNG (zero-cost) / Serper / Brave
- [ ] Enrichment tool — `enrich(provider, input)` for structured GTM data (LinkedIn, tech-stack, jobs) as a waterfall step

## Scale & ops

- [ ] Concurrency in `runTable` — run N rows in parallel with a cap (today it is sequential)
- [ ] Batch over Neon — read rows from / write results to a `leads-hub` schema
- [ ] Deploy — host the HTTP endpoint so callers hit a URL, not a local script

See `architecture.md` for what exists today and the vault `projects/claygent_clone/` for the
full target these extend toward.
