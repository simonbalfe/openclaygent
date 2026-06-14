import type { Cache } from "../core/cache.ts";
import { fetchPageTool } from "./fetch.ts";
import { webSearchTool } from "./search.ts";
import type { Sink } from "./sink.ts";

export function webTools(sink: Sink, cache: Cache) {
  return { web_search: webSearchTool(sink, cache), fetch_page: fetchPageTool(sink, cache) };
}
