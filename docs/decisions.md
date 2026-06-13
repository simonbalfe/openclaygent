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

## One repair retry

`run` retries once when the structured answer comes back null. Models intermittently end a
turn on empty or non-JSON output, leaving the structurer nothing to shape. The retry
re-asks with a nudge to return the JSON using what was already found. In testing this
turned an intermittent 2/3 success rate into a consistent 3/3. The vault calls this "the
line between usually works and reliable across thousands of rows."

`structuredOutput` is passed `errorStrategy: "warn"` — Mastra's own control for a schema
validation failure (`'strict' | 'warn' | 'fallback'`, default `'strict'`). The default
**throws** and would crash the whole row on a malformed answer (wrong type, illegal enum);
`'warn'` logs and yields no object instead, so `res.object ?? null` falls through to the
repair retry rather than erroring. We let Mastra own validation (don't re-`safeParse` what
it already checked); the only thing we add on top is the nudge-retry, which Mastra's
structured output doesn't do. A fuller-native path — an output processor with
`maxProcessorRetries` — could replace the manual loop later, but the loop is openclaygent's
specific behaviour and small.

## Per-run tools and the Sink

Tools are built fresh inside each `run` and closed over a `Sink`
(`{ sources, log, cost, onStep? }`) rather than reading/writing module-level state. This
keeps concurrent runs isolated and lets `RunResult` report exactly the URLs, steps, and
spend that this run produced. `sink.cost` (`CostAccumulator` in `src/cost.ts`) is the
single place every provider's spend lands during a run.

## Cost accounting: exact per-provider, no estimates

`RunResult.cost` (`RunCost` in `src/types.ts`) reports real dollars, not a price-table
guess. Every figure comes from the provider's own reporting. Each paid tool step also
carries its own USD on `agentLog[].cost`; self-hosted rungs (SearXNG, impit, patchright)
are $0.

- **OpenRouter (LLM)** — the per-run provider (`buildOpenRouter`, `src/agent.ts`) is
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

## Search: SearXNG → Exa → Tavily ladder

`web_search` (`src/tools/web.ts`, `SEARCH_LADDER`) walks providers cheapest-first:
self-hosted SearXNG (`SEARXNG_URL`, the compose service — zero cost, aggregates
Google/Bing/Brave/DDG), then Exa's REST API (`api.exa.ai`, `x-api-key` auth), then Tavily
(`api.tavily.com`, Bearer auth). A rung is skipped when its env var is unset, and the
ladder escalates when a rung throws **or returns zero results** — so a SearXNG outage or
an empty result page silently falls through to the paid backups rather than starving the
agent. If every rung came back empty the empty list is returned (informative to the
model); only when every rung *threw* does the tool error. The step log records the
winning rung as `via: searxng | exa | tavily`.

Exa sits above Tavily because its `/search` returns page text **inline** via `contents` —
for indexable public pages the search step often already carries the answer. Search
requests cap inline text (`contents.text.maxCharacters`) to keep tool output bounded.
Tavily was added as the last rung after comparing the gtm-research waterfall (its order:
free keyword pool → Exa → Tavily); it is a pure backup for when both cheaper rungs fail.
The tools remain the swap seam — the agent and engine are unaware of the provider.

## Fetch: impit → patchright (direct → +Evomi → +CapSolver) → Exa /contents → Tavily /extract

`fetch_page` tries a local fetch first — `impit` (Chrome TLS fingerprint, so plain
bot-checks pass) plus `src/tools/extract.ts`, a TypeScript port of Crawl4AI's
`PruningContentFilter`: drop `nav/footer/header/aside/script/style/form/iframe/noscript`,
then walk the DOM scoring each node (text density 0.4, link density 0.2, tag weight 0.2,
class/id penalty 0.1, log-text-length 0.1) and prune below the fixed 0.48 threshold.
Survivors convert to GFM markdown via Turndown (+gfm plugin) — headings, lists, and
crucially tables, since pricing pages are tables. Images are dropped; same-domain links
keep their hrefs so the agent can navigate the site, off-domain links flatten to text to
save tokens. The cheap, self-hosted rungs always run first; only when every one of them
fails `usable()` do we fall back to the two **paid** content providers (Exa, then Tavily) as
a last resort. The self-hosted rungs:

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
Step log records the winning rung as `via: impit | patchright | patchright+proxy`.

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

When all of the above fail, two **paid** content rungs run as last resort, in cost order:
**Exa `/contents`** (`via: exa`, official `exa-js` SDK, `EXA_API_KEY`) then **Tavily `/extract`**
(`via: tavily`, official `@tavily/core` SDK, `TAVILY_API_KEY`). Exa goes first because it serves
its own pre-crawled cache — it cracks DataDome/Turnstile-walled aggregators (Crunchbase,
LinkedIn) that the live browser rungs can't, since Exa already indexed the public surface and
isn't doing a live hit. Tavily `/extract` is a live fetch, so it dies on the same walls the
browser does; it earns the last slot only as a different-infra second opinion for non-walled
pages. Both auto-skip when their key is unset; the search rungs use the same two SDKs
(`exaSearch`/`tavilySearch`), so the clients are constructed once and shared.

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
Stop prompt hook that flags a `src/`, compose, or `patchright/` change landing without its
owning doc. No hook scripts to maintain. Escalate to a real pre-commit diff check only if
drift survives the nudge.
