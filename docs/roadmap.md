# Roadmap

Feature checklist. Done = implemented and shipped. Individual entries identify live verification where applicable. The rest is grouped by theme, each with
the gap it closes (vs Clay's Claygent and the Ferret reference).

## Done

- [x] `Action` primitive — instructions + `{{template}}` + Zod `output` + `conditionalRun`
- [x] `run` (one row) and `runTable` (a table)
- [x] Mastra agent on OpenRouter (one key, any model)
- [x] Web tools — provider-agnostic `web_search` and `fetch_page` adapters over the isolated search and extraction packages
- [x] Separate structuring model (so the agent can call tools)
- [x] Finalization fallback on empty structured output — tools-disabled pass over the serialized findings when the agent loop ends without an answer (the reasoning-model step-budget exhaustion failure). See `decisions.md` (Finalization fallback)
- [x] `Sink` → `sources` + `agentLog` provenance
- [x] Conditional-run skip (the credit saver)
- [x] Thin HTTP CLI client — single (`--input`) and batch (`--rows` CSV), `--require`, `--json`, `--out`, `--model`, `--api-url`; the CLI converts rows to the API's JSON contract and all research runs through `POST /run`
- [x] Isolated search workspace — `web_search` delegates query execution to `packages/open-search` through the `open-search` package import; the package owns the SearXNG→Exa→Tavily ladder, standalone CLI, diagnostics, and SearXNG configuration
- [x] Fetch ladder — imported from the isolated `open-extract` workspace package: impit (browser TLS), Readability/pruning, PDF extraction, Patchright direct/proxy/solver escalation, and optional Tavily fallback. Mechanism in `architecture.md` (The tools) + `decisions.md` (Fetch ladder)
- [x] LinkedIn tools — `linkedin_profile` / `linkedin_posts` / `linkedin_post_reactions` / `linkedin_find_people` / `linkedin_company` (exact headcount, size range, industry, HQ, founded year, follower count) via Apify HarvestAPI actors (no-cookie, ~$2–4/1k items; employee search $4/1k, 3x with emails), env-gated on `APIFY_API_TOKEN`
- [x] `open-apify` workspace — framework-independent actor start, polling, timeout, dataset retrieval, and run metadata with injected HTTP/status hooks for isolated tests; Mastra and provenance wiring remains in `src/api/agent/tools/apify.ts`
- [x] `buildSchema` — turn a CLI JSON Schema / short form into the action's Zod `output`
- [x] Docs — architecture (+ Mermaid), decisions

## Reliability

- [x] SearXNG via Evomi residential proxy — `packages/open-search/searxng/entrypoint.sh` injects the proxy configuration into the package-owned settings template. See `decisions.md` (Search ladder).
- [x] Ladder trail observability — every search/fetch step carries a `trail` of each rung attempted with the reason it escalated (`searxng: empty`, `impit: bot-wall/shell (812c)`, `patchright: empty`) and is surfaced in `agentLog`, so an early jump to a paid rung is explainable. See `architecture.md` (the contract) + `decisions.md` (Search/Fetch ladder).
- [ ] Context compaction — truncate old tool results so long runs don't grow tokens quadratically
- [x] Isolated extraction workspace — `fetch_page` delegates URL retrieval and URL-to-Markdown conversion to `packages/open-extract` through the `open-extract` package import; Openclaygent keeps provenance, evidence, and trace recording
- [ ] Page read windows (offset) + section targeting — extend `open-extract` only if the URL-only bounded response proves insufficient on real runs
- [x] Per-row error isolation — a row whose `run` throws (provider error, etc.) returns a failed `RunResult` (`result: null`, `error` set) instead of rejecting the whole `runTable`, so one bad row never discards the rest of a batch. See `decisions.md` (Per-row error isolation)
- [ ] Retry/backoff on provider 429/5xx — currently only the finalization fallback on empty answers, no transient-error retry

## Primitives (the catalog gap)

- [ ] `waterfall` — ranked providers, try in order until one returns (83 sheet rows use this)
- [ ] `recipe` — multi-step chains, output of A feeds B (13 sheet rows, blueprints in the CSV)
- [ ] Depth tiers — name a tier per action (helium/neon/argon) instead of a raw model id; each tier is a `{ model, maxSteps, maxOutputTokens }` preset so cheap rows get a shallow run and hard rows a deep one

## Inputs

- [ ] Metaprompt / auto-tune — rewrite a rough prompt into a hardened one (Clay's Sculptor; sheet `Metaprompt` column)
- [ ] Action library import — parse the Clay catalog CSV, convert prompt-bearing `action` rows into `Action`s
- [ ] Typed inputs — validate `Input Types` (company-domain, work-email, full-name) before a run

## Interfaces

- [x] HTTP `POST /run` endpoint (`src/api/index.ts`, Hono + `@hono/zod-openapi`) — the sole research runtime; single via `input`, batch via `rows`; zod-validated body (auto 400), generated `/openapi.json` + Scalar `/docs`; consumed by the CLI (no auth yet)
- [ ] API auth — bearer/API-key gate on `POST /run` before exposing the endpoint publicly
- [ ] CSV output — write results back as columns appended to the input rows
- [ ] Clay HTTP-column recipe — documented body shape for dropping it into a Clay table

## Fetch & providers

- [x] Browser tier — package-owned patchright compose service (stealth Chrome over plain HTTP, `packages/open-extract/patchright/`), headed inside Xvfb (`seccomp:unconfined` + launch-retry); extraction escalates on JS-shell/block-page detection. Cracks CSR/JS-shell pages; does NOT crack G2 (DataDome) or Crunchbase (interactive CF Turnstile) on its own
- [x] Residential proxy rung — Evomi (`EVOMI_*`) via `&proxy=1`; exit IP verified residential, `via: patchright+proxy` in the log. Helps IP-reputation walls; does NOT beat DataDome (G2) or Turnstile (Crunchbase) on its own
- [x] Turnstile widget solver — `&solve=1` interactive checkbox click (free, ~8s) makes an embedded `cf-turnstile` widget self-issue a real token; the multi-provider token solver (below) is the paid fallback. Verified on the WebUnlocker arena Level 2 live sitekey (752-char token, $0). This is the Crunchbase-class wall. Mechanism in `decisions.md` (Fetch ladder)
- [~] CapSolver interstitial rung — `&solve=1` `AntiCloudflareTask` + sticky Evomi session for full-page CF challenges (`just a moment`), `via: patchright+solver`. CapSolver-only (cookie-return task; 2Captcha has no clean equivalent). Wired; unproven for G2's DataDome (a different wall, not CF Turnstile)
- [x] Multi-provider token solver — `solveToken(vendor, url, sitekey, pref)` in `packages/open-extract/patchright/server.mjs` routes supported challenges through CapSolver or 2Captcha using the shared create-and-poll flow. `/healthz` reports configured solvers and `&solver=capsolver|twocaptcha` selects one. Historical live checks established CapSolver coverage for reCAPTCHA and Turnstile and 2Captcha coverage for reCAPTCHA, Turnstile, and FunCaptcha; hCaptcha success remains unconfirmed. The current gap is injecting non-Turnstile tokens into `render()` and making `usable()` escalate on a present but unsolved widget.
- [x] Generic captcha detector + diagnostics — `detect(html, cookies)` signature-matches the rendered widget (iframe src / widget class / response field), classifying cf-interstitial, turnstile, hcaptcha, recaptcha, datadome, akamai, perimeterx and extracting the sitekey (`data-sitekey` attr → iframe `sitekey`/`k` param). `/detect?url=` returns `{ vendor, sitekey }` + cookies; `/solve?url=&solver=` detects then solves a token vendor and reports provider + token length; `/fetch` adds an `x-captcha` response header. Known gap: hCaptcha widgets that inject late or in a nested frame can read as `null` (frame-timing) — needs a longer wait or a frame-aware check
- [x] Paid fetch fallback — last-resort Tavily `/extract` (always-live) when every self-hosted fetch rung fails `usable()`. Exa `/contents` was removed from the fetch ladder for the live-data priority (rationale in `decisions.md`, Fetch ladder)
- [x] Search provider cascade — SearXNG (free) → Exa → Tavily ladder, escalating on error or zero results. Mechanism in `decisions.md` (Search ladder). Tier-aware rung selection still waits on depth tiers
- [x] Extraction — JSON-LD + `<meta>`/og structured data parsed first into a prepended `## Page structured data` block (`extractStructuredData`: Organization/PostalAddress/FAQPage/Product, `@graph`-flattened, capped), so exact firmographics surface even when the visible page is gated (Pitchbook → 220 employees / 2016 / NY / $395M); the reader tools don't do this (Jina Reader has none; Crawl4AI parses JSON-LD only in its URL-seeder). Then Readability-first (`@mozilla/readability` + `linkedom`, article/blog) → Crawl4AI prune fallback (structured pages) → Turndown; leftover non-data tables flattened so no raw `<table>` leaks; PDFs parsed via `unpdf`. Mechanism in `decisions.md` (Fetch ladder, JSON-LD structured data)
- [x] No fabricated URLs — every URL `fetch_page` / `linkedin_*` / `crunchbase_company` opens must have provenance: a `web_search` result, this row's own input, or a link on a page already fetched (`sink.seen` + `assertVerifiedUrl`). A guessed `/company/<slug>` (which resolved to a stale decoy page reported as fact) is refused; for LinkedIn/Crunchbase the agent passes the entity NAME and the actor resolves the canonical page. Mechanism in `decisions.md` (No fabricated URLs)
- [ ] Wire the solver to fire on gated-but-loaded pages — today `fetch_page` only escalates to `&solve=1` when an earlier rung fails `usable()`; a page whose shell loads but hides data behind an unsolved `cf-turnstile` widget never reaches the (working) Turnstile rung. Make `usable()` also fail on a present-but-unsolved widget so the solver triggers in real runs
- [ ] ReaderLM-v2 research — evaluate Jina's open-source 1.5B HTML→markdown/JSON model (`jinaai/ReaderLM-v2`, HuggingFace) as an extraction upgrade for messy HTML and HTML→structured-JSON. Open questions: GPU cost + per-page latency vs the free heuristic, and the model's non-commercial license (CC-BY-NC — verify). Likely overkill for normal pages; benchmark it only on pages the heuristic mangles
- [~] Enrichment tools — specialist scrapers for bot-walled GTM sources, env-gated on `APIFY_API_TOKEN`, fallback-only (used when search/fetch can't get the fact). Shipped: `linkedin_*` (HarvestAPI), `crunchbase_company` (`CRUNCHBASE_ACTOR`, default `parseforge~crunchbase-scraper`) for funding/firmographics. Next: jobs/hiring signals (JobSpy OSS or an Apify jobs actor), G2/tech-stack

## Scale & ops

- [x] Concurrency in `runTable` — run N rows in parallel with a cap (`opts.concurrency`, default 5; CLI `--concurrency <n>`)
- [ ] Batch over Neon — read rows from / write results to a `leads-hub` schema
- [ ] Deploy — host the HTTP endpoint so callers hit a URL, not a local script

See `architecture.md` for what exists today and the scope these items extend.
