import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { runLogPath, writeRunLog, type RunLog } from "../src/api/core/run-log.ts";
import { defineAction, type RunResult } from "../src/api/core/types.ts";

let directory = "";

afterEach(async () => {
  delete process.env.OPENCLAY_LOG_DIR;
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("writes one JSON file for a run", async () => {
  directory = await mkdtemp(join(tmpdir(), "openclaygent-log-"));
  process.env.OPENCLAY_LOG_DIR = directory;
  const action = defineAction({
    name: "company_check",
    instructions: "Research the company.",
    template: "Company: {{company}}",
    schema: { company: "string" },
    output: z.object({ company: z.string() }),
  });
  const result: RunResult<typeof action.output> = {
    runId: "run-123",
    result: { company: "Linear" },
    reasoning: "Confirmed by the company website.",
    sources: ["https://linear.app"],
    agentLog: [{ type: "answer" }],
    tokens: { input: 10, output: 5 },
    durationMs: 100,
    model: "test-model",
  };

  const path = await writeRunLog(action, { company: "Linear" }, result);
  const log = JSON.parse(await readFile(path, "utf8")) as RunLog<typeof action.output>;

  expect(path).toBe(runLogPath(result.runId));
  expect(log.action).toEqual({
    name: "company_check",
    instructions: "Research the company.",
    template: "Company: {{company}}",
    schema: { company: "string" },
  });
  expect(log.input).toEqual({ company: "Linear" });
  expect(log.run).toEqual(result);
});
