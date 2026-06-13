import { fetchPageTool } from "./fetch.ts";
import { webSearchTool } from "./search.ts";
import type { Sink } from "./sink.ts";

export function webTools(sink: Sink) {
  return { web_search: webSearchTool(sink), fetch_page: fetchPageTool(sink) };
}
