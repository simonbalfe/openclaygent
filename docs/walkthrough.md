# How it works — a row's journey, and why each step is built this way

A plain-language tour of what happens when openclaygent researches one row, and the reasoning
behind each piece. This is the *why*; for the precise mechanism see `architecture.md`, and for
the sharp edges see `decisions.md`.

## The shape of the problem

You have a table and a question: "for each of these companies, what CRM do they use?" The
question is fixed; the rows vary. So the unit is an **action** (the brief) run over **many
rows** — write the brief once, get a typed answer per row.

**Why this shape:** it mirrors how a human researches a list — same task, repeated per entry.
Fixing the brief and varying the row is what makes it cheap and batchable.

## 1. You call it — CLI or HTTP

Two front doors: a CLI (`bun run cli`) and an HTTP API (`bun run api`). Both turn your input
into the same three things — instructions, a `{{templated}}` prompt, and an output schema —
then hand them to the same engine.

**Why two entry points sharing one core:** a coding agent or script wants to shell out to the
CLI; a service wants an HTTP endpoint. Neither should reimplement the research logic, so both
are thin adapters over `core/` — no duplicated behaviour to drift apart.

## 2. The brief becomes a typed action

Your `schema` (e.g. `{"crm":"string?","confidence":"low|medium|high"}`) is turned into a real
validation schema, not just field names.

**Why typed, not a name list:** the whole value is *trustworthy cells*. A typed schema means
every answer is validated — right type, legal enum, nullable where allowed — and a malformed
answer can be caught and retried instead of silently wrong.

## 3. The skip gate

Before spending anything, a row can be skipped (`--require domain`, or `conditionalRun`): if it
doesn't qualify, return immediately, zero tokens.

**Why first:** the cheapest row is the one you never research. Skipping unqualified rows up
front is the single biggest cost saver on a big list.

## 4. The agent loop — reason, act, observe

A fresh agent runs the row: it reasons about what it needs, calls a tool (search or fetch),
reads the result, and repeats until it can answer.

**Why an agent, not a fixed scrape:** the web is messy and every company's site is different.
A fixed "fetch URL X, read field Y" pipeline breaks constantly. An agent adapts — it decides
what to search, which page to read, when it has enough — which is exactly the judgement the
task needs.

## 5. Search — cheapest rung first

`web_search` is a waterfall: self-hosted **SearXNG** (free) → **Exa** → **Tavily**. It tries
the cheapest source you've configured and only falls through to a paid one when that returns
nothing.

**Why a waterfall:** cost is the point. Free search handles the bulk; you only pay when free
genuinely fails. An unset paid key is just a skipped rung, never an error.

**Why snippets first:** search results usually contain the answer already. The agent is told to
prefer snippets and only open a full page when it actually needs one — fewer fetches, fewer
tokens.

## 6. Fetch — escalate only when blocked

When a snippet isn't enough, `fetch_page` walks its own ladder: **impit** (a normal HTTP
request with a browser fingerprint, free) → **patchright** (a real stealth browser, free) →
**+ residential proxy** → **+ Turnstile/captcha solver** → **Tavily extract** (paid, always
live).

**Why a ladder:** most pages come back on the free first rung. The expensive rungs (proxy,
solver, paid extract) only fire for the minority that block a plain request — so you pay for
hard pages, not easy ones.

**Why never fetch the walled aggregators (Crunchbase, G2, LinkedIn):** they hard-block bots
and burn the budget for nothing. Their facts are mirrored across open sources, so the agent
searches for the *fact* instead of fighting the wall.

## 7. Turning a page into clean text

A fetched page is messy HTML. The extractor cleans it to markdown: **Readability first** (for
articles and blog posts) falling back to a **density prune** (for pricing pages, docs, tables),
then markdown conversion. PDFs are parsed to text separately.

**Why two extractors:** a research agent reads both articles *and* structured pages.
Readability is purpose-built for article bodies but throws away tables; the prune keeps any
dense content. Using Readability where it fits and the prune everywhere else gets clean output
on both, instead of being good at one and bad at the other.

**Why clean to markdown at all:** raw HTML is mostly navigation, scripts, and markup noise —
feeding it to the model wastes tokens and buries the answer. Markdown keeps headings, lists,
and tables (pricing is tables) and drops the rest.

## 8. Big pages — keep what's relevant, not the first part

If a cleaned page is still too long, it isn't blindly truncated. The text is split into chunks,
each scored against what the agent is looking for (BM25 keyword relevance), and only the most
relevant chunks are kept within a fixed budget.

**Why relevance over truncation:** chopping the first N characters protects the context window
but might cut the exact paragraph with the answer. Ranking by relevance spends the same budget
on the sections that actually answer the question. It's free and local — no model needed.

## 9. Walled-site fallbacks — delegate, don't fight

For high-value sites that block everyone (LinkedIn, Crunchbase), there are managed enrichment
tools (`linkedin_*`, `crunchbase_company`) backed by specialist scrapers. They are
**fallback-only**: the agent uses them only after normal search has failed to find the fact.

**Why managed scrapers instead of cracking the wall ourselves:** beating DataDome/Turnstile at
scale is an unsolved, expensive arms race. Delegating one hard site to a service that already
solves it (and runs on its own infrastructure, so our IP is never touched) is cheaper and more
reliable than trying to fetch it directly. Fallback-only keeps it from spending credits when a
free search would have answered.

## 10. Shaping the answer

Once the agent has gathered enough, a separate pass turns its free-text findings into the typed
schema. If that comes back empty, it re-asks once with a nudge.

**Why a separate structuring step:** forcing the agent to emit structured JSON *while* it
researches disables tool-calling — it would answer from memory instead of searching. Letting it
work in plain text first, then shaping the result, keeps the research honest. The one repair
retry is the difference between "usually works" and "reliable across thousands of rows."

## 11. What you get back

Every row returns the typed `result`, the `sources` it actually opened, an `agentLog` of every
step, exact `cost` broken down per provider, plus tokens, duration, and model.

**Why cite and itemise:** the output has to be *trustworthy and auditable* — you can see which
URLs backed each answer and exactly what the run cost, not a black-box guess.

## 12. The whole table

`runTable` runs many rows concurrently (a bounded worker pool), so a 500-row list isn't 500
sequential waits.

**Why bounded concurrency:** parallel for speed, capped so a big batch doesn't overwhelm the
search/fetch services or the model's rate limits.

---

The throughline: **do the cheap, free thing first; escalate only when it fails; never trust an
unvalidated answer; and always show your sources and cost.** Everything above is one of those
four principles applied to a specific step. Mechanism lives in `architecture.md`; the non-obvious
trade-offs live in `decisions.md`.
