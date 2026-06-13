# openclaygent

A little web-research agent you hand a question and a table — it reads the live web for every
row and hands back clean, **cited JSON**.

It's the open-source take on Clay's Claygent, built to be driven from **Claude Code** (or any
coding agent). Ask it the niche facts no data vendor sells — "does this company offer a free
trial?", "what CRM do they use?", "how many open engineering roles?" — and get a typed answer
with the sources to back it, one per row.

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

## Setup

```bash
bun install
cp .env.example .env    # add OPENROUTER_API_KEY and EXA_API_KEY
```

That's it. One OpenRouter key drives any model — DeepSeek by default (cheap), swap to
Claude / GPT / Llama per run.

## Use it from Claude Code

This is what it's for: a research primitive your coding agent reaches for instead of doing the
digging inline. Hand it a brief and a row, read back clean JSON, act on it — the 500 rows of
search-and-fetch noise never touch your conversation.

```bash
bun run cli -- --json \
  --instructions "Does this company offer a free trial? Check their pricing page." \
  --template "Company: {{company}}" \
  --schema '{"free_trial":"boolean","evidence_url":"string?"}' \
  --input company=Linear
# → { "result": { "free_trial": true, "evidence_url": "https://linear.app/pricing" },
#     "sources": [...], "cost": {...}, "model": "deepseek/deepseek-chat" }
```

`--json` prints a clean result to stdout (warnings go to stderr), so it pipes straight into
whatever you're building. Batch a list with `--rows leads.csv --out enriched.json`, and skip
rows that don't qualify with `--require domain` before a token is spent. Full flags:
`bun run cli -- --help`.

## Also an HTTP API

Prefer to call it over the wire? `bun run api` serves the same engine at `POST /run`, with
interactive docs at `/docs`. See `docs/architecture.md` (HTTP API).

## Docs

- `docs/architecture.md` — how it works: the action, the loop, the contract, the file map.
- `docs/decisions.md` — the non-obvious choices and the conventions that bite.
- `docs/roadmap.md` — what's shipped and what's next.
