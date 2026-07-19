import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { runActor } from "../src/index.ts";
import type { ApifyFetch } from "../src/index.ts";

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

describe("runActor", () => {
  const itemSchema = z.object({ name: z.string() });

  test("starts, polls, and reads an actor dataset", async () => {
    const urls: string[] = [];
    const responses = [
      json({ data: { id: "run-1", status: "RUNNING", defaultDatasetId: "dataset-1" } }),
      json({ data: { id: "run-1", status: "SUCCEEDED", defaultDatasetId: "dataset-1" } }),
      json([{ name: "Linear" }]),
    ];
    const fetcher: ApifyFetch = async (input) => {
      urls.push(String(input));
      return responses.shift() ?? json({}, 500);
    };

    const result = await runActor({
      actor: "example~actor",
      input: { query: "Linear" },
      itemSchema,
      token: "secret",
      fetch: fetcher,
    });

    expect(result.items).toEqual([{ name: "Linear" }]);
    expect(result.status).toBe("SUCCEEDED");
    expect(urls.map((url) => new URL(url).pathname)).toEqual([
      "/v2/acts/example~actor/runs",
      "/v2/actor-runs/run-1",
      "/v2/datasets/dataset-1/items",
    ]);
  });

  test("reports start failures with bounded response text", async () => {
    const fetcher: ApifyFetch = async () => new Response("denied", { status: 403 });
    await expect(
      runActor({ actor: "example~actor", input: {}, itemSchema, token: "secret", fetch: fetcher }),
    ).rejects.toThrow("Apify example~actor 403: denied");
  });

  test("rejects malformed run responses", async () => {
    const fetcher: ApifyFetch = async () => json({ data: { id: "run-1", status: "RUNNING" } });
    await expect(
      runActor({ actor: "example~actor", input: {}, itemSchema, token: "secret", fetch: fetcher }),
    ).rejects.toThrow("Apify returned an invalid run response");
  });

  test("rejects malformed dataset items", async () => {
    const responses = [
      json({ data: { id: "run-1", status: "SUCCEEDED", defaultDatasetId: "dataset-1" } }),
      json([{ name: 42 }]),
    ];
    const fetcher: ApifyFetch = async () => responses.shift() ?? json({}, 500);
    await expect(
      runActor({ actor: "example~actor", input: {}, itemSchema, token: "secret", fetch: fetcher }),
    ).rejects.toThrow("Apify example~actor returned an invalid dataset");
  });

  test("times out active runs", async () => {
    const fetcher: ApifyFetch = async () =>
      json({ data: { id: "run-1", status: "RUNNING", defaultDatasetId: "dataset-1" } });
    await expect(
      runActor({ actor: "example~actor", input: {}, itemSchema, token: "secret", timeoutMs: -1, fetch: fetcher }),
    ).rejects.toThrow("Apify example~actor timed out (run run-1)");
  });
});
