# How it works — the core flow

The plain-language tour: what happens on a run, and why each step is built that way.
Mechanism lives in `architecture.md`, sharp edges in `decisions.md`.

The core is three things: an **agent loop** that decides what to do next, a **search
ladder** to find sources, and a **fetch ladder** to read them. Everything else exists to
make that loop cheap, typed, and auditable. In: a brief, a filled-in prompt, an output
schema. Out: validated JSON plus the sources actually read. A table just repeats the flow
per row, concurrently.

## 1. In: brief + schema → typed action

The CLI and the HTTP API both reduce your input to instructions, a `{{templated}}` prompt,
and an output schema (`{"crm":"string?","confidence":"low|medium|high"}`) that becomes a
real validation schema.

**Why typed:** every answer is validated — right type, legal enum, nullable where allowed —
instead of silently wrong. **Why two entry points over one core:** scripts shell out,
services POST; both are thin adapters over `core/`, so there's no duplicate logic to drift.
(`--require domain` skips a row before anything is spent.)

## 2. The agent loop

A fresh agent reasons about what it needs, calls a tool, reads the result, and repeats
until it can answer or hits its step budget.

**Why an agent, not a fixed scrape:** every site is different; a fixed "fetch X, read Y"
pipeline breaks constantly. An agent decides what to search, what to read, and when it has
enough.

## 3. Search — cheapest rung first

`web_search`: self-hosted **SearXNG** (free) → **Exa** → **Tavily**. Falls through only on
empty; an unset key is a skipped rung.

**Why:** free search handles the bulk; you pay only when it genuinely misses. The agent
prefers snippets and opens a full page only when it must — fewer fetches, fewer tokens.

## 4. Fetch — escalate only when blocked

`fetch_page`: **impit** (HTTP with a browser fingerprint, free) → **patchright** (stealth
browser, free) → **+ residential proxy** → **+ Turnstile solver** → **Tavily extract**
(paid).

**Why:** most pages come back on the free first rung; the expensive rungs fire only for
pages that block a plain request. Walled aggregators (Crunchbase, G2, LinkedIn) are never
fetched — they hard-block bots, and their facts are mirrored across open sources, so the
agent searches for the fact instead of fighting the wall.

## 5. Page → clean text

Fetched HTML becomes markdown: **Readability** for articles, a **density prune** for
everything else (pricing pages, docs, tables), plus a structured-data block from the page's
JSON-LD. PDFs are parsed separately. Pages still too long aren't truncated — chunks are
BM25-scored against what the agent said it's looking for, and the most relevant ones are
kept.

**Why:** Readability drops tables; the prune keeps dense content — together they cover
both. Ranking beats truncation because the first N characters might not contain the
answer.

## 6. Walled-site fallbacks

`linkedin_*` and `crunchbase_company` delegate the permanently-walled sites to specialist
scrapers. Fallback-only: used after search has failed to pin the fact.

**Why delegate:** beating DataDome/Turnstile at scale is an arms race; paying a service
that already solves one hard site is cheaper and more reliable. Fallback-only keeps credits
unspent when a free search would have answered.

## 7. Shaping the answer

A structuring pass turns the agent's findings into the typed schema. If it comes back empty
(a thorough model can spend its whole step budget searching), a tools-disabled finalizer is
handed the gathered findings and must produce the schema from those alone.

**Why separate:** forcing structured JSON *during* research disables tool-calling — the
model would answer from memory. Research in plain text, shape after. The finalizer is what
makes thousands of rows reliable, not just "usually works". See `decisions.md`
(Finalization fallback).

## 8. What you get back

The typed `result`, the `sources` actually opened, an `agentLog` of every step (with each
ladder's rung-by-rung `trail`), exact per-provider `cost`, tokens, duration, model.

For more, `OPENCLAY_DEBUG=1` traces every layer to stderr: per-rung timings, swallowed
errors, extractor fallthroughs, cache hits, Apify status, per-LLM-call cost. Silent and
free when unset.

## 9. Many at once

`runTable` runs rows through a bounded worker pool sharing one result cache — 500 rows
aren't sequential, and two rows needing the same page fetch it once.

---

The throughline: **do the cheap thing first, escalate only on failure, never trust an
unvalidated answer, always show sources and cost.**
