import { expect, test } from "bun:test";
import { htmlToMarkdown } from "../src/tools/extract.ts";

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
