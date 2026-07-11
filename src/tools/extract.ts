import { Readability, isProbablyReaderable } from "@mozilla/readability";
import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { debug, reason } from "../core/debug.ts";

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
  score += METRIC_WEIGHTS.classIdWeight * classIdPenalty(el);
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
  const fallthrough = (why: string): null => {
    debug("extract.readability", `${baseUrl ?? "(no url)"} → prune path: ${why}`);
    return null;
  };
  try {
    const { document } = parseHTML(html);
    const doc = document as unknown as ConstructorParameters<typeof Readability>[0];
    if (!isProbablyReaderable(doc)) return fallthrough("not readerable");
    const article = new Readability(doc).parse();
    const content = article?.content;
    if (!content) return fallthrough("no article content");
    const textLen = (article?.textContent ?? "").replace(/\s+/g, " ").trim().length;
    if (textLen < MIN_ARTICLE_CHARS) return fallthrough(`article too short (${textLen}c)`);
    return tidy(buildConverter(baseUrl).turndown(content));
  } catch (e) {
    return fallthrough(`threw: ${reason(e)}`);
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

type LdNode = Record<string, unknown>;

const STRUCTURED_CAP = 2500;

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function ldString(v: unknown): string | null {
  if (typeof v === "string") return v.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() || null;
  if (typeof v === "number") return String(v);
  return null;
}

function typesOf(node: LdNode): string[] {
  const t = node["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
  return [];
}

function collectLdNodes(data: unknown, out: LdNode[]): void {
  if (Array.isArray(data)) {
    for (const d of data) collectLdNodes(d, out);
    return;
  }
  if (data && typeof data === "object") {
    const obj = data as LdNode;
    if ("@graph" in obj) collectLdNodes(obj["@graph"], out);
    if ("@type" in obj) out.push(obj);
  }
}

function renderAddress(a: unknown): string | null {
  if (typeof a === "string") return ldString(a);
  if (a && typeof a === "object") {
    const o = a as LdNode;
    const country =
      o.addressCountry && typeof o.addressCountry === "object"
        ? ldString((o.addressCountry as LdNode).name)
        : ldString(o.addressCountry);
    const parts = [
      ldString(o.streetAddress),
      ldString(o.addressLocality),
      ldString(o.addressRegion),
      ldString(o.postalCode),
      country,
    ].filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  }
  return null;
}

function renderEmployees(v: unknown): string | null {
  if (typeof v === "number" || typeof v === "string") return ldString(v);
  if (v && typeof v === "object") {
    const o = v as LdNode;
    const value = ldString(o.value);
    if (value) return value;
    const min = ldString(o.minValue);
    const max = ldString(o.maxValue);
    if (min && max) return `${min}-${max}`;
  }
  return null;
}

function renderLdNode(node: LdNode): string[] {
  const types = typesOf(node);
  const is = (re: RegExp) => types.some((t) => re.test(t));
  const lines: string[] = [];
  if (is(/(^|:)(Organization|Corporation|LocalBusiness|NewsMediaOrganization)$/i)) {
    const facts = [
      ldString(node.name) && `name: ${ldString(node.name)}`,
      renderEmployees(node.numberOfEmployees) && `employees: ${renderEmployees(node.numberOfEmployees)}`,
      ldString(node.foundingDate) && `founded: ${ldString(node.foundingDate)}`,
      renderAddress(node.address) && `HQ: ${renderAddress(node.address)}`,
      ldString(node.url) && `url: ${ldString(node.url)}`,
    ].filter(Boolean);
    if (facts.length) lines.push(`Organization — ${facts.join("; ")}`);
  } else if (is(/^PostalAddress$/i)) {
    const addr = renderAddress(node);
    if (addr) lines.push(`Address — ${addr}`);
  } else if (is(/FAQPage$/i)) {
    for (const q of asArray(node.mainEntity as LdNode | LdNode[])) {
      const question = ldString((q as LdNode).name);
      const accepted = (q as LdNode).acceptedAnswer;
      const answer =
        accepted && typeof accepted === "object" ? ldString((accepted as LdNode).text) : ldString(accepted);
      if (question && answer) lines.push(`FAQ — ${question} ${answer}`);
    }
  } else if (is(/^Product$/i)) {
    const offer = asArray(node.offers as LdNode | LdNode[])[0];
    const price = offer
      ? [ldString(offer.price), ldString(offer.priceCurrency)].filter(Boolean).join(" ")
      : null;
    const rating =
      node.aggregateRating && typeof node.aggregateRating === "object"
        ? ldString((node.aggregateRating as LdNode).ratingValue)
        : null;
    const facts = [
      ldString(node.name) && `name: ${ldString(node.name)}`,
      price && `price: ${price}`,
      rating && `rating: ${rating}`,
    ].filter(Boolean);
    if (facts.length) lines.push(`Product — ${facts.join("; ")}`);
  }
  return lines;
}

export function extractStructuredData(html: string): string {
  const $ = cheerio.load(html);
  const nodes: LdNode[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text();
    if (!raw.trim()) return;
    try {
      collectLdNodes(JSON.parse(raw), nodes);
    } catch (e) {
      debug("extract.jsonld", `malformed block skipped: ${reason(e)}`);
    }
  });

  const seen = new Set<string>();
  const lines: string[] = [];
  for (const node of nodes)
    for (const line of renderLdNode(node))
      if (!seen.has(line)) {
        seen.add(line);
        lines.push(line);
      }

  const desc =
    $('meta[name="description"]').attr("content") ?? $('meta[property="og:description"]').attr("content");
  const cleanDesc = ldString(desc);
  if (cleanDesc && !seen.has(`Description — ${cleanDesc}`)) lines.unshift(`Description — ${cleanDesc}`);

  if (!lines.length) return "";
  let block = lines.join("\n");
  if (block.length > STRUCTURED_CAP) block = `${block.slice(0, STRUCTURED_CAP)}…`;
  return `## Page structured data\n${block}`;
}

export function htmlToMarkdown(html: string, baseUrl?: string): string {
  const structured = extractStructuredData(html);
  const body = readabilityMarkdown(html, baseUrl) ?? pruneMarkdown(html, baseUrl);
  if (!structured) return body;
  return body ? `${structured}\n\n${body}` : structured;
}

function tokenize(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function bm25Scores(chunks: string[], query: string): number[] {
  const k1 = 1.5;
  const b = 0.75;
  const docs = chunks.map(tokenize);
  const n = docs.length;
  const avgLen = docs.reduce((sum, d) => sum + d.length, 0) / (n || 1);
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log(1 + (n - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
  const qTerms = [...new Set(tokenize(query))];
  return docs.map((d) => {
    const len = d.length || 1;
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const t of qTerms) {
      const f = tf.get(t) ?? 0;
      if (f) score += idf(t) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * len) / avgLen)));
    }
    return score;
  });
}

export function fitToBudget(markdown: string, query: string | undefined, maxChars: number): string {
  if (markdown.length <= maxChars) return markdown;
  if (!query?.trim()) return `${markdown.slice(0, maxChars)}\n\n[truncated — long page, no focus query]`;
  const chunks = markdown.split(/\n{2,}/).map((c) => c.trim()).filter(Boolean);
  if (chunks.length <= 1) return `${markdown.slice(0, maxChars)}\n\n[truncated — long page]`;
  const scores = bm25Scores(chunks, query);
  const ranked = chunks
    .map((c, i) => ({ i, c, s: scores[i] ?? 0 }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  const picked: { i: number; c: string }[] = [];
  let used = 0;
  for (const x of ranked) {
    if (used + x.c.length + 2 > maxChars) continue;
    picked.push(x);
    used += x.c.length + 2;
  }
  if (!picked.length) return `${markdown.slice(0, maxChars)}\n\n[truncated — long page]`;
  picked.sort((a, b) => a.i - b.i);
  return `${picked.map((p) => p.c).join("\n\n")}\n\n[long page — showing the ${picked.length} sections most relevant to: ${query}]`;
}
