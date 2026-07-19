export type SearchProvider = "searxng" | "exa" | "tavily";

export interface SearchHit {
  title: string;
  url: string;
  content: string;
}

export interface SearchAttempt {
  provider: SearchProvider;
  outcome: "ok" | "empty" | "error" | "skipped";
  durationMs: number;
  resultCount: number;
  detail?: string;
}

export interface SearchResult {
  query: string;
  results: SearchHit[];
  provider: SearchProvider;
  attempts: SearchAttempt[];
}

export interface SearchOptions {
  maxResults?: number;
}
