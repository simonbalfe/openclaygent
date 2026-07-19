#!/usr/bin/env bun

import { search } from "./search.ts";

function usage(): never {
  console.error("Usage: open-search [--debug] [--max <1-8>] <query>");
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) usage();
const debug = args.includes("--debug");
const maxIndex = args.indexOf("--max");
const maxResults = maxIndex >= 0 ? Number(args[maxIndex + 1]) : undefined;
const positional = args.filter(
  (arg, index) => arg !== "--debug" && arg !== "--max" && (maxIndex < 0 || index !== maxIndex + 1),
);
if (!positional.length || (maxResults !== undefined && (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 8))) usage();
if (debug) process.env.OPEN_SEARCH_DEBUG = "1";

try {
  console.log(JSON.stringify(await search(positional.join(" "), { maxResults }), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
