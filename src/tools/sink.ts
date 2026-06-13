import type { CostAccumulator } from "../core/cost.ts";
import type { AgentStep } from "../core/types.ts";

export interface Sink {
  sources: Set<string>;
  log: AgentStep[];
  onStep?: (step: AgentStep) => void;
  cost: CostAccumulator;
}

export function record(sink: Sink, step: AgentStep): void {
  sink.log.push(step);
  sink.onStep?.(step);
}

export function clip(text: string, max = 180): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
