# OpenClaygent usage guide

OpenClaygent runs one web-research brief against one row or a table of rows and returns
typed JSON with reasoning and source URLs.

## Check the installation

```bash
openclaygent --help
curl -s http://localhost:8080/health
```

The health endpoint should return:

```json
{"ok":true}
```

If the Docker services are stopped, start them from the installation directory:

```bash
cd ~/openclaygent
docker compose up -d --wait
```

## Research one company

This example checks whether Linear offers a free trial or free plan:

```bash
openclaygent \
  --instructions "Determine whether the company offers a free trial or free plan. Prefer the company's pricing page and cite the evidence." \
  --template "Company: {{company}}\nWebsite: {{domain}}" \
  --schema '{"offers_free_access":"boolean","access_type":"trial|free_plan|neither|unclear","evidence_url":"string?"}' \
  --input company=Linear \
  --input domain=linear.app \
  --pretty
```

The four important inputs are:

- `--instructions`: the research task and evidence requirements.
- `--template`: the row-specific prompt. `{{field}}` slots come from the input row.
- `--schema`: the exact output fields and types.
- `--input`: one field from the row. Repeat it for additional fields.

Remove `--pretty` when another program will consume the JSON.

## Choose an output mode

The default output contains the answer, short reasoning, and sources:

```bash
openclaygent \
  --instructions "Identify the company's primary industry." \
  --template "Company: {{company}} ({{domain}})" \
  --schema '{"industry":"string","confidence":"low|medium|high"}' \
  --input company=Linear \
  --input domain=linear.app
```

Use one of these modes when you need more detail:

```bash
# Human-readable result summary
openclaygent [action and row arguments] --pretty

# Full RunResult with tool log, tokens, and timings
openclaygent [action and row arguments] --json

# Save the full result while still printing to the terminal
openclaygent [action and row arguments] --out result.json
```

`[action and row arguments]` is shorthand in the examples above. Replace it with real
`--instructions`, `--template`, `--schema`, and input arguments.

## Research a CSV in batches

Create `companies.csv`:

```csv
company,domain
Linear,linear.app
Notion,notion.so
Figma,figma.com
```

Run the same action for every row:

```bash
openclaygent \
  --instructions "Identify the company's primary industry from reliable web evidence." \
  --template "Company: {{company}}\nWebsite: {{domain}}" \
  --schema '{"industry":"string","confidence":"low|medium|high"}' \
  --require domain \
  --rows companies.csv \
  --concurrency 3 \
  --out enriched-companies.json
```

`--require domain` skips rows with an empty domain before spending model tokens. Results
remain in input order even though rows run concurrently.

The CLI parses the CSV into `rows: HttpRow[]` and submits that array in the JSON body sent
to `POST /run`. Programmatic clients can send the same JSON contract directly.

## Reuse an action file

For a repeated workflow, put the research definition in `free-access-action.json`:

```json
{
  "name": "free_access_check",
  "instructions": "Determine whether the company offers a free trial or free plan. Prefer first-party pricing evidence.",
  "template": "Company: {{company}}\nWebsite: {{domain}}",
  "schema": {
    "offers_free_access": "boolean",
    "access_type": "trial|free_plan|neither|unclear",
    "evidence_url": "string?"
  }
}
```

Run it against one row:

```bash
openclaygent \
  --action free-access-action.json \
  --input company=Linear \
  --input domain=linear.app \
  --pretty
```

Or against a table:

```bash
openclaygent \
  --action free-access-action.json \
  --rows companies.csv \
  --require domain \
  --out free-access-results.json
```

## Use a full JSON Schema

The short schema format is convenient for flat results. Use standard JSON Schema for
nested objects, arrays, constraints, or richer descriptions:

```bash
openclaygent \
  --instructions "Find up to three products sold by this company." \
  --template "Company: {{company}}\nWebsite: {{domain}}" \
  --schema '{
    "type": "object",
    "properties": {
      "products": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "name": {"type": "string"},
            "url": {"type": "string"}
          },
          "required": ["name", "url"]
        },
        "maxItems": 3
      }
    },
    "required": ["products"]
  }' \
  --input company=Linear \
  --input domain=linear.app
```

## Call the HTTP API

The Docker installation exposes the API at `http://localhost:8080`. Interactive API
documentation is available at `http://localhost:8080/docs`.

```bash
curl -s http://localhost:8080/run \
  -H 'content-type: application/json' \
  -d '{
    "instructions": "Identify the company primary industry.",
    "template": "Company: {{company}} ({{domain}})",
    "schema": {
      "industry": "string",
      "confidence": "low|medium|high"
    },
    "rows": [
      {"company": "Linear", "domain": "linear.app"},
      {"company": "Notion", "domain": "notion.so"}
    ],
    "concurrency": 2,
    "maxSteps": 5
  }' | jq
```

Use `input` instead of `rows` for one row:

```json
"input": {"company": "Linear", "domain": "linear.app"}
```

## Control speed and depth

- `--max-steps 3` limits how many research steps the agent can take. Lower values are
  faster and cheaper but can reduce coverage.
- `--concurrency 5` controls simultaneous rows. Reduce it if providers rate-limit the run.
- `--model <openrouter-model-id>` overrides the configured model for one run.
- Set `OPENCLAY_DEBUG=1` in `.env` and restart the API to print API adapter and timing traces.
  Use each standalone package CLI's `--debug` flag for its full provider ladder diagnostics.
- Every row run writes one JSON trace to `logs/<runId>.json`. Set `OPENCLAY_LOG_DIR` to use
  another directory. Each file contains the instructions, template, original schema object, input row, result, sources,
  tokens, and agent steps.

Example run with an explicit model:

```bash
openclaygent \
  --action free-access-action.json \
  --rows companies.csv \
  --max-steps 3 \
  --model google/gemini-3.1-flash-lite \
  --out results.json
```

## Troubleshooting

### Command not found

From the installation directory:

```bash
cd ~/openclaygent
bun link
```

Then open a new terminal and run `openclaygent --help`.

### API is unavailable

```bash
cd ~/openclaygent
docker compose ps
docker compose up -d --wait
curl -s http://localhost:8080/health
```

### A row is skipped

A `--require` field was absent or empty. Check the CSV header and the affected row.

### A result is null

Run again with `--json` to inspect the provider trail and full result envelope.
Try increasing `--max-steps` or using a stronger OpenRouter model.

### A template field is missing

Every `{{field}}` in the template must match an `--input` name or a column in the CSV.
Missing values appear as `[MISSING:field]` in the research prompt.
