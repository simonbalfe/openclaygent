#!/usr/bin/env bun
import { HELP, parseArgs } from "./args.ts";
import { runRemote } from "./client.ts";
import {
  buildRequestOptions,
  loadActionSpec,
  loadInputRows,
  prepareRows,
  resolveApiUrl,
} from "./input.ts";
import { renderResults } from "./render.ts";

async function main(): Promise<void> {
  const { flags, inputs } = parseArgs(Bun.argv.slice(2));
  if (flags.help || Bun.argv.length <= 2) {
    console.log(HELP);
    return;
  }

  const rows = await loadInputRows(flags, inputs);
  const action = await loadActionSpec(flags);
  const request = {
    ...action,
    ...buildRequestOptions(flags),
    rows: prepareRows(rows),
  };
  const results = await runRemote(resolveApiUrl(flags), request);

  renderResults(rows, results, flags);
  if (flags.out) {
    await Bun.write(flags.out, JSON.stringify(results, null, 2));
    console.log(`Wrote ${flags.out}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
