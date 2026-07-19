import { fetchPageTool } from "./fetch.ts";
import { webSearchTool } from "./search.ts";
import type { RunContext } from "./sink.ts";

export function webTools(context: RunContext) {
  return { web_search: webSearchTool(context), fetch_page: fetchPageTool(context) };
}
