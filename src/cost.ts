export interface CostAccumulator {
  openrouter: number;
  exa: number;
  apify: number;
  tavilyCredits: number;
}

export function emptyCost(): CostAccumulator {
  return { openrouter: 0, exa: 0, apify: 0, tavilyCredits: 0 };
}

const TAVILY_USD_PER_CREDIT = Number(process.env.TAVILY_USD_PER_CREDIT ?? "0.008");

export function tavilyUsd(credits: number): number {
  return credits * TAVILY_USD_PER_CREDIT;
}

export function extractCostUsd(contentType: string, body: string): number {
  if (contentType.includes("event-stream")) {
    const matches = [...body.matchAll(/"cost":\s*([0-9.eE+-]+)/g)];
    const last = matches[matches.length - 1];
    return last ? Number(last[1]) : 0;
  }
  try {
    const parsed = JSON.parse(body) as { usage?: { cost?: number } };
    return parsed.usage?.cost ?? 0;
  } catch {
    return 0;
  }
}
