import { expect, test } from "bun:test";
import { buildSchema } from "../src/schema.ts";

test("short form: primitives, enum, nullable", () => {
  const s = buildSchema({ industry: "string", confidence: "low|medium|high", note: "string?" });
  expect(s.parse({ industry: "SaaS", confidence: "high", note: null })).toEqual({
    industry: "SaaS",
    confidence: "high",
    note: null,
  });
});

test("short form: rejects a value outside the enum", () => {
  const s = buildSchema({ confidence: "low|medium|high" });
  expect(() => s.parse({ confidence: "nope" })).toThrow();
});

test("short form: boolean and number", () => {
  const s = buildSchema({ paid: "boolean", seats: "number" });
  expect(s.parse({ paid: true, seats: 12 })).toEqual({ paid: true, seats: 12 });
  expect(() => s.parse({ paid: "yes", seats: 12 })).toThrow();
});

test("JSON Schema: routed to the standard converter", () => {
  const s = buildSchema({
    type: "object",
    properties: { industry: { type: "string" }, confidence: { type: "string", enum: ["low", "medium", "high"] } },
    required: ["industry", "confidence"],
  });
  expect(s.parse({ industry: "Fintech", confidence: "high" })).toEqual({ industry: "Fintech", confidence: "high" });
});

test("JSON Schema: rejects a missing required field", () => {
  const s = buildSchema({
    type: "object",
    properties: { industry: { type: "string" } },
    required: ["industry"],
  });
  expect(() => s.parse({})).toThrow();
});
