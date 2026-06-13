import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { runActor } from "./apify.ts";
import { clip, record, type Sink } from "./sink.ts";

const DEFAULT_ACTOR = "parseforge~crunchbase-scraper";

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

export function crunchbaseTools(sink: Sink) {
  const crunchbase_company = createTool({
    id: "crunchbase_company",
    description:
      "FALLBACK ONLY. Get a company's Crunchbase funding & firmographics as structured data — total funding, latest round (type, amount, date), investors, founders, employee range, HQ, founded year, IPO status. Crunchbase is bot-walled, so call this ONLY after web_search has failed to pin the funding/firmographic facts from open sources. Costs Apify credits — call at most once per company. Pass the crunchbase.com/organization URL if one appeared in search results, otherwise the exact company name.",
    inputSchema: z.object({
      company: z
        .string()
        .describe(
          "Crunchbase organization URL (preferred, e.g. https://www.crunchbase.com/organization/openai) or the exact company name.",
        ),
    }),
    outputSchema: z.object({ company: z.unknown() }),
    execute: async ({ company }) => {
      const actor = process.env.CRUNCHBASE_ACTOR ?? DEFAULT_ACTOR;
      const isUrl = /crunchbase\.com\/organization\//i.test(company);
      const input = isUrl
        ? { startUrls: [{ url: company }], maxItems: 1 }
        : { searchQuery: company, maxItems: 1 };
      const { items, usd } = await runActor<RawOrg>(actor, input);
      sink.cost.apify += usd;
      const o = items[0];
      const profile = o && {
        name: o.name ?? "",
        crunchbaseUrl: o.cbUrl ?? o.crunchbaseUrl ?? o.url ?? (isUrl ? company : ""),
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
      };
      if (profile?.crunchbaseUrl) sink.sources.add(profile.crunchbaseUrl);
      record(sink, {
        type: "crunchbase",
        query: company,
        resultCount: profile ? 1 : 0,
        results: profile
          ? [
              {
                title: profile.name,
                url: profile.crunchbaseUrl,
                preview: clip(
                  `${profile.lastRound.type} ${profile.lastRound.amountUsd ?? ""} · ${profile.totalFundingUsd ?? ""}`,
                ),
              },
            ]
          : [],
        cost: usd,
      });
      return { company: profile ?? null };
    },
  });

  return { crunchbase_company };
}
