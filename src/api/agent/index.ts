import { Agent } from "@mastra/core/agent";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { FINALIZER_SYSTEM_PROMPT, RESEARCH_SYSTEM_PROMPT } from "./prompts.ts";
import type { RunContext } from "./sink.ts";
import { crunchbaseTools } from "./tools/crunchbase.ts";
import { linkedinTools } from "./tools/linkedin/index.ts";
import { webTools } from "./tools/web.ts";

export const DEFAULT_MODEL = process.env.OPENCLAY_MODEL ?? "google/gemini-3.1-flash-lite";

export function buildOpenRouter() {
  return createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
  });
}

export function buildFinalizer(provider: ReturnType<typeof buildOpenRouter>, model: string): Agent {
  return new Agent({
    id: `openclaygent-fin-${model.replace(/[^a-z0-9]/gi, "-")}`,
    name: "openclaygent-finalizer",
    instructions: FINALIZER_SYSTEM_PROMPT,
    model: provider.chat(model),
  });
}

function buildTools(context: RunContext) {
  const web = webTools(context);
  if (!process.env.APIFY_API_TOKEN) return web;

  return {
    ...web,
    ...linkedinTools(context),
    ...crunchbaseTools(context),
  };
}

export function buildAgent(
  context: RunContext,
  model: string = DEFAULT_MODEL,
): { agent: Agent; provider: ReturnType<typeof buildOpenRouter> } {
  const provider = buildOpenRouter();
  const agent = new Agent({
    id: `openclaygent-${model.replace(/[^a-z0-9]/gi, "-")}`,
    name: "openclaygent",
    instructions: RESEARCH_SYSTEM_PROMPT,
    model: provider.chat(model),
    tools: buildTools(context),
  });
  return { agent, provider };
}
