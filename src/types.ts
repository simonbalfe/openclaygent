import type { z } from "zod";

/** A row of input data, e.g. { company_name: "Clay", domain: "clay.com" }. */
export type Row = Record<string, string | number | boolean | null | undefined>;

/**
 * One Claygent "action" — the unit Clay's catalog calls a use-ai action.
 * It is a reusable research brief: instructions + a templated user prompt +
 * the shape of the answer. Run it against any row.
 */
export interface Action<S extends z.ZodType> {
  /** Stable id, e.g. "find_company". */
  name: string;
  /** System instructions: the persona + the task. */
  instructions: string;
  /** User prompt with {{field}} slots filled from the row. */
  template: string;
  /** Zod schema the final answer must match (the "submit_answer" shape). */
  output: S;
  /**
   * Optional skip expression. Receives the row; return false to skip the row
   * entirely (Clay's "Conditional Run" — the #1 credit saver).
   */
  conditionalRun?: (row: Row) => boolean;
}

/** Everything that happened during one run — Ferret-style replay log. */
export interface AgentStep {
  type: "search" | "fetch" | "answer";
  query?: string;
  urls?: string[];
  resultCount?: number;
}

/** The frozen contract: what every run returns. */
export interface RunResult<S extends z.ZodType> {
  /** Structured answer matching the action's schema (null if the row was skipped). */
  result: z.infer<S> | null;
  /** URLs the agent actually touched. */
  sources: string[];
  /** Ordered log of every tool call. */
  agentLog: AgentStep[];
  /** Token usage for cost accounting. */
  tokens: { input: number; output: number };
  durationMs: number;
  model: string;
  /** Set when conditionalRun returned false. */
  skipped?: boolean;
}

/** Helper for type-inference when declaring an action. */
export function defineAction<S extends z.ZodType>(a: Action<S>): Action<S> {
  return a;
}
