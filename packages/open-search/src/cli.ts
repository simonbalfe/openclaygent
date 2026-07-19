#!/usr/bin/env bun

import { z } from "zod";
import { search } from "./search.ts";

const MaxResultsSchema = z.coerce.number().int().min(1).max(8);

function usage(): never {
  console.error("Usage: open-search [--debug] [--max <1-8>] <query>");
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) usage();
const debug = args.includes("--debug");
const maxIndex = args.indexOf("--max");
const parsedMax = maxIndex >= 0 ? MaxResultsSchema.safeParse(args[maxIndex + 1]) : null;
const maxResults = parsedMax?.success ? parsedMax.data : undefined;
const positional = args.filter(
  (arg, index) => arg !== "--debug" && arg !== "--max" && (maxIndex < 0 || index !== maxIndex + 1),
);
if (!positional.length || (parsedMax && !parsedMax.success)) usage();
if (debug) process.env.OPEN_SEARCH_DEBUG = "1";

try {
  console.log(JSON.stringify(await search(positional.join(" "), { maxResults }), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
