#!/usr/bin/env bun

import { extract } from "./extract.ts";

function usage(): never {
  console.error("Usage: open-extract [--debug] <url>");
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) usage();
const debug = args.includes("--debug");
const positional = args.filter((arg) => arg !== "--debug");
if (positional.length !== 1) usage();
if (debug) process.env.OPEN_EXTRACT_DEBUG = "1";

try {
  const result = await extract(positional[0] ?? "");
  console.log(JSON.stringify(result, null, 2));
  if (result.outcome !== "ok") process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
