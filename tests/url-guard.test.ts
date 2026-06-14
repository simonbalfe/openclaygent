import { expect, test } from "bun:test";
import { emptyCost } from "../src/core/cost.ts";
import {
  assertVerifiedUrl,
  isVerifiedUrl,
  noteUrl,
  noteUrlsInText,
  type Sink,
} from "../src/tools/sink.ts";

function makeSink(): Sink {
  return { sources: new Set(), seen: new Set(), log: [], cost: emptyCost() };
}

test("a constructed URL is not verified", () => {
  const sink = makeSink();
  expect(isVerifiedUrl(sink, "https://www.linkedin.com/company/hugging-face")).toBe(false);
  expect(() => assertVerifiedUrl(sink, "https://www.linkedin.com/company/hugging-face", "")).toThrow();
});

test("a noted URL is verified regardless of www and trailing slash", () => {
  const sink = makeSink();
  noteUrl(sink, "https://www.linkedin.com/company/huggingface/");
  expect(isVerifiedUrl(sink, "https://linkedin.com/company/huggingface")).toBe(true);
  expect(() => assertVerifiedUrl(sink, "http://www.linkedin.com/company/huggingface", "")).not.toThrow();
});

test("query string and hash do not affect verification", () => {
  const sink = makeSink();
  noteUrl(sink, "https://example.com/about");
  expect(isVerifiedUrl(sink, "https://example.com/about?utm=1#team")).toBe(true);
});

test("a different path on a verified host is still rejected", () => {
  const sink = makeSink();
  noteUrl(sink, "https://example.com");
  expect(isVerifiedUrl(sink, "https://example.com/secret")).toBe(false);
});

test("links harvested from page text become verified", () => {
  const sink = makeSink();
  noteUrlsInText(sink, "See [about](https://example.com/about) and https://example.com/pricing.");
  expect(isVerifiedUrl(sink, "https://example.com/about")).toBe(true);
  expect(isVerifiedUrl(sink, "https://example.com/pricing")).toBe(true);
});
