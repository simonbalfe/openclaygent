import { ErrorResponseSchema, RunResponseSchema, type HttpRunResult, type RunRequest } from "../api/http.ts";

export async function runRemote(apiUrl: string, request: RunRequest): Promise<HttpRunResult[]> {
  const endpoint = new URL("/run", apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot reach Openclaygent API at ${endpoint.origin}: ${detail}`);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = ErrorResponseSchema.safeParse(payload);
    throw new Error(parsed.success ? parsed.data.error : `Openclaygent API returned HTTP ${response.status}`);
  }
  return RunResponseSchema.parse(payload).results;
}
