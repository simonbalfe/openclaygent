import { expect, test } from "bun:test";
import { fitToBudget, htmlToMarkdown } from "../src/tools/extract.ts";

const PAGE = `<html><body>
  <nav><a href="/">Home</a><a href="/about">About</a><a href="/blog">Blog</a></nav>
  <main>
    <h1>Acme Pricing</h1>
    <p>Choose the plan that fits your team. All plans include a 14-day free trial with no credit card required.</p>
    <table>
      <tr><th>Plan</th><th>Price</th></tr>
      <tr><td>Starter</td><td>$10/mo</td></tr>
      <tr><td>Pro</td><td>$49/mo</td></tr>
    </table>
    <ul>
      <li>Unlimited projects on every plan for all customers</li>
      <li>Priority support on Pro for faster response times</li>
    </ul>
  </main>
  <div class="social-share"><a href="x.com">Tweet</a><a href="fb.com">Share</a></div>
  <footer>© Acme Inc. All rights reserved. <a href="/tos">Terms</a></footer>
  <script>analytics.track("view")</script>
</body></html>`;

test("htmlToMarkdown keeps content and structure", () => {
  const md = htmlToMarkdown(PAGE);
  expect(md).toContain("# Acme Pricing");
  expect(md).toContain("14-day free trial");
  expect(md).toContain("| Starter | $10/mo |");
  expect(md).toMatch(/-\s+Unlimited projects/);
});

test("htmlToMarkdown drops chrome and boilerplate", () => {
  const md = htmlToMarkdown(PAGE);
  expect(md).not.toContain("About");
  expect(md).not.toContain("Tweet");
  expect(md).not.toContain("All rights reserved");
  expect(md).not.toContain("analytics");
});

test("htmlToMarkdown keeps same-domain links, flattens external ones", () => {
  const html = `<html><body><main><p>A long enough paragraph about the product offering here.
    See <a href="/pricing">our pricing</a> or follow us via <a href="https://twitter.com/acme">Twitter</a>.</p></main></body></html>`;
  const md = htmlToMarkdown(html, "https://acme.com/home");
  expect(md).toContain("[our pricing](https://acme.com/pricing)");
  expect(md).not.toContain("twitter.com");
  expect(md).toContain("Twitter");
});

test("htmlToMarkdown handles empty input", () => {
  expect(htmlToMarkdown("")).toBe("");
  expect(htmlToMarkdown("<html><body></body></html>")).toBe("");
});

test("fitToBudget returns small pages untouched", () => {
  const md = "A short page. Nothing to filter.";
  expect(fitToBudget(md, "anything", 12000)).toBe(md);
});

test("fitToBudget keeps the query-relevant section of a long page, not the head", () => {
  const filler = Array.from({ length: 60 }, (_, i) => `Section ${i}: notes on weather and sports, item ${i}.`);
  const fact = "Funding: the company raised a $42 million Series B led by Acme Ventures in 2023.";
  const big = [...filler.slice(0, 45), fact, ...filler.slice(45)].join("\n\n");
  const fit = fitToBudget(big, "funding series B round raised", 400);
  expect(fit).toContain("$42 million Series B");
  expect(big.slice(0, 400)).not.toContain("$42 million Series B");
  expect(fit.length).toBeLessThan(big.length);
});

test("fitToBudget falls back to head truncation when no query", () => {
  const big = "x".repeat(20000);
  const out = fitToBudget(big, undefined, 1000);
  expect(out.length).toBeLessThan(big.length);
  expect(out).toContain("truncated");
});
