#!/usr/bin/env bun
import { HELP, parseArgs } from "./cli/args.ts";
import { runRemote } from "./cli/client.ts";
import { buildRequestOptions, loadActionSpec, loadRows } from "./cli/input.ts";
import { printRow } from "./cli/render.ts";
import type { Row } from "./core/types.ts";

const { flags, inputs } = parseArgs(Bun.argv.slice(2));

if (flags.help || Bun.argv.length <= 2) {
  console.log(HELP);
  process.exit(0);
}

const spec = await loadActionSpec(flags);
const rows: Row[] = typeof flags.rows === "string" ? await loadRows(flags.rows) : [inputs];
const requestRows = rows.map((row) =>
  Object.fromEntries(
    Object.entries(row).filter(
      (entry): entry is [string, string | number | boolean | null] => entry[1] !== undefined,
    ),
  ),
);
const apiUrl =
  typeof flags["api-url"] === "string"
    ? flags["api-url"]
    : process.env.OPENCLAYGENT_API_URL ?? "http://localhost:8080";
let results;
try {
  results = await runRemote(apiUrl, { ...spec, rows: requestRows, ...buildRequestOptions(flags) });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (flags.json) {
  console.log(JSON.stringify(rows.length === 1 ? results[0] : results, null, 2));
} else if (flags.pretty) {
  rows.forEach((row, i) =>
    printRow(Object.values(row)[0]?.toString() ?? `row ${i + 1}`, results[i]!),
  );
  const totals = results.reduce(
    (acc, r) => ({
      input: acc.input + r.tokens.input,
      output: acc.output + r.tokens.output,
    }),
    { input: 0, output: 0 },
  );
  console.log(
    `\n${rows.length} rows · ${totals.input} in / ${totals.output} out tok · ${results[0]?.model}`,
  );
} else {
  results.forEach((r, i) => {
    if (r.error) console.error(`row ${i + 1} error: ${r.error}`);
  });
  const out = results.map((r) => ({ result: r.result, reasoning: r.reasoning, sources: r.sources }));
  console.log(JSON.stringify(rows.length === 1 ? out[0] : out, null, 2));
}

if (typeof flags.out === "string") {
  await Bun.write(flags.out, JSON.stringify(results, null, 2));
  console.log(`Wrote ${flags.out}`);
}
