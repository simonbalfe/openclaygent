import { z } from "zod";
import { convertJsonSchemaToZod } from "zod-from-json-schema";

const PRIMS: Record<string, () => z.ZodTypeAny> = {
  string: () => z.string(),
  number: () => z.number(),
  boolean: () => z.boolean(),
};

function fieldToZod(spec: unknown): z.ZodTypeAny {
  if (Array.isArray(spec)) return z.enum(spec.map(String) as [string, ...string[]]);

  let s = String(spec).trim();
  let nullable = false;
  if (s.endsWith("?")) {
    nullable = true;
    s = s.slice(0, -1).trim();
  }

  let parts = s.split("|").map((p) => p.trim()).filter(Boolean);
  if (parts.includes("null")) {
    nullable = true;
    parts = parts.filter((p) => p !== "null");
  }

  let base: z.ZodTypeAny;
  if (parts.length >= 2) {
    base = z.enum(parts as [string, ...string[]]);
  } else {
    const p = (parts[0] ?? "string").toLowerCase();
    if (p.startsWith("enum:")) {
      base = z.enum(p.slice(5).split(",").map((x) => x.trim()) as [string, ...string[]]);
    } else {
      base = PRIMS[p]?.() ?? z.string();
    }
  }

  return nullable ? base.nullable() : base;
}

function jsonToZod(shape: Record<string, unknown>): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const out: Record<string, z.ZodTypeAny> = {};
  for (const [k, v] of Object.entries(shape)) out[k] = fieldToZod(v);
  return z.object(out);
}

function isJsonSchema(o: Record<string, unknown>): boolean {
  return o.type === "object" || "properties" in o || "$schema" in o;
}

export function buildSchema(shape: Record<string, unknown>): z.ZodType {
  return isJsonSchema(shape) ? convertJsonSchemaToZod(shape) : jsonToZod(shape);
}
