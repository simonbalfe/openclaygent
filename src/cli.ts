#!/usr/bin/env bun
import { HELP, parseArgs } from "./cli/args.ts";
import { buildOptions, loadActionSpec, loadRows } from "./cli/input.ts";
import { money, printRow } from "./cli/render.ts";
import { buildAction } from "./core/action.ts";
import { runTable } from "./core/engine.ts";
import type { Row } from "./core/types.ts";

const { flags, inputs } = parseArgs(Bun.argv.slice(2));

if (flags.help || Bun.argv.length <= 2) {
  console.log(HELP);
  process.exit(0);
}

const spec = await loadActionSpec(flags);
const requireField = typeof flags.require === "string" ? flags.require : undefined;
const action = buildAction(spec, { requireField });

const rows: Row[] = typeof flags.rows === "string" ? await loadRows(flags.rows) : [inputs];
const results = await runTable(action, rows, buildOptions(flags));

if (flags.json) {
  console.log(JSON.stringify(rows.length === 1 ? results[0] : results, null, 2));
} else {
  rows.forEach((row, i) =>
    printRow(Object.values(row)[0]?.toString() ?? `row ${i + 1}`, results[i]!, false),
  );
  const totals = results.reduce(
    (acc, r) => ({
      input: acc.input + r.tokens.input,
      output: acc.output + r.tokens.output,
      cost: acc.cost + r.cost.total,
    }),
    { input: 0, output: 0, cost: 0 },
  );
  console.log(
    `\n${rows.length} rows · ${money(totals.cost)} · ${totals.input} in / ${totals.output} out tok · ${results[0]?.model}`,
  );
}

if (typeof flags.out === "string") {
  await Bun.write(flags.out, JSON.stringify(results, null, 2));
  console.log(`Wrote ${flags.out}`);
}
