import { mkdir, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { z } from "zod";
import type { Action, Row, RunResult } from "./types.ts";

export interface RunLog<S extends z.ZodType> {
  recordedAt: string;
  action: {
    name: string;
    instructions: string;
    template: string;
    schema: Record<string, unknown>;
  };
  input: Row;
  run: RunResult<S>;
}

export function runLogPath(runId: string, directory = process.env.OPENCLAY_LOG_DIR): string {
  return join(resolve(directory?.trim() || "logs"), `${runId}.json`);
}

export async function writeRunLog<S extends z.ZodType>(
  action: Action<S>,
  row: Row,
  result: RunResult<S>,
): Promise<string> {
  const path = runLogPath(result.runId);
  const temporaryPath = `${path}.tmp`;
  const log: RunLog<S> = {
    recordedAt: new Date().toISOString(),
    action: {
      name: action.name,
      instructions: action.instructions,
      template: action.template,
      schema: action.schema,
    },
    input: row,
    run: result,
  };
  await mkdir(resolve(process.env.OPENCLAY_LOG_DIR?.trim() || "logs"), { recursive: true });
  await Bun.write(temporaryPath, `${JSON.stringify(log, null, 2)}\n`);
  await rename(temporaryPath, path);
  return path;
}
