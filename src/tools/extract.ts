import { Readability, isProbablyReaderable } from "@mozilla/readability";
import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const MIN_ARTICLE_CHARS = 250;

const EXCLUDED_TAGS = "nav,footer,header,aside,script,style,form,iframe,noscript,svg,link,meta";
const IMPORTANT_ATTRS = new Set([
  "src",
  "href",
  "alt",
  "title",
  "width",
  "height",
  "class",
  "id",
  "rowspan",
  "colspan",
]);
const EMPTY_BYPASS_TAGS = new Set(["a", "img", "br", "hr", "input", "source", "track", "wbr", "tr", "td", "th"]);
const NEGATIVE_PATTERNS = /nav|footer|header|sidebar|ads|comment|promo|advert|social|share/i;
const PRUNE_THRESHOLD = 0.48;

const TAG_WEIGHTS: Record<string, number> = {
  div: 0.5,
  p: 1.0,
  article: 1.5,
  section: 1.0,
  span: 0.3,
  li: 0.5,
  ul: 0.5,
  ol: 0.5,
  h1: 1.2,
  h2: 1.1,
  h3: 1.0,
  h4: 0.9,
  h5: 0.8,
  h6: 0.7,
};

const METRIC_WEIGHTS = {
  textDensity: 0.4,
  linkDensity: 0.2,
  tagWeight: 0.2,
  classIdWeight: 0.1,
  textLength: 0.1,
};

type Api = cheerio.CheerioAPI;

function isElement(node: AnyNode): node is Element {
  return node.type === "tag";
}

function textOf($: Api, el: AnyNode): string {
  return $(el).text().replace(/\s+/g, " ").trim();
}

function elementChildren(el: Element): Element[] {
  return el.children.filter(isElement);
}

function classIdPenalty(el: Element): number {
  let penalty = 0;
  if (NEGATIVE_PATTERNS.test(el.attribs.class ?? "")) penalty -= 0.5;
  if (NEGATIVE_PATTERNS.test(el.attribs.id ?? "")) penalty -= 0.5;
  return penalty;
}

function compositeScore($: Api, el: Element): number {
  const textLen = textOf($, el).length;
  const tagLen = $(el).html()?.length || 1;
  let linkTextLen = 0;
  for (const child of elementChildren(el)) {
    if (child.tagName === "a") linkTextLen += textOf($, child).length;
  }

  let score = 0;
  let total = 0;
  score += METRIC_WEIGHTS.textDensity * (textLen / tagLen);
  total += METRIC_WEIGHTS.textDensity;
  score += METRIC_WEIGHTS.linkDensity * (1 - (textLen > 0 ? linkTextLen / textLen : 0));
  total += METRIC_WEIGHTS.linkDensity;
  score += METRIC_WEIGHTS.tagWeight * (TAG_WEIGHTS[el.tagName] ?? 0.5);
  total += METRIC_WEIGHTS.tagWeight;
  score += METRIC_WEIGHTS.classIdWeight * Math.max(0, classIdPenalty(el));
  total += METRIC_WEIGHTS.classIdWeight;
  score += METRIC_WEIGHTS.textLength * Math.log(textLen + 1);
  total += METRIC_WEIGHTS.textLength;
  return score / total;
}

function sanitize($: Api): void {
  $("*")
    .contents()
    .each((_, node) => {
      if (node.type === "comment") $(node).remove();
    });
  $("*").each((_, node) => {
    if (!isElement(node)) return;
    for (const name of Object.keys(node.attribs)) {
      if (!IMPORTANT_ATTRS.has(name)) delete node.attribs[name];
    }
  });
  for (const node of $("*").toArray().reverse()) {
    if (!isElement(node)) continue;
    if (EMPTY_BYPASS_TAGS.has(node.tagName)) continue;
    if ($(node).parents("pre,code").length) continue;
    if (!elementChildren(node).length && !textOf($, node)) $(node).remove();
  }
}

function pruneTree($: Api, el: Element): void {
  for (const child of elementChildren(el)) {
    if (compositeScore($, child) < PRUNE_THRESHOLD) $(child).remove();
    else pruneTree($, child);
  }
}

function promoteHeaderCells($: Api): void {
  $("table").each((_, table) => {
    const $table = $(table);
    if ($table.find("th").length) return;
    $table
      .find("tr")
      .first()
      .children("td")
      .each((_, cell) => {
        cell.tagName = "th";
      });
  });
}

function buildConverter(baseUrl?: string): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  td.use(gfm);
  td.addRule("flattenLeftoverTables", {
    filter: (node) => {
      if (node.nodeName !== "TABLE") return false;
      const q = node as unknown as { querySelector: (s: string) => { children: ArrayLike<{ nodeName: string }> } | null };
      const firstRow = q.querySelector("tr");
      if (!firstRow) return true;
      const cells = Array.from(firstRow.children);
      const hasHeadingRow = cells.length > 0 && cells.every((c) => c.nodeName === "TH");
      return !hasHeadingRow;
    },
    replacement: (_content, node) => {
      const rows = Array.from((node as Element & { querySelectorAll: (s: string) => ArrayLike<Element> }).querySelectorAll("tr"));
      const lines = rows
        .map((tr) =>
          Array.from((tr as unknown as { children: ArrayLike<{ textContent?: string }> }).children)
            .map((c) => (c.textContent ?? "").replace(/\s+/g, " ").trim())
            .filter(Boolean)
            .join(" · "),
        )
        .filter(Boolean);
      return lines.length ? `\n\n${lines.join("\n")}\n\n` : "";
    },
  });
  td.addRule("dropImages", { filter: "img", replacement: () => "" });
  td.addRule("sameDomainLinks", {
    filter: "a",
    replacement: (content, node) => {
      const text = content.trim();
      if (!text) return "";
      const href = (node as { getAttribute?: (name: string) => string | null }).getAttribute?.("href");
      if (!href || !baseUrl) return text;
      try {
        const abs = new URL(href, baseUrl);
        return abs.host === new URL(baseUrl).host ? `[${text}](${abs.href})` : text;
      } catch {
        return text;
      }
    },
  });
  return td;
}

function tidy(markdown: string): string {
  return markdown.replace(/\n{3,}/g, "\n\n").trim();
}

function readabilityMarkdown(html: string, baseUrl?: string): string | null {
  try {
    const { document } = parseHTML(html);
    const doc = document as unknown as ConstructorParameters<typeof Readability>[0];
    if (!isProbablyReaderable(doc)) return null;
    const article = new Readability(doc).parse();
    const content = article?.content;
    if (!content) return null;
    if ((article?.textContent ?? "").replace(/\s+/g, " ").trim().length < MIN_ARTICLE_CHARS) return null;
    return tidy(buildConverter(baseUrl).turndown(content));
  } catch {
    return null;
  }
}

function pruneMarkdown(html: string, baseUrl?: string): string {
  const $ = cheerio.load(html);
  $(EXCLUDED_TAGS).remove();
  const body = $("body").get(0);
  if (!body) return "";
  sanitize($);
  pruneTree($, body);
  promoteHeaderCells($);
  return tidy(buildConverter(baseUrl).turndown($(body).html() ?? ""));
}

export function htmlToMarkdown(html: string, baseUrl?: string): string {
  return readabilityMarkdown(html, baseUrl) ?? pruneMarkdown(html, baseUrl);
}
