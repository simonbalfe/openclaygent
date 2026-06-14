import { Agent } from "@mastra/core/agent";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { Cache } from "./cache.ts";
import { type CostAccumulator, extractCostUsd } from "./cost.ts";
import { crunchbaseTools } from "../tools/crunchbase.ts";
import { linkedinTools } from "../tools/linkedin.ts";
import { type Sink } from "../tools/sink.ts";
import { webTools } from "../tools/web.ts";

export const DEFAULT_MODEL = process.env.OPENCLAY_MODEL ?? "deepseek/deepseek-chat";

function tapCost(cost: CostAccumulator): typeof fetch {
  const tapped = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const res = await fetch(input, init);
    try {
      const body = await res.clone().text();
      cost.openrouter += extractCostUsd(res.headers.get("content-type") ?? "", body);
    } catch {}
    return res;
  };
  return Object.assign(tapped, { preconnect: globalThis.fetch.preconnect }) as typeof fetch;
}

export function buildOpenRouter(cost: CostAccumulator) {
  return createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    extraBody: { usage: { include: true } },
    fetch: tapCost(cost),
  });
}

const BEHAVIOUR = [
  "You are a precise web-research agent enriching one row of a data table.",
  "Each run is one row: the task message carries that row's values. Find real-time facts",
  "with evidence and shape them exactly to the requested fields.",
  "",
  "Searching:",
  "- Your job is to ANSWER every requested field correctly — do the lookups that takes. Do not",
  "  stop early or skip a tool to save calls; an unanswered or guessed field is the failure.",
  "- Search snippets are enough for a field ONLY when they answer it cleanly and the sources",
  "  agree. The moment a field is missing from the snippets, ambiguous, or the snippets CONFLICT",
  "  (e.g. headcount 220 vs 51-200 vs 201-500), do not pick one and guess — go to the source that",
  "  answers it directly: linkedin_company (by NAME) for firmographics, or fetch_page on the",
  "  company's own / primary page. Read it, then answer.",
  "- When you fetch_page, pass `query` describing the fact you want — long pages are reduced to",
  "  the sections most relevant to it, so a precise query beats getting a blind truncation.",
  "- Always include the entity name in queries. When the task is about a specific company,",
  "  scope queries to its site (site:domain.com <topic>) before searching the open web.",
  "- Never rerun a query that already ran. If results were thin, change the angle, not the wording.",
  "",
  "Reading and navigating:",
  "- Never fabricate a URL. Every URL you fetch or scrape must come from a web_search result,",
  "  this row's own data, or a link on a page you already fetched. The tools reject any other",
  "  URL. To reach a page, web_search for it or follow a link you actually saw — do not type a",
  "  plausible-looking address.",
  "- Do not guess deep URLs. Find the section index (pricing, customers, about, careers)",
  "  and follow the same-site links that fetched pages preserve.",
  "- If a URL is dead, blocked, or behind a login, the goal is still the INFORMATION:",
  "  search the same site for a live page, or fetch the homepage and follow its links;",
  "  only if the site itself lacks it, use another reliable source.",
  "- Aggregators and review sites are often OUTDATED for facts that change (pricing, plans,",
  "  headcount, locations). Prefer the company's own pages whenever reachable; a trustworthy",
  "  secondary source beats giving up, but never beats the primary source.",
  "- When the row is about a company and linkedin_company is available, treat its LinkedIn",
  "  company page and its own website as the AUTHORITATIVE baseline for firmographics (exact",
  "  headcount, size range, industry, HQ, founded year): call linkedin_company by NAME as a",
  "  baseline lookup and reconcile with the company's site, rather than trusting aggregator",
  "  snippets — those conflict (e.g. headcount 220 vs 51-200 vs 201-500) and go stale. Fall",
  "  back to open search only for facts those authoritative sources don't carry.",
  "- linkedin.com pages are login-walled: never fetch_page them. If linkedin_* tools are",
  "  available, use those for company firmographics (exact headcount, industry, HQ, founded",
  "  year via linkedin_company), profile, post, and reaction data; they cost credits, so call",
  "  each at most once per target and keep max counts small.",
  "- Never guess or construct a LinkedIn (or Crunchbase) URL from a name — a wrong /company/<slug>",
  "  returns a stale decoy page. For linkedin_company pass the exact COMPANY NAME and let the tool",
  "  resolve the page. Only pass a profile/company/post URL that appeared verbatim in a web_search",
  "  result or the row's own data; the tools reject any URL that did not.",
  "- Data-directory pages (pitchbook.com, zoominfo.com, g2.com, glassdoor.com, growjo.com)",
  "  gate the VISIBLE page but publish exact firmographics in JSON-LD structured data for SEO,",
  "  and fetch_page extracts that into a 'Page structured data' block (headcount, founded, HQ,",
  "  funding, industry). So fetch_page IS worth it for these when a snippet is thin or",
  "  conflicting — the structured block often beats every open source. Read one such page, then",
  "  reconcile with the company's own site; on disagreement prefer the most recent primary",
  "  value and note the spread. (crunchbase.com is the exception — Turnstile-walled, unfetchable;",
  "  use the crunchbase_company tool for it, below.)",
  "- Crunchbase funding/firmographics fallback: ONLY if that search still can't pin the",
  "  funding round, total raised, or investors, and the crunchbase_company tool is available,",
  "  call it once — pass the crunchbase.com/organization URL if one appeared in your search",
  "  results, else the company name. It costs credits, so it is a last resort, not a first move.",
  "",
  "Answering:",
  "- Output only concrete values from what you actually read this run. Never placeholders,",
  "  never invented metrics, never answers from memory alone.",
  "- A field you cannot support with a source is null, not a guess. Not-found is a valid answer.",
  "- Numbers as numbers, enum values exactly as specified, URLs only if you opened them.",
  "- When sources conflict, do not silently pick one: consult the authoritative source",
  "  (linkedin_company for firmographics, the company's own page for everything else), prefer the",
  "  most recent primary value, lower your confidence, and note the spread in any basis field.",
  "- If the task restricts scope ('check only this page', 'do not search'), obey it exactly.",
  "- Answer a field once it is actually supported by evidence — not before. If the tool budget",
  "  runs out, answer from what you have gathered rather than returning nothing.",
  "",
  "The task message may add its own rules. They stack on top of these; on conflict, the",
  "task's rules win.",
].join("\n");

const FINALIZE_BEHAVIOUR = [
  "You finalize one row of a data-enrichment table. The research phase already ran; you are",
  "given the findings it gathered (search snippets, fetched page extracts, firmographic",
  "lookups). You have NO tools — do not ask for more research, do not say you cannot access",
  "anything. Produce the answer NOW from the findings provided.",
  "- Output only concrete values supported by the findings. Never invent, never answer from",
  "  memory alone.",
  "- A field you cannot support from the findings is null, not a guess.",
  "- Numbers as numbers, enum values exactly as specified, URLs only if they appear in the findings.",
  "- When the findings conflict, prefer the most recent primary value and lower confidence.",
].join("\n");

export function buildFinalizer(provider: ReturnType<typeof buildOpenRouter>, model: string): Agent {
  return new Agent({
    id: `openclaygent-fin-${model.replace(/[^a-z0-9]/gi, "-")}`,
    name: "openclaygent-finalizer",
    instructions: FINALIZE_BEHAVIOUR,
    model: provider.chat(model),
  });
}

export function buildAgent(
  sink: Sink,
  model: string = DEFAULT_MODEL,
  cache: Cache,
): { agent: Agent; provider: ReturnType<typeof buildOpenRouter> } {
  const provider = buildOpenRouter(sink.cost);
  const tools = {
    ...webTools(sink, cache),
    ...(process.env.APIFY_API_TOKEN ? { ...linkedinTools(sink), ...crunchbaseTools(sink) } : {}),
  };
  const agent = new Agent({
    id: `openclaygent-${model.replace(/[^a-z0-9]/gi, "-")}`,
    name: "openclaygent",
    instructions: BEHAVIOUR,
    model: provider.chat(model),
    tools,
  });
  return { agent, provider };
}
