import { z } from "zod";
import { convertJsonSchemaToZod } from "zod-from-json-schema";

const PRIMS: Record<string, () => z.ZodTypeAny> = {
  string: () => z.string(),
  number: () => z.number(),
  boolean: () => z.boolean(),
};

function parseSpec(spec: string): { parts: string[]; nullable: boolean } {
  let s = spec.trim();
  let nullable = s.endsWith("?");
  if (nullable) s = s.slice(0, -1).trim();

  const parts = s.split("|").map((p) => p.trim()).filter(Boolean);
  if (parts.includes("null")) {
    return { parts: parts.filter((p) => p !== "null"), nullable: true };
  }
  return { parts, nullable };
}

function enumType(values: string[]): z.ZodTypeAny {
  const [first, ...rest] = values;
  return first ? z.enum([first, ...rest]) : z.string();
}

function baseType(parts: string[]): z.ZodTypeAny {
  if (parts.length >= 2) return enumType(parts);

  const token = (parts[0] ?? "string").toLowerCase();
  if (token.startsWith("enum:")) {
    return enumType(token.slice(5).split(",").map((part) => part.trim()));
  }
  return PRIMS[token]?.() ?? z.string();
}

function fieldToZod(spec: unknown): z.ZodTypeAny {
  if (Array.isArray(spec)) return enumType(spec.map(String));
  const { parts, nullable } = parseSpec(String(spec));
  const base = baseType(parts);
  return nullable ? base.nullable() : base;
}

function jsonToZod(shape: Record<string, unknown>): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const out: Record<string, z.ZodTypeAny> = {};
  for (const [key, spec] of Object.entries(shape)) out[key] = fieldToZod(spec);
  return z.object(out);
}

function isJsonSchema(shape: Record<string, unknown>): boolean {
  return shape.type === "object" || "properties" in shape || "$schema" in shape;
}

export function buildSchema(shape: Record<string, unknown>): z.ZodType {
  return isJsonSchema(shape) ? convertJsonSchemaToZod(shape) : jsonToZod(shape);
}
