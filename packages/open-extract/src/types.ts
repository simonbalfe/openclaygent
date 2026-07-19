export type ExtractProvider = "impit" | "patchright" | "patchright+proxy" | "patchright+solver" | "tavily";

export type ExtractOutcome = "ok" | "dead" | "failed";

export interface ExtractAttempt {
  provider: ExtractProvider;
  outcome: "ok" | "empty" | "blocked" | "http-error" | "error" | "skipped";
  durationMs: number;
  detail?: string;
}

export interface ExtractResult {
  url: string;
  content: string;
  contentType: "html" | "pdf" | "text" | "unknown";
  provider: ExtractProvider;
  outcome: ExtractOutcome;
  attempts: ExtractAttempt[];
}
