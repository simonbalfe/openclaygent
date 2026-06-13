import { tavily } from "@tavily/core";
import Exa from "exa-js";
import { Impit } from "impit";

export const impit = new Impit({ browser: "chrome", timeout: 15000 });

let exaClientInstance: Exa | null = null;
export function exaClient(): Exa | null {
  const key = process.env.EXA_API_KEY;
  if (!key) return null;
  if (!exaClientInstance) exaClientInstance = new Exa(key);
  return exaClientInstance;
}

let tavilyClientInstance: ReturnType<typeof tavily> | null = null;
export function tavilyClient(): ReturnType<typeof tavily> | null {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return null;
  if (!tavilyClientInstance) tavilyClientInstance = tavily({ apiKey: key });
  return tavilyClientInstance;
}
