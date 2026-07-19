# openclaygent

Openclaygent turns one research brief into typed, cited JSON for every row in a table.

Give it:

- instructions in plain English
- a prompt template populated from each row
- the required output schema
- one row or a CSV

It searches the live web, reads useful pages, and returns one structured result per row.

## Quick start

Install from a clean machine:

```bash
curl -fsSL https://raw.githubusercontent.com/simonbalfe/openclaygent/main/scripts/install.sh | bash
```

Already cloned:

```bash
bun run setup
```

Setup installs dependencies, links the `openclaygent` CLI, creates `.env`, and can start the
API, search, and browser services with Docker Compose.

`OPENROUTER_API_KEY` is required. Optional providers and actor overrides are listed in
`.env.example`.

## Run research

```bash
openclaygent \
  --instructions "Does this company offer a free trial? Check its pricing page." \
  --template "Company: {{company}}" \
  --schema '{"free_trial":"boolean","evidence_url":"string?"}' \
  --input company=Linear
```

The default output contains the schema-shaped result, a short explanation, and source URLs.

For a CSV:

```bash
openclaygent \
  --instructions "Identify the company industry." \
  --template "Company: {{company}}\nWebsite: {{domain}}" \
  --schema '{"industry":"string","confidence":"low|medium|high"}' \
  --rows companies.csv \
  --out results.json
```

## How it works

The CLI sends a validated request to `POST /run`. The API builds a reusable action and runs
the agent once for each row. Search and page extraction use cheapest-first provider ladders.
Each result includes its sources, trace, token use, and timing.

See `docs/architecture.md` for the runtime and provider flow. See `docs/decisions.md` for the
constraints and trade-offs behind it.

## Documentation

- `docs/usage-guide.md`: complete CLI and API examples, action files, schemas, and troubleshooting.
- `docs/architecture.md`: runtime flow, contracts, package boundaries, and file ownership.
- `docs/decisions.md`: design rationale and implementation constraints.
- `docs/roadmap.md`: remaining work and planned capabilities.

These documents are written for both humans and agents. A fact should have one canonical home;
other documents should link to it instead of copying it.

## Development

```bash
bun install
bun run typecheck
bun run knip
```

Run the API locally with `bun run api`. Run the live end-to-end test with
`bun run test:e2e` after setting `OPENROUTER_API_KEY`.

## Uninstall

```bash
~/openclaygent/scripts/uninstall.sh
```

The uninstall script confirms before removing the local stack, project images, CLI link, and
installation directory.
