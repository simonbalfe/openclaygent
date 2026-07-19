import { z } from "zod";
import { apifyTool } from "./apify.ts";
import type { RunContext } from "./sink.ts";

const DEFAULT_ACTOR = "parseforge~crunchbase-scraper";
const ORG_URL = /crunchbase\.com\/organization\//i;

interface RawOrg {
  name?: string;
  cbUrl?: string;
  crunchbaseUrl?: string;
  url?: string;
  website?: string;
  founded?: string | number;
  foundedOn?: string;
  headquarters?: string;
  city?: string;
  region?: string;
  country?: string;
  employeeCount?: string;
  industries?: string[];
  totalFundingUsd?: number;
  totalFunding?: number;
  lastRoundType?: string;
  lastFundingType?: string;
  lastRoundAmountUsd?: number;
  lastFundingAmountUsd?: number;
  lastRoundDate?: string;
  lastFundingOn?: string;
  founders?: ({ name?: string; role?: string; title?: string } | string)[];
  leadInvestors?: string[];
  investors?: ({ name?: string } | string)[];
  ipoStatus?: string;
  operatingStatus?: string;
}

function nameOf(x: { name?: string } | string | undefined): string {
  return typeof x === "string" ? x : (x?.name ?? "");
}

export function crunchbaseTools(context: RunContext) {
  const crunchbase_company = apifyTool(context, {
    id: "crunchbase_company",
    description:
      "FALLBACK ONLY. Get a company's Crunchbase funding & firmographics as structured data — total funding, latest round (type, amount, date), investors, founders, employee range, HQ, founded year, IPO status. Crunchbase is bot-walled, so call this ONLY after web_search has failed to pin the funding/firmographic facts from open sources. Costs Apify credits — call at most once per company. Pass the crunchbase.com/organization URL if one appeared in search results, otherwise the exact company name.",
    type: "crunchbase",
    inputSchema: z.object({
      company: z
        .string()
        .describe(
          "Crunchbase organization URL (preferred, e.g. https://www.crunchbase.com/organization/openai) or the exact company name.",
        ),
    }),
    outputKey: "company",
    single: true,
    prepare: ({ company }) => ({
      actor: process.env.CRUNCHBASE_ACTOR ?? DEFAULT_ACTOR,
      actorInput: ORG_URL.test(company)
        ? { startUrls: [{ url: company }], maxItems: 1 }
        : { searchQuery: company, maxItems: 1 },
      query: company,
      guard: ORG_URL.test(company)
        ? {
            url: company,
            hint: "Pass the exact company name instead, or web_search for the crunchbase.com/organization page first.",
          }
        : undefined,
    }),
    map: (items: RawOrg[], { company }) =>
      items.slice(0, 1).map((o) => ({
        name: o.name ?? "",
        crunchbaseUrl: o.cbUrl ?? o.crunchbaseUrl ?? o.url ?? (ORG_URL.test(company) ? company : ""),
        website: o.website ?? "",
        foundedYear: o.founded ?? o.foundedOn ?? null,
        employeeCount: o.employeeCount ?? null,
        industry: (o.industries ?? [])[0] ?? "",
        headquarters: o.headquarters ?? [o.city, o.region, o.country].filter(Boolean).join(", "),
        totalFundingUsd: o.totalFundingUsd ?? o.totalFunding ?? null,
        lastRound: {
          type: o.lastRoundType ?? o.lastFundingType ?? "",
          amountUsd: o.lastRoundAmountUsd ?? o.lastFundingAmountUsd ?? null,
          date: o.lastRoundDate ?? o.lastFundingOn ?? "",
        },
        founders: (o.founders ?? []).map(nameOf).filter(Boolean).slice(0, 6),
        leadInvestors: (o.leadInvestors ?? o.investors ?? []).map(nameOf).filter(Boolean).slice(0, 10),
        ipoStatus: o.ipoStatus ?? o.operatingStatus ?? "",
      })),
    view: (p) => ({
      title: p.name,
      url: p.crunchbaseUrl,
      preview: `${p.lastRound.type} ${p.lastRound.amountUsd ?? ""} · ${p.totalFundingUsd ?? ""}`,
    }),
    sourceUrl: (p) => p.crunchbaseUrl,
  });

  return { crunchbase_company };
}
