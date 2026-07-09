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
structuredOutput: { schema: action.output, model: provider.chat(model) }
```

The structuring model comes from the **same per-run OpenRouter provider** as the agent
(`buildAgent` returns `{ agent, provider }`), so the cost-tap (see Cost accounting) meters
the structuring call too.

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

## Model tiering: cost vs. intelligence

One model drives both the agent loop and the structuring pass, so its price applies to
every row. **Cost is input-dominated**: a research run accumulates tens of thousands of
input tokens across its tool calls but emits only a few thousand output tokens, so the
input price ($/M in) is the number that moves a table's bill, not the output price.

The real tradeoff is **reliability, not just price**. Cheap chat models answer in fewer
steps but guess more (deepseek confidently returned a wrong company on a hard row).
Reasoning models (gemini-3.x, gpt-5.x, grok — reasoning is always on) are more rigorous but
do more tool calls, cost more, and are the ones that hit the empty-answer failure the
finalization fallback exists to catch.

Pick by row difficulty and table size. Prices are OpenRouter pay-as-you-go USD per 1M
tokens as of 2026-06; all listed slugs support tool-calling. Check live prices before a
large run — they drift.

| Tier | When | Model | $/M in | $/M out | Ctx |
|---|---|---|---|---|---|
| **Budget** | high-volume, clean lookups (a domain has the fact on one page) | `deepseek/deepseek-chat` *(default)* | 0.20 | 0.80 | 131K |
| | cheapest output, same class | `deepseek/deepseek-v3.2` | 0.23 | 0.34 | 131K |
| | OpenAI budget tier | `openai/gpt-5-mini` | 0.25 | 2.0 | 400K |
| **Balanced** | most enrichment; conflicting snippets need reconciling | `google/gemini-3.1-flash-lite` | 0.25 | 1.5 | 1M |
| | open-weight mid | `z-ai/glm-4.6` | 0.43 | 1.74 | 203K |
| | agentic mid | `moonshotai/kimi-k2` | 0.57 | 2.3 | 131K |
| **Smart** | hard rows: funding histories, multi-source firmographics | `x-ai/grok-4.3` | 1.25 | 2.5 | 1M |
| | thorough reasoning + 1M ctx | `google/gemini-3.5-flash` | 1.5 | 9.0 | 1M |
| | Anthropic value tier | `anthropic/claude-haiku-4.5` | 1.0 | 5.0 | 200K |
| **Frontier** | max accuracy, low volume, gold-set eval | `anthropic/claude-sonnet-4.6` | 3.0 | 15 | 1M |
| | ceiling | `anthropic/claude-opus-4.8` | 5.0 | 25 | 1M |

Rules of thumb:
- Start on the default. Move up a tier only for the rows that come back null or low-confidence — run them as a second pass on a smarter model rather than paying frontier price for the whole table.
- Long pages or many sources per row → favor a 1M-context model (gemini, grok, claude) so the accumulated loop context doesn't get truncated.
- Reasoning models pair well with the finalization fallback; chat models rarely trigger it.

## Finalization fallback (the empty-answer failure)

`run` does ONE agent loop, then a tools-disabled finalization pass **only if** the loop
returns no structured answer (`result === null`). This replaced an earlier two-attempt
restart that re-ran the whole tool loop with a nudge — that didn't fix the real failure and
doubled cost.

The real failure, found by instrumenting `finishReason`: a thorough model (reasoning models
especially — gemini-3.x, gpt-5.x, grok all force reasoning on) **exhausts its step budget
still calling tools and never emits a final answer**. `finishReason` comes back
`"tool-calls"` with empty text, so the structurer has nothing to shape → null. It is not
model-specific: any model that runs out of steps mid-loop hits it; cheaper chat models
(deepseek) just tend to answer sooner.

What does NOT work, and why the fallback is a separate pass:
- **`prepareStep` tool-suppression is not honored.** Returning `{ activeTools: [],
  toolChoice: "none" }` on the final step (to force a text answer within budget) still let
  the model call a tool — verified, `finishReason` stayed `"tool-calls"`. So we cannot rely
  on reserving the last step.
- **Replaying the agent's own message history fails on reasoning models.** OpenRouter strips
  `reasoning_details` that lost their signatures across a multi-step tool conversation
  ("Some reasoning_details entries were removed because they were missing signatures"), and
  reasoning cannot be disabled per call ("Reasoning is mandatory for this endpoint").

So the fallback is a clean single-turn call (`buildFinalizer`, `src/core/agent.ts`): a
tools-less agent gets the findings serialized from `sink.log` (`serializeFindings`) as plain
text and is forced to emit the schema from those alone. Single-turn → no broken reasoning
history; no tools → it must answer instead of searching more. Its output cap is raised
(`FINALIZE_MAX_TOKENS`, 4000) so mandatory reasoning has headroom before the JSON. The
fallback never fires on the happy path, so it adds zero cost when the loop answers normally.

`structuredOutput` is passed `errorStrategy: "warn"` — Mastra's own control for a schema
validation failure (`'strict' | 'warn' | 'fallback'`, default `'strict'`). The default
**throws** and would crash the whole row on a malformed answer (wrong type, illegal enum);
`'warn'` logs and yields no object instead, so `res.object ?? null` falls through to the
finalization fallback rather than erroring. We let Mastra own validation (don't re-`safeParse`
what it already checked).

## Per-row error isolation: catch in `runTable`, not `run`

`errorStrategy: "warn"` only saves a row from a schema-validation failure. Anything else a
row can throw — a provider 5xx/429/auth error, a network drop, an Apify timeout inside a
tool — still rejects the `run` promise. The catch lives in `runTable`'s worker, not inside
`run`: each row is wrapped, and a throw becomes a failed `RunResult` (`result: null`,
`error` set, zero cost/tokens, real `durationMs`) instead of rejecting `Promise.all`. Why
this matters: the headline use is a big batch, and without isolation one transient blip on
row 7 would discard rows 1–500. Keeping the catch in `runTable` (not `run`) leaves a lone
`run` call free to throw for a caller that wants the exception, while every batch path (CLI
and `POST /run` both go through `runTable`) gets isolation for free. There is no per-row
retry yet — a thrown row is reported, not re-attempted (see roadmap, retry/backoff).

## Per-run tools and the Sink

Tools are built fresh inside each `run` and closed over a `Sink`
(`{ sources, seen, log, cost, onStep? }`) rather than reading/writing module-level state. This
keeps concurrent runs isolated and lets `RunResult` report exactly the URLs, steps, and
spend that this run produced. `sink.cost` (`CostAccumulator` in `src/core/cost.ts`) is the
single place every provider's spend lands during a run. `sink.seen` is the URL-provenance
set (see "No fabricated URLs"): `sources` is what the run reported, `seen` is what the run
is allowed to open.

## Cost accounting: exact per-provider, no estimates

`RunResult.cost` (`RunCost` in `src/core/types.ts`) reports real dollars, not a price-table
guess. Every figure comes from the provider's own reporting. Each paid tool step also
carries its own USD on `agentLog[].cost`; self-hosted rungs (SearXNG, impit, patchright)
are $0.

- **OpenRouter (LLM)** — the per-run provider (`buildOpenRouter`, `src/core/agent.ts`) is
  created with `extraBody: { usage: { include: true } }` and a `fetch` wrapper (`tapCost`)
  that reads `usage.cost` off **every** response and adds it to `sink.cost.openrouter`.
  This is why the provider is per-run and shared by both the agent and the structuring
  model: the tap is the only thing that sees the separate structuring call, which is **not**
  in `res.steps` — summing step costs would silently undercount. Responses are JSON or SSE
  (`text/event-stream`); `extractCostUsd` handles both (regex the last `"cost":` in a
  stream, `usage.cost` in JSON). The tap reads `res.clone()` so Mastra still gets the body.
- **Exa** — `costDollars.total` on every `search`/`getContents` response (exact USD).
- **Apify** — the run's `usageTotalUsd`. The sync `run-sync-get-dataset-items` endpoint
  returns only dataset items (no run id, no cost), so `runActor` (`src/tools/linkedin.ts`)
  uses the async pattern instead: start the run, poll `actor-runs/{id}?waitForFinish=30`
  until terminal, then read `usageTotalUsd` and fetch the dataset items.
- **Tavily** — `includeUsage: true` returns exact `usage.credits` (Tavily bills in credits,
  never dollars). USD = `credits × TAVILY_USD_PER_CREDIT` (env, default `0.008` = the PAYG
  rate); `tavilyCredits` is also kept on `RunCost` so the raw credit count survives.

## Per-table cache: per-run only, single-flight, cost on the miss

`src/core/cache.ts` is a tiny in-memory cache (`createCache` → `getOrCompute(ns, key, fn)`).
`runTable` makes **one** instance and threads it through every `run` → `buildAgent` →
`webTools`, so all rows of a table share it; a lone `run` gets its own throwaway cache. It
backs `web_search` (key `query|max_results`) and `fetch_page` (key `normalizeUrl(url)`).
Four choices that bite if you change them:

- **Per-run scope, never cross-run.** The cache lives only for one `runTable` call, then is
  dropped. A run is "now", so reuse inside it can't serve stale data — which keeps the
  live-not-stale stance that already rejected Exa `/contents` as a fetch rung (see Fetch
  ladder). A persistent / cross-process backend (Redis) is a deliberate later layer behind
  the same `Cache` interface, not this.
- **Single-flight: store the promise, not the value.** `getOrCompute` puts the in-flight
  promise in the map immediately, so concurrent rows asking for the same URL collapse onto
  one ladder walk instead of all missing at once (`runTable` runs rows concurrently). It
  returns `{ computed, value }` — `computed` is true only for the call that actually ran
  `fn`; concurrent followers and later hits get `false`.
- **Cost counts on the miss that computed it, $0 on hits.** Each tool adds `exa`/`tavily`
  cost to `sink.cost` only when `computed` is true, and records the step with `cached:
  !computed`. The row that paid shows the dollars; rows that reused show $0. Sum across the
  table stays exact — no double-count. Sources/provenance are still applied on **every**
  call (hits included), so `noteUrl`/`sink.sources` stay correct per row.
- **`fetch_page` caches the raw page text, before `fitToBudget`.** The BM25 reduction is
  query-dependent, so the cache holds the full fetched markdown and each call re-runs
  `fitToBudget` with its own `query`. Two rows fetching the same URL for different facts
  share the one download but each gets its own relevant slice.
- **Failures are not cached.** A throwing `fn` deletes its key so the next call retries
  (a transient 429/timeout shouldn't poison the URL for the rest of the run).

### L2: optional cross-run Postgres cache (`src/core/cache-pg.ts`)

`createCache` takes an optional `Layer2` (`get`/`set`). `createCacheFromEnv` supplies a
Postgres-backed one when `OPENCLAY_CACHE_URL` is set, else returns the L1-only cache —
`run`/`runTable` call `createCacheFromEnv`, so the engine is unchanged whether L2 is on. On an
L1 miss, `getOrCompute` reads L2; on an L2 miss it runs `fn`, returns it, and writes back to
L2 (and L1). A cross-run hit reports `cached: true` (cost $0 to this run — a prior run paid),
identical to an in-process hit.

- **Storage is one generic table, not typed per-kind.** `openclay_cache(ns, key, value
  jsonb, expires_at)`, PK `(ns, key)`, auto-created on first use. `value` is the whole tool
  result blob. TTL via `expires_at > now()` on read; `get` is a plain `SELECT` (no hit-counter
  write-on-read — kept minimal since nothing consumes usage stats).
- **Default OFF, short TTL.** Unset `OPENCLAY_CACHE_URL` = no L2, which keeps the
  live-not-stale default the whole tool is built around (the same reason Exa `/contents` was
  rejected as a fetch rung). When on, `OPENCLAY_CACHE_TTL_SEC` defaults to 1h — keep it short;
  a long TTL serves stale web facts.
- **Best-effort, never fatal.** No DSN → no L2. Any DB error (unreachable, bad schema) is
  caught: `get` returns a miss, `set` no-ops, both log to stderr. The run still completes live.
- **jsonb double-encoding trap (Drizzle + Bun SQL).** Bun's SQL driver already JSON-encodes an
  object param bound to a `jsonb` column, and Drizzle's `jsonb` column codec *also*
  `JSON.stringify`s it on insert — together they store a JSON **string** (`jsonb_typeof` =
  `string`, `value->>'k'` returns null), and reads only round-trip by luck (double parse). The
  fix in `cache-pg.ts`: bypass the codec on write — pass the raw object through a
  `sql\`${value}::jsonb\`` template so Bun encodes it exactly once (verified `jsonb_typeof` =
  `object`), and use `excluded.*` in the `onConflictDoUpdate` set rather than re-binding. Reads
  through the column decoder are fine once storage is a real object. Test against a real
  Postgres (`tests/cache-pg.test.ts`, gated on `OPENCLAY_CACHE_URL`); a fake L2 would not catch
  this.
- **Only cacheable results are persisted.** `getOrCompute`'s `cacheable` predicate gates the
  L2 write: `web_search` persists only non-empty result sets, `fetch_page` persists `ok`
  (usable) and `dead` outcomes but never `transient` (see Status-aware negative cache).
- **TTL can depend on the value.** `opts.ttlMs` may be a function of the result, returning
  `undefined` to fall back to the cache's default (`OPENCLAY_CACHE_TTL_SEC`, or 1h). This is
  how a dead URL gets a long TTL while a normal page uses the short default — the L2 `set`
  uses exactly the TTL it is handed (no env override at the write).

### Adapted from gtm-research, not copied

The cache idea (persistent, cross-run, hash-keyed, TTL'd, best-effort-optional, symmetric
normalization) is gtm-research's (`third_party/gtm-research`). What we deliberately changed:

- **One generic `jsonb` table, not their two typed tables** (`page_cache` + `search_cache`).
  Theirs carry `fetch_count`, `content_hash`, `provider` and drive telemetry views + a
  watchdog. We already have exact cost accounting (`cost.ts`), so the cache stays a plain blob
  store and owns no telemetry.
- **Cache the raw page text, not a `digest`.** They store a cheap-model-compressed digest per
  page; we have no digest step — the per-query BM25 `fitToBudget` runs on read instead.
- **Search key is `query|max_results`, not `rung|query`.** Their caller picks a rung; our
  `searchWeb` is a ladder that returns whichever rung answered, so we cache the final answer.
- **Status-aware negative cache, not failure-blind.** Like them we negative-cache dead URLs;
  unlike a naive version we never cache a *transient* failure. `fetchLadder` returns an
  `outcome`: `ok` | `dead` | `transient`. `impitFetch` surfaces the real HTTP status, and
  `isDeadStatus` maps **401 / 404 / 410** to `dead` — the first rung short-circuits on those
  (no point escalating the ladder for a page that does not exist or needs a login). **403 is
  NOT dead**: it is usually bot-blocking, exactly what patchright + proxy + solver exist to
  beat, so a 403 escalates; if the whole ladder still fails it ends `transient`. Timeouts,
  5xx, network errors and unclassified empties are all `transient`. Cross-run we persist `ok`
  (default TTL) and `dead` (`DEAD_TTL_MS`, 7 days) and drop `transient`, so a real 404 is
  skipped for days while a flaky proxy never poisons a good URL. (`transient` is still cached
  in L1 for the rest of the run — a dead-ish URL is walked once per run, not once per row.)
  We diverge from gtm-research's digest-only model: the same `dead`/`transient` split rides on
  our raw-text cache instead of their compressed digest.

## Search: SearXNG → Exa → Tavily ladder

`web_search` (`src/tools/web.ts`, `SEARCH_LADDER`) walks providers cheapest-first:
self-hosted SearXNG (`SEARXNG_URL`, the compose service — zero cost, aggregates
Google/Bing/Brave/DDG), then Exa's REST API (`api.exa.ai`, `x-api-key` auth), then Tavily
(`api.tavily.com`, Bearer auth). A rung is skipped when its env var is unset, and the
ladder escalates when a rung throws **or returns zero results** — so a SearXNG outage or
an empty result page silently falls through to the paid backups rather than starving the
agent. If every rung came back empty the empty list is returned (informative to the
model); only when every rung *threw* does the tool error. The step log records the
winning rung as `via: searxng | exa | tavily`, plus a `trail` of every rung tried with
the reason it escalated (`searxng: empty`, `exa: error …`), so the waterfall is visible.

**SearXNG routes its outgoing engine scrapes through the Evomi residential proxy.** Without
it, Google/DDG/Brave/Startpage CAPTCHA-block the datacenter IP and most queries (especially
operator-heavy `site:`/quoted/`OR` ones) return zero results — so the free rung silently
falls through to paid Exa on nearly every call. Three gotchas made this non-trivial:
- **SearXNG ignores `HTTP_PROXY`/`HTTPS_PROXY` env vars.** Its `searx/network/client.py`
  builds httpx transports with an explicit `proxy=`, bypassing httpx's env/mounts resolution.
  The proxy has to live in `outgoing.proxies.all://` in `settings.yml`.
- **`settings.yml` does not interpolate `${ENV}`**, and the Evomi password must not be
  committed. So `searxng/settings.yml` is a secret-free template; `searxng/entrypoint.sh`
  (wired as the container `entrypoint`) appends the `proxies` block from `EVOMI_*` env at
  start, then `exec`s the stock `/usr/local/searxng/entrypoint.sh`.
- **`outgoing.extra_proxy_timeout` must be an int** (`10`, not `10.0`) or SearXNG rejects the
  whole settings file as invalid and crash-loops.

Google needs two more settings on top of the proxy, because a rotating residential proxy
means any single request can land on a Google-flagged IP:
- **`search.suspended_times.SearxEngineCaptcha: 0`** (also `SearxEngineTooManyRequests` /
  `SearxEngineAccessDenied`). The default is 3600s — one CAPTCHA suspends the whole Google
  engine for an hour, so every later query shows `google: Suspended: CAPTCHA` even though the
  next proxy IP would have worked. `0` disables the suspension.
- **`outgoing.retries: 2`** — a CAPTCHA'd engine request is retried on a fresh proxy IP
  *within the same query*, so Google succeeds as soon as a request hits a clean residential IP.
The Google engine code itself (user-agent / consent handling) is a moving target SearXNG
patches in newer images, so stay current on `searxng/searxng:latest`.
Result: previously-zero operator queries now return ~27 results, and Google returns ~9–10
per query with no suspensions.

**Rejected: chasing zero-CAPTCHA self-hosted Google.** Two avenues were tested on the live
Evomi residential pool and both fail. (1) SearXNG `outgoing.pool_maxsize: 0` (force a fresh
connection — hence a fresh rotating IP — per engine request) cut Google CAPTCHAs from ~99%
to ~28% of a 100-request burst but at 4× latency plus timeouts, and never reached zero.
(2) A self-hosted browser SERP scraper (`third_party/openserp`, go-rod + full fingerprint
stealth: `navigator.webdriver`/WebGL/plugins/`chrome.runtime` patches, unique Evomi session
IP per term) CAPTCHA'd **every** headless request — *worse* than its restrained default,
because Google fingerprints the spoofing JS itself (openserp deliberately strips those
patches for Google for exactly this reason). The wall is structural: any self-hosted scraper
fed rotating residential IPs loses to Google's server-side detection regardless of stealth
tier. Zero-CAPTCHA Google is a managed-API outcome (Serper/SerpAPI run mobile/ISP pools +
continuously-retuned evasion + server-side solving) or needs an in-loop solver — not a
proxy-tuning or stealth-patch outcome. So the ladder stays SearXNG → Exa → Tavily and adds
no self-hosted Google rung.

Exa sits above Tavily because its `/search` returns page text **inline** via `contents` —
for indexable public pages the search step often already carries the answer. Search
requests cap inline text (`contents.text.maxCharacters`) to keep tool output bounded.
Tavily was added as the last rung after comparing the gtm-research waterfall (its order:
free keyword pool → Exa → Tavily); it is a pure backup for when both cheaper rungs fail.
The tools remain the swap seam — the agent and engine are unaware of the provider.

## Fetch: impit → patchright (direct → +Evomi → +CapSolver) → Tavily /extract

`fetch_page` tries a local fetch first — `impit` (Chrome TLS fingerprint, so plain
bot-checks pass). A **PDF** response (`content-type: application/pdf` or `.pdf` URL) is parsed
to text with `unpdf` instead of the HTML path — `extract.ts` is HTML-only, so without this a
PDF returned nothing.

HTML is turned into markdown by `src/tools/extract.ts`. First `extractStructuredData` pulls
the machine-readable layer (`<script type="application/ld+json">` + `<meta>`/og) and prepends a
compact `## Page structured data` block; then the visible body is extracted **Readability-first
with a prune fallback** — because a research agent hits both articles *and* structured pages:

1. **Mozilla Readability** (`@mozilla/readability` over a `linkedom` DOM, gated by
   `isProbablyReaderable`) handles the article/blog/news slice — it locks onto the main
   content container and strips related-posts/sidebars/comments cleanly. Used only when the
   page looks like an article and yields ≥ `MIN_ARTICLE_CHARS`; any failure falls through.
2. Otherwise the **Crawl4AI `PruningContentFilter` port** runs (the generic path for
   pricing/docs/listings/dashboards): drop `nav/footer/header/aside/script/style/form/iframe/
   noscript`, then score each node (text density 0.4, link density 0.2, tag weight 0.2,
   class/id penalty 0.1, log-text-length 0.1) and prune below 0.48. Readability alone would
   be wrong here — it discards anything that isn't article prose, i.e. exactly the tables you
   want.

Both paths finish through Turndown (+gfm): headings, lists, and tables (pricing pages are
tables). A leftover-table rule flattens any table gfm can't convert (no heading row — e.g.
Wikipedia infoboxes) to ` · `-joined text, so raw `<table>` HTML never leaks into the output.
Images are dropped; same-domain links keep their hrefs for navigation, off-domain links
flatten to text to save tokens.

### JSON-LD structured data: the layer the reader tools throw away

`extractStructuredData` parses `<script type="application/ld+json">` (schema.org) and `<meta>`
description/og tags *before* the body extraction, and prepends a `## Page structured data`
block. This is the highest-value extraction decision for firmographic enrichment, and it is
deliberately something the popular reader tools do NOT do:

- **Why it matters.** JSON-LD exists for SEO (Google rich results), so sites publish exact,
  curated facts there — `numberOfEmployees`, `foundingDate`, `PostalAddress`, `FAQPage` Q&A,
  `Product` price/rating — **even on gated pages where the visible body is paywalled.** On
  Pitchbook's Hugging Face page the visible body is "Request a free trial"; the JSON-LD carries
  220 employees, founded 2016, HQ New York, $395M raised, investors, competitors. Reconciliation
  across sources is only as good as the facts each source yields, and this is where the exact
  ones live.
- **Why the reader tools miss it.** Mozilla Readability (and everything built on it — Jina
  Reader, our Readability path) is an *article* extractor: it locks onto prose and discards
  `<script>`. Verified against the cloned upstreams: Jina Reader (`third_party/jina`) has zero
  JSON-LD handling; Crawl4AI (`third_party/crawl4ai`) parses JSON-LD only in its URL-*seeder*
  (`async_url_seeder.py`) for BM25 ranking, never in the page-content path (its `extract_metadata`
  pulls title/description/og/twitter only — open feature request #968). So extracting JSON-LD
  into the content puts us ahead of both for data/gated pages, not at parity.
- **Scope, kept tight.** Whitelisted types only — Organization/Corporation/LocalBusiness,
  PostalAddress, FAQPage, Product — flattening `@graph`, coercing `QuantitativeValue`/nested
  address/number-or-range, stripping inline tags from FAQ answers, deduping, capped at
  `STRUCTURED_CAP` (2500 chars). Junk types (`WebPage`, `Table`, `BreadcrumbList`) are ignored.
- **The fetch interplay.** On gated hosts impit is usually rate-limited (Pitchbook returns 429),
  so the ladder escalates to patchright, whose rendered HTML carries the JSON-LD — so the
  structured block lands without any new escalation logic. The behaviour prompt was updated to
  match: data-directory pages (Pitchbook, ZoomInfo, G2, Glassdoor) are now worth fetching for
  their structured block, with crunchbase.com still the lone unfetchable exception (Turnstile →
  use `crunchbase_company`).

The cheap, self-hosted rungs always run first; only when every one of them fails `usable()`
do we fall back to the one **paid** rung (Tavily `/extract`) as a last resort. The
self-hosted rungs:

1. **impit** — browser-TLS HTTP, free, default.
2. **patchright direct** — when impit fails `usable()` (under 200 chars, or under 3000 chars
   with block-page markers), `fetch_page` calls the patchright compose service
   (`GET /fetch?url=` → rendered HTML, `patchright/server.mjs`). Real stealth Chrome (patchright
   is a drop-in Playwright fork that patches Chromium's automation tells); cracks CSR/JS-shell pages.
3. **patchright + Evomi residential** — when the direct render is still unusable, retries with
   `&proxy=1`, routing the browser through Evomi residential (`EVOMI_*` env, a second
   browser instance launched with the proxy). The server also waits out auto-resolving
   interstitials (Cloudflare passive / DataDome) before capturing content.

HTTP rather than Playwright's websocket protocol because Bun's ws client hangs against
Playwright's server (Node connects fine); the HTTP seam also keeps `patchright` out of
this package entirely. Each rung auto-skips when its env is unset (`PATCHRIGHT_URL`, `EVOMI_*`).
Step log records the winning rung as `via: impit | patchright | patchright+proxy`, plus a
per-URL `trail` naming each rung tried and why it escalated (`impit: bot-wall/shell (812c)`,
`patchright: empty`), so an early jump to Tavily is explainable rather than silent.

A fourth rung, `&solve=1`, handles the two challenge shapes separately, free-first:

- **Embedded Turnstile widget** (a `cf-turnstile` div with a `data-sitekey` on an otherwise
  reachable page — the Crunchbase / G2-form shape). `solveTurnstile` first does a **free
  interactive click**: locate the widget, human-like mouse move, click the checkbox so the
  widget runs the site's own success callback and self-issues a real token into
  `cf-turnstile-response`. Only if the click leaves no token does it fall back to CapSolver
  `AntiTurnstileTaskProxyless` (solve the sitekey → inject the token → fire the callback /
  submit the form). The click alone solves the WebUnlocker arena Level 2 live sitekey in
  ~8s for $0 (verified: 752-char real token where the pre-build render had none).
- **Full interstitial** (`just a moment` / `cf-browser-verification` — the whole page is the
  challenge). `capsolve` calls CapSolver `AntiCloudflareTask` with the sticky Evomi session
  (`password_session-<rand>` — rotates across fetches, pins one IP for the solve+reload);
  the returned `cf_clearance` cookie + user-agent are set on a new context and the page is
  reloaded through the same IP.

`via: patchright+solver` for both.

When all of the above fail, one **paid** rung runs as last resort: **Tavily `/extract`**
(`via: tavily`, official `@tavily/core` SDK, `TAVILY_API_KEY`, `extractDepth: "advanced"`). It
is always-live — it fetches and renders the page fresh on every call — and uses a different
proxy/infra stack than patchright, so it is a genuine second attempt rather than a repeat.
Auto-skips when `TAVILY_API_KEY` is unset.

**Why not Exa `/contents` as a fetch rung (it used to be one).** Live, up-to-date data is the
priority for this tool, and Exa `/contents` is **cache-first** — by default it serves Exa's
pre-crawled copy, which can be months stale. That is the wrong answer for "current pricing /
does this company offer a free trial *now*". The only way to make Exa fresh is to force
livecrawl (`maxAgeHours: 0`), but then it is just a generic live crawler — weaker at beating
anti-bot walls than the rung we already ran for free one step earlier (patchright + residential
proxy + Turnstile solver). So Exa's fetch role was either stale (cache) or redundant
(livecrawl); it was dropped from `fetch_page`. Exa stays the second **search** rung, where its
index is an asset and the agent live-fetches the page afterwards anyway. The corollary: when a
page is un-fetchable live (hard anti-bot, every live rung blocked), `fetch_page` returns nothing
rather than stale cache — the agent should note it could not verify live, not quote a stale page.
The `exaSearch`/`tavilySearch` clients are still constructed once and shared with the fetch
Tavily client.

The browser runs **headed inside Xvfb** (`patchright/Dockerfile` wraps the start in `xvfb-run`,
`server.mjs` launches `chromium.launch({ headless: false })`) because Cloudflare managed
challenges detect headless at the binary level. It runs patchright's bundled patched Chromium
(`npx patchright install --with-deps chromium`), not the Google Chrome channel — Chrome ships no
Linux arm64 build, so the `channel: "chrome"` path can't build on Apple Silicon; bundled Chromium
supports both arches and patchright patches it regardless (slightly weaker stealth than real
Chrome is the tradeoff). Headed and `viewport: null` per context are patchright's own stealth
requirements; headless or a custom viewport reintroduces automation tells. Container needs
`security_opt: seccomp:unconfined` (headed Chrome creates user namespaces
for its sandbox) and a launch-retry (Xvfb isn't warm at boot — first launch can reject).

Tested, honestly — the embedded-Turnstile shape (Crunchbase) is now solved on a test arena,
G2's DataDome is not:
- Proxy rung verified working — exit IP changes to residential (ipify confirms). Sticky
  session format `password_session-<id>` confirmed (same id → same IP, new id → new IP).
- Headed Xvfb verified working (browser launches, renders, self-heals at boot) but did NOT
  crack either site on its own. Necessary, not sufficient.
- G2 (DataDome): 2543-byte CAPTCHA every time, headed + residential. One lucky 559KB hit once,
  never reproduced.
- Embedded interactive Turnstile (the Crunchbase shape: `cf-turnstile` widget on a reachable
  page) is now **solved by the free click rung** — `solveTurnstile` clicks the checkbox and the
  widget self-issues a real token. Verified against the WebUnlocker arena Level 2 live sitekey
  (~8s, $0, 752-char token). End-to-end against Crunchbase itself not yet run; the click drives
  the site's own callback, so the token is wired the way the real target consumes it.
- G2 (DataDome): 2543-byte CAPTCHA every time, headed + residential. One lucky 559KB hit once,
  never reproduced. DataDome is **not** Turnstile — the click rung does not apply; this still
  needs a DataDome-specific solver or the Exa-cache fallback.
- Earlier the only solver was CapSolver `AntiCloudflareTask`, which targets full interstitials,
  not embedded widgets — wrong tool for Crunchbase, and the 2026-06 arena test confirmed it was
  being skipped entirely on the widget shape. That gap is what the Turnstile rung above closes.

Realistic next levers (not yet built): self-host Byparr/FlareSolverr (90%+ on CF in benchmarks)
as a solver rung independent of CapSolver uptime; a DataDome-specific solver for the G2 shape;
caching a solved token / `cf_clearance` per domain so a wall is cracked once, not per row. The
CapSolver fallbacks auto-skip without `CAPSOLVER_API_KEY`.

Why not an off-the-shelf extractor: Mozilla Readability and friends are article-tuned and
benchmark poorly on exactly our page types (product/pricing/service pages — F1 ~0.4–0.6 vs
~0.93 on articles). The pruning heuristic plus table-preserving render does better on GTM
pages and is ~150 lines we control.

## LinkedIn via Apify HarvestAPI actors, env-gated

LinkedIn pages are login-walled, so the fetch cascade can never read them. Four tools in
`src/tools/linkedin.ts` call HarvestAPI's no-cookie Apify actors synchronously
(`POST /v2/acts/harvestapi~<actor>/run-sync-get-dataset-items?timeout=120`):
`linkedin-profile-scraper` (input `{url}`), `linkedin-profile-posts` (input
`{targetUrls, maxPosts}`), `linkedin-post-reactions` (input `{posts, maxItems}`),
`linkedin-company-employees` (input `{companies, jobTitles?, searchQuery?, maxItems}` —
exposed as `linkedin_find_people`; $4 per 1k profiles in short mode, $12 per 1k with
`findEmails`).
Raw actor items are huge; each tool maps them to a compact shape (truncated text, top-5
experience, reactor name/position/url) so a call stays a few hundred tokens, not tens of
thousands. The tools register only when `APIFY_API_TOKEN` is set — without it the agent
has no LinkedIn capability and the doctrine's "never fetch linkedin.com" rule still
applies. Cost is per item (~$2–4 per 1k), which is why the doctrine and tool descriptions
both say call once per target with small max counts.

## `.claude/` hooks: a judgment-based doc-sync pair, nothing more

Originally there were none — at the initial size there was no drift pressure. That held
until the fetch-ladder rewrite and the fourth LinkedIn tool both landed without their doc
updates (caught by the 2026-06 codebase audit). `.claude/settings.json` now carries the
minimal scriptless pair: a SessionStart pointer naming which doc owns which fact, and a
Stop prompt hook that flags a `src/`, compose, `patchright/`, or `searxng/` change landing
without its owning doc. No hook scripts to maintain. Escalate to a real pre-commit diff check only if
drift survives the nudge.

## Large pages: BM25 relevance, not a bigger cap

A long page can't be dumped into the agent (context blow-up) and can't be head-truncated
safely (the answer might be past the cut). The fix is **retrieval, not truncation**:
`fitToBudget` (`extract.ts`) only triggers when the cleaned markdown exceeds `PAGE_CAP`, then
splits it into chunks and keeps the **BM25-top** chunks for the agent's `query` until the
budget is full — same token bound, but spent on the *relevant* sections instead of the *first*
ones. Bounded by construction, answer-preserving by relevance.

BM25 (lexical, ~40 lines, no deps) is deliberate over the semantic alternatives: it is free,
local, instant, and deterministic, and for GTM fact-finding the query terms usually appear
verbatim on the page (funding, pricing, headcount, names). An embeddings/cross-encoder
**reranker** is the semantic upgrade for the ~20% where wording differs — but it needs a model
(paid API or local GPU), so it is deferred until BM25 demonstrably misses. A vector DB is not
relevant here: it indexes a large corpus for dense first-stage retrieval; one page is ~50
chunks, so BM25 ranks them directly. Fallbacks: no `query` → head-truncate; ≤1 chunk or no
positive BM25 hit → head-truncate. Both reduced outputs carry a trailing marker so the agent
knows it saw a subset.

## Crunchbase: a fallback-only Apify actor, not a fetch target

Crunchbase is CF-Turnstile-walled, so `fetch_page` can't get it and the behaviour prompt says
never to try. The primary path for funding/firmographics is still **search the mirrored open
sources** (Tracxn, Dealroom, Sacra, news). `crunchbase_company` (`src/tools/crunchbase.ts`) is
a **last resort**: the agent calls it only when that search fails to pin the round/total/
investors — gated by the tool description and the behaviour prompt, not by code. SearXNG
usually surfaces the `crunchbase.com/organization/<slug>` URL in search results even though the
page is unfetchable, so the agent passes that URL to the actor (name-search is the secondary
mode). It runs through the shared `runActor` (`apify.ts`), env-gated on `APIFY_API_TOKEN` like
the LinkedIn tools, and bills via the run's `usageTotalUsd` into `sink.cost.apify`.

The actor id is **`CRUNCHBASE_ACTOR` (default `parseforge~crunchbase-scraper`)** because
third-party Crunchbase actors come and go and change their I/O contract — swapping the env var
beats a code edit. Output mapping is deliberately defensive (reads several field-name aliases
for funding/round/investors) so a different actor's slightly different shape still maps. Not
live-verified in CI (a real run costs Apify credits); smoke-test against your chosen actor
before relying on it.

## No fabricated URLs: every opened URL must have provenance

The model will happily guess a URL from a name — `linkedin.com/company/<slug>`, a deep
`/about` path, a `crunchbase.com/organization/<slug>` — and a wrong guess resolves to a
stale decoy page that the model then reports as fact (the original "Hugging Face → 2-10
employees, 62 followers" bug came from the model inventing `/company/hugging-face`). A
prompt rule alone does not stop this, so the guard is in code.

- **The rule:** a URL may only be fetched or scraped if it is *verified* — it appeared in a
  `web_search` result, in this row's own input, or as a link on a page already fetched this
  run. Anything else is a fabrication and is refused.
- **The mechanism:** `sink.seen` (`src/tools/sink.ts`) is a set of normalized URLs.
  `noteUrl` adds to it; `search.ts` notes every result URL, `fetch.ts` notes each fetched
  URL **and** every link in the returned text (`noteUrlsInText`), and `engine.run` seeds it
  from the row's values (full URLs and bare domains-as-homepage). `assertVerifiedUrl` throws
  if a URL is not in `seen`; `fetch_page`, `linkedin_*` (when given a URL, not a name), and
  `crunchbase_company` (URL mode) all call it first.
- **Normalization** (`normalizeUrl`) strips protocol, leading `www.`, and trailing slash, and
  ignores query/hash — so `www.x.com/p/` and `https://x.com/p?utm=1` match, but a different
  path on a verified host does not. This is why a guessed deep path is still caught even when
  the host is known.
- **The recovery path:** the thrown error tells the agent what to do instead (pass the exact
  company name so `linkedin_company`/`crunchbase_company` resolve the page themselves, or
  `web_search` first and use a URL from the results). The behaviour prompt
  (`src/core/agent.ts`) states the same rule up front so the model rarely hits the guard.
- **Why name-search is the preferred LinkedIn/Crunchbase path:** their actors resolve the
  right entity from a name, removing the need for a URL at all. A URL is accepted only when it
  came from search — never constructed. Verified live: `linkedin_company` by name "Hugging
  Face" resolves the canonical `/company/huggingface` (789 employees, 1.2M followers), whereas
  the guessed `/company/hugging-face` returns a decoy (2-10 employees, 62 followers). The
  decoy was purely an artifact of the fabricated slug.
- **Firmographic bias for company rows:** when a row is about a company, the behaviour prompt
  biases toward the LinkedIn company page (via `linkedin_company` by name) and the company's
  own site as the authoritative baseline for headcount/industry/HQ/founded year, reconciled
  against each other — because aggregator snippets conflict and go stale. This is the source
  of truth for firmographics; open search fills only what they don't carry.

## Two frontends, one core — never duplicate run logic

The CLI (`src/cli.ts`) and the HTTP API (`src/api.ts`) are both thin adapters over the same
core. Each turns its own input format into an `ActionSpec` + rows + `RunOptions`, then calls
`buildAction` (`core/action.ts`) and `runTable`. The rule that bites: action assembly,
schema building, the agent loop, and cost accounting live in `core/`, never in a frontend.
If you find yourself writing `defineAction` or `buildSchema` inside `cli/` or `api.ts`,
that logic belongs in `core/action.ts` so both paths share it. Frontends never import each
other.

The API is `@hono/zod-openapi`, not plain Hono: the request/response zod schemas are the
single source of truth — they validate the body (malformed → `400` before the handler) *and*
generate `/openapi.json` (served as a Scalar reference at `/docs`). A hand-written spec, or manual
`safeParse` in the handler, would be a second source of truth that drifts.
