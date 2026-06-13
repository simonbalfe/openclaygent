import type { z } from "zod";

export type Row = Record<string, string | number | boolean | null | undefined>;

export interface Action<S extends z.ZodType> {
  name: string;
  instructions: string;
  template: string;
  output: S;
  conditionalRun?: (row: Row) => boolean;
}

interface StepResult {
  title?: string;
  url?: string;
  chars?: number;
  preview?: string;
  via?: string;
}

export interface AgentStep {
  type: "search" | "fetch" | "linkedin" | "answer";
  query?: string;
  urls?: string[];
  via?: string;
  resultCount?: number;
  results?: StepResult[];
}

export interface RunResult<S extends z.ZodType> {
  result: z.infer<S> | null;
  sources: string[];
  agentLog: AgentStep[];
  tokens: { input: number; output: number };
  durationMs: number;
  model: string;
  skipped?: boolean;
}

export function defineAction<S extends z.ZodType>(a: Action<S>): Action<S> {
  return a;
}
