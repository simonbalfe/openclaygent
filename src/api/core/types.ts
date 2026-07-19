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
  trail?: string[];
}

interface SearchStep {
  type: "search";
  query: string;
  via: string;
  resultCount: number;
  results: StepResult[];
  trail: string[];
}

interface FetchStep {
  type: "fetch";
  urls: string[];
  resultCount: number;
  results: StepResult[];
}

interface ProviderStep {
  type: "linkedin" | "crunchbase";
  query: string;
  resultCount: number;
  results: StepResult[];
}

interface AnswerStep {
  type: "answer";
}

export type AgentStep = SearchStep | FetchStep | ProviderStep | AnswerStep;
export type ToolStepType = ProviderStep["type"];

export interface Evidence {
  tool: "search" | "fetch" | "linkedin" | "crunchbase";
  url: string;
  text: string;
  via?: string;
}

export interface RunResult<S extends z.ZodType> {
  runId: string;
  result: z.infer<S> | null;
  reasoning: string | null;
  sources: string[];
  agentLog: AgentStep[];
  tokens: { input: number; output: number };
  durationMs: number;
  model: string;
  skipped?: boolean;
  error?: string;
}

export function defineAction<S extends z.ZodType>(a: Action<S>): Action<S> {
  return a;
}
