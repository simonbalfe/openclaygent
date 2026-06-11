import { Agent } from "@mastra/core/agent";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { webTools, type Sink } from "./tools/web.ts";

export const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY ?? "" });

export const DEFAULT_MODEL = process.env.OPENCLAY_MODEL ?? "deepseek/deepseek-chat";

const BEHAVIOUR = [
  "You are a precise web-research agent enriching one row of a data table.",
  "Loop: search the web, read pages only when snippets are not enough, then answer.",
  "",
  "Discipline:",
  "- Prefer search snippets. Only call fetch_page when you need a specific page's full text.",
  "- Keep it to ~3 tool calls. If evidence is thin, answer with lower confidence rather than searching forever.",
  "- Answer ONLY from what you actually read. Never guess or invent.",
  "- If a field cannot be supported by a source, set it to null.",
  "- Cite the exact URLs you used in any `sources` field.",
].join("\n");

export function buildAgent(sink: Sink, model: string = DEFAULT_MODEL): Agent {
  const { web_search, fetch_page } = webTools(sink);
  return new Agent({
    id: `openclaygent-${model.replace(/[^a-z0-9]/gi, "-")}`,
    name: "openclaygent",
    instructions: BEHAVIOUR,
    model: openrouter.chat(model),
    tools: { web_search, fetch_page },
  });
}
